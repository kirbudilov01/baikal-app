import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, createUser, findSessionUser, findUserByUsername, listUsers, readDb, updateDb } from './store.mjs';
import { assertCanTransition, createDomainError, publicStatus, reportStatuses } from './status-machine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4000);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 1_000_000);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 6_000_000);
const uploadDir = process.env.UPLOAD_DIR ?? join(__dirname, '..', 'data', 'uploads');
const adminToken = process.env.ADMIN_TOKEN ?? '';
const adminUsername = process.env.ADMIN_USERNAME ?? (process.env.NODE_ENV === 'production' ? '' : 'kolotilin');
const adminPassword = process.env.ADMIN_PASSWORD ?? (process.env.NODE_ENV === 'production' ? '' : 'baikal');
const supportEmail = process.env.SUPPORT_EMAIL ?? 'support@example.com';
const legalOperatorName = process.env.LEGAL_OPERATOR_NAME ?? 'Оператор проекта «Байкал в наших руках»';
const legalOperatorAddress = process.env.LEGAL_OPERATOR_ADDRESS ?? 'Укажите юридический адрес оператора';
const legalOperatorInn = process.env.LEGAL_OPERATOR_INN ?? 'Укажите ИНН оператора';
const legalEffectiveDate = process.env.LEGAL_EFFECTIVE_DATE ?? '17.08.2026';
const dataHostingNote = process.env.DATA_HOSTING_NOTE ?? 'Для публичного релиза персональные данные граждан РФ должны обрабатываться с использованием баз данных, расположенных на территории Российской Федерации.';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowUnsafeLocalAdmin = process.env.ALLOW_UNSAFE_LOCAL_ADMIN === 'true' || process.env.NODE_ENV !== 'production';

const rewardCatalog = [
  {
    id: 'tea-by-the-lake',
    title: 'Чай у озера',
    partner: 'Кафе «У Озера»',
    cost: 350,
    benefit: 'Напиток в подарок',
    note: 'Можно забрать сегодня',
  },
  {
    id: 'bike-rental',
    title: 'Прокат велосипеда',
    partner: 'Листвянка Bike',
    cost: 800,
    benefit: '-20% на прогулку',
    note: '2 часа по берегу',
  },
  {
    id: 'eco-hotel',
    title: 'Эко-отель',
    partner: 'Байкал Дом',
    cost: 1200,
    benefit: '-10% на ночь',
    note: 'Для выходных',
  },
];

function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowedOrigin = allowedOrigins.includes(String(origin)) ? origin : allowedOrigins[0];

  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type,x-admin-id,x-admin-token,x-profile-id,authorization');
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-origin', allowedOrigin || '*');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function sendDownload(response, fileName, payload, contentType) {
  response.writeHead(200, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function sendBuffer(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'public, max-age=31536000, immutable',
  });
  response.end(payload);
}

async function readJson(request, limitBytes = maxBodyBytes) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      throw createDomainError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function publicBaseUrl(request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = request.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${request.headers.host}`;
}

function uploadExtension(contentType) {
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/heic') return '.heic';
  throw createDomainError(400, 'Unsupported image type');
}

async function saveUpload(request) {
  const payload = await readJson(request, maxUploadBytes);
  const contentType = String(payload.contentType || 'image/jpeg').toLowerCase();
  const extension = uploadExtension(contentType);
  const dataBase64 = String(payload.dataBase64 || '');
  if (!dataBase64) throw createDomainError(400, 'Missing field: dataBase64');

  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw createDomainError(400, 'Uploaded file is empty');
  if (buffer.length > maxUploadBytes) throw createDomainError(413, 'Uploaded file is too large');

  await mkdir(uploadDir, { recursive: true });
  const fileName = `${randomUUID()}${extension}`;
  const filePath = join(uploadDir, fileName);
  await writeFile(filePath, buffer, { flag: 'wx' });

  return {
    url: `${publicBaseUrl(request)}/uploads/${fileName}`,
    path: `/uploads/${fileName}`,
    contentType,
    size: buffer.length,
  };
}

function requireAdmin(request) {
  if (!adminToken && allowUnsafeLocalAdmin) return request.headers['x-admin-id'] || 'admin:local';
  if (!adminToken) throw createDomainError(500, 'Admin token is not configured');

  const bearer = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const token = request.headers['x-admin-token'] || bearer;
  if (token !== adminToken) throw createDomainError(401, 'Admin authorization required');

  return request.headers['x-admin-id'] || 'admin:api';
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function validateAdminCredentials(payload) {
  if (!adminToken) throw createDomainError(500, 'Admin access is not configured');
  if (!adminUsername || !adminPassword) throw createDomainError(500, 'Admin login is not configured');

  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');
  if (!safeEqualText(username, adminUsername) || !safeEqualText(password, adminPassword)) {
    throw createDomainError(401, 'Неверный логин или пароль');
  }

  return {
    token: adminToken,
    admin: {
      username: adminUsername,
    },
  };
}

function bearerToken(request) {
  return String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
}

async function userFromRequest(request) {
  const token = bearerToken(request);
  if (!token) return null;
  return findSessionUser(token);
}

async function profileIdFromRequest(request) {
  const user = await userFromRequest(request);
  if (user?.profileId) return user.profileId;

  const raw = String(request.headers['x-profile-id'] || '').trim();
  if (!raw) return 'demo-profile';
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || 'demo-profile';
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateCredentials(payload) {
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');

  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
    throw createDomainError(400, 'Username can contain 3-24 latin letters, numbers, dot, dash or underscore');
  }
  if (password.length < 6 || password.length > 72) {
    throw createDomainError(400, 'Password must contain 6-72 characters');
  }

  return { username, password };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createAuthToken() {
  return randomBytes(32).toString('base64url');
}

function publicReport(report) {
  const status = publicStatus(report.status);
  return {
    id: report.id,
    title: report.title,
    category: report.category,
    description: report.description,
    locationText: report.locationText,
    latitude: report.latitude,
    longitude: report.longitude,
    status,
    nextStep: status.hint,
    points: report.points,
    confirmations: report.confirmations,
    photoUrl: report.photoUrl,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function adminReport(report, events) {
  return {
    ...publicReport(report),
    profileId: report.profileId,
    adminAction: reportStatuses[report.status].adminAction,
    events: events.filter((event) => event.reportId === report.id),
  };
}

function reportSummary(reports) {
  const byStatus = Object.fromEntries(Object.keys(reportStatuses).map((status) => [status, 0]));
  const byCategory = {};

  for (const report of reports) {
    byStatus[report.status] = (byStatus[report.status] ?? 0) + 1;
    byCategory[report.category] = (byCategory[report.category] ?? 0) + 1;
  }

  return {
    total: reports.length,
    active: reports.filter((report) => !reportStatuses[report.status].terminal).length,
    resolved: reports.filter((report) => report.status === 'resolved').length,
    byStatus,
    byCategory,
  };
}

function profileSummary(reports, rewardClaims = [], profileId = 'demo-profile') {
  const baseBalance = 1250;
  const ownReports = reports.filter((report) => report.profileId === profileId || (!report.profileId && profileId === 'demo-profile'));
  const earned = ownReports.reduce((sum, report) => sum + report.points, 0);
  const spent = rewardClaims
    .filter((claim) => claim.profileId === profileId && claim.status === 'issued')
    .reduce((sum, claim) => sum + claim.pointsSpent, 0);
  const resolved = ownReports.filter((report) => report.status === 'resolved').length;
  const confirmations = ownReports.reduce((sum, report) => sum + report.confirmations, 0);
  const balance = Math.max(0, baseBalance + earned - spent);

  return {
    id: profileId,
    balance,
    earned,
    spent,
    resolved,
    confirmations,
    availableRewards: rewardCatalog.filter((reward) => balance >= reward.cost).map((reward) => reward.id),
    claimedRewards: rewardClaims.filter((claim) => claim.profileId === profileId),
    nextReward: rewardCatalog.find((reward) => balance < reward.cost) ?? null,
  };
}

function adminUsers(users, db) {
  return users.map((user) => {
    const profile = profileSummary(db.reports, db.rewardClaims, user.profileId);
    const userReports = db.reports.filter((report) => report.profileId === user.profileId);
    return {
      ...user,
      balance: profile.balance,
      earned: profile.earned,
      spent: profile.spent,
      reports: userReports.length,
      activeReports: userReports.filter((report) => !reportStatuses[report.status]?.terminal).length,
      resolvedReports: userReports.filter((report) => report.status === 'resolved').length,
      claimedRewards: profile.claimedRewards.length,
    };
  });
}

function publicRewardClaim(claim) {
  const reward = rewardCatalog.find((item) => item.id === claim.rewardId);
  const promoTitle = claim.profileId.startsWith('promo:') ? claim.profileId.split(':')[1] : '';
  return {
    ...claim,
    rewardTitle: reward?.title ?? claim.rewardId,
    rewardPartner: reward?.partner ?? '',
    promoType: claim.profileId.startsWith('promo:') ? 'global' : 'personal',
    promoTitle: promoTitle ? promoTitle.replace(/-/g, ' ') : '',
  };
}

async function adminDatabaseSnapshot() {
  const db = await readDb();
  const users = await listUsers();
  return {
    summary: {
      reports: db.reports.length,
      users: users.length,
      promoCodes: db.rewardClaims.length,
      activeReports: db.reports.filter((report) => !reportStatuses[report.status]?.terminal).length,
    },
    reports: db.reports.map((report) => adminReportWithActions(report, db.events)),
    users: adminUsers(users, db),
    promoCodes: db.rewardClaims.map(publicRewardClaim),
    rewards: rewardCatalog,
  };
}

function createRewardCode(rewardId) {
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const prefix = rewardId
    .split('-')
    .map((part) => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
  return `BAIKAL-${prefix}-${suffix}`;
}

function promoSlug(value) {
  return String(value || 'promo')
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'promo';
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvTable(headers, rows) {
  return '\uFEFF' + [
    headers.map(csvCell).join(';'),
    ...rows.map((row) => row.map(csvCell).join(';')),
  ].join('\n');
}

async function adminExportCsv(kind) {
  const snapshot = await adminDatabaseSnapshot();
  if (kind === 'users') {
    return csvTable(
      ['id', 'username', 'profile_id', 'balance', 'earned', 'spent', 'reports', 'active_reports', 'resolved_reports', 'claimed_rewards', 'created_at', 'last_seen_at'],
      snapshot.users.map((user) => [
        user.id,
        user.username,
        user.profileId,
        user.balance,
        user.earned,
        user.spent,
        user.reports,
        user.activeReports,
        user.resolvedReports,
        user.claimedRewards,
        user.createdAt,
        user.lastSeenAt,
      ]),
    );
  }

  if (kind === 'promo-codes') {
    return csvTable(
      ['id', 'code', 'type', 'campaign', 'profile_id', 'reward_id', 'reward_title', 'partner', 'points_spent', 'status', 'created_at'],
      snapshot.promoCodes.map((promo) => [
        promo.id,
        promo.code,
        promo.promoType,
        promo.promoTitle,
        promo.profileId,
        promo.rewardId,
        promo.rewardTitle,
        promo.rewardPartner,
        promo.pointsSpent,
        promo.status,
        promo.createdAt,
      ]),
    );
  }

  return csvTable(
    ['id', 'title', 'category', 'description', 'location', 'latitude', 'longitude', 'status', 'points', 'confirmations', 'profile_id', 'photo_url', 'created_at', 'updated_at'],
    snapshot.reports.map((report) => [
      report.id,
      report.title,
      report.category,
      report.description,
      report.locationText,
      report.latitude,
      report.longitude,
      report.status?.label,
      report.points,
      report.confirmations,
      report.profileId,
      report.photoUrl,
      report.createdAt,
      report.updatedAt,
    ]),
  );
}

function allowedNextStatuses(status) {
  return Object.keys(reportStatuses).filter((nextStatus) => {
    try {
      assertCanTransition(status, nextStatus);
      return true;
    } catch {
      return false;
    }
  });
}

function adminReportWithActions(report, events) {
  return {
    ...adminReport(report, events),
    allowedNextStatuses: allowedNextStatuses(report.status),
  };
}

function adminPageHtml() {
  const statusOptions = Object.entries(reportStatuses)
    .map(([code, meta]) => `<option value="${code}">${meta.label}</option>`)
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23008f9a'/%3E%3Cpath d='M32 12c7 9 13 17 13 26a13 13 0 1 1-26 0c0-9 6-17 13-26z' fill='white'/%3E%3C/svg%3E" />
  <title>Админка | Байкал в наших руках</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f7f6;
      --surface: #ffffff;
      --text: #141414;
      --muted: #6b7280;
      --border: #e5e7eb;
      --teal: #008f9a;
      --teal-dark: #006f76;
      --green: #247647;
      --danger: #a33a3a;
      --soft: #e8f5f3;
      --shadow: 0 18px 42px rgba(20, 20, 20, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    .login-screen {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-card {
      width: min(100%, 440px);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 24px;
      box-shadow: var(--shadow);
    }
    .login-mark {
      width: 52px;
      height: 52px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      color: #fff;
      background: linear-gradient(135deg, var(--teal), var(--green));
      font-size: 26px;
      font-weight: 900;
      margin-bottom: 18px;
    }
    .login-card h1 {
      font-size: 30px;
      line-height: 34px;
      margin-bottom: 6px;
    }
    .login-card p {
      color: var(--muted);
      font-size: 15px;
      line-height: 22px;
      font-weight: 700;
      margin: 0 0 18px;
    }
    .login-form {
      display: grid;
      gap: 10px;
    }
    .app-shell[hidden], .login-screen[hidden] { display: none; }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 36px;
      line-height: 40px;
      letter-spacing: 0;
    }
    .subtitle {
      color: var(--muted);
      font-weight: 700;
      margin-top: 5px;
    }
    .auth, .summary, .reports, .detail, .ops-hero, .users {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .ops-hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: center;
      margin-bottom: 16px;
      background:
        linear-gradient(135deg, rgba(0,143,154,0.12), rgba(36,118,71,0.1)),
        var(--surface);
    }
    .ops-hero-title {
      font-size: 22px;
      line-height: 27px;
      font-weight: 900;
      margin-bottom: 6px;
    }
    .ops-hero-text {
      color: var(--muted);
      font-size: 14px;
      line-height: 20px;
      font-weight: 700;
      max-width: 650px;
    }
    .ops-live {
      min-height: 44px;
      border-radius: 999px;
      background: var(--soft);
      color: var(--teal-dark);
      padding: 0 16px;
      display: flex;
      align-items: center;
      font-weight: 900;
      white-space: nowrap;
    }
    .auth {
      min-width: 320px;
      display: flex;
      gap: 8px;
      box-shadow: none;
    }
    input, textarea, select, button {
      font: inherit;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    input, textarea, select {
      background: #fff;
      color: var(--text);
      padding: 11px 12px;
      min-height: 42px;
    }
    input { flex: 1; min-width: 0; }
    textarea { width: 100%; min-height: 76px; resize: vertical; }
    button {
      min-height: 42px;
      padding: 0 14px;
      border: 0;
      background: var(--teal);
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }
    button:hover { background: var(--teal-dark); }
    button.secondary {
      background: #eef0f2;
      color: var(--text);
    }
    button.ghost {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
    }
    button.tab {
      background: #fff;
      color: var(--muted);
      border: 1px solid var(--border);
    }
    button.tab.active {
      background: var(--teal);
      color: #fff;
      border-color: var(--teal);
    }
    button.secondary:hover { background: #e1e6e8; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .panel[hidden] { display: none; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 390px;
      gap: 16px;
      align-items: start;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      background: linear-gradient(180deg, #f8fbfa, #eef6f4);
      border-radius: 14px;
      padding: 12px;
    }
    .stat strong { display: block; font-size: 24px; }
    .stat span { color: var(--muted); font-size: 13px; font-weight: 700; }
    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .report {
      width: 100%;
      text-align: left;
      background: #fff;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 13px;
      margin-bottom: 9px;
      cursor: pointer;
    }
    .report.active { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(0,143,154,0.12); }
    .row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .id, .meta, .hint, .event {
      color: var(--muted);
      font-size: 12px;
      line-height: 16px;
      font-weight: 700;
    }
    .title {
      font-size: 16px;
      line-height: 20px;
      font-weight: 850;
      margin-top: 3px;
    }
    .pill {
      border-radius: 999px;
      padding: 6px 9px;
      background: var(--soft);
      color: var(--teal);
      font-size: 12px;
      font-weight: 850;
      white-space: nowrap;
    }
    .profile-pill {
      display: inline-flex;
      border-radius: 999px;
      background: #f2f3f5;
      color: var(--muted);
      padding: 6px 9px;
      font-size: 12px;
      font-weight: 850;
      margin-top: 8px;
    }
    .users {
      margin-top: 16px;
    }
    .promo, .database, .export {
      margin-top: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-head h2 {
      margin: 0;
      font-size: 22px;
      line-height: 27px;
    }
    .section-note {
      color: var(--muted);
      font-size: 13px;
      line-height: 18px;
      font-weight: 700;
      max-width: 520px;
    }
    .user-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .user-card {
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 13px;
      background: #fff;
    }
    .user-name {
      font-size: 17px;
      line-height: 21px;
      font-weight: 900;
      margin-bottom: 4px;
    }
    .user-metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .user-metric {
      border-radius: 12px;
      background: #f6f8f8;
      padding: 9px;
    }
    .user-metric strong { display: block; font-size: 18px; line-height: 22px; }
    .user-metric span { color: var(--muted); font-size: 11px; font-weight: 800; }
    .promo-form {
      display: grid;
      grid-template-columns: 1fr 1fr 120px auto;
      gap: 10px;
      align-items: end;
    }
    .promo-modes, .export-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 10px 0 14px;
    }
    .promo-mode {
      border-radius: 16px;
      background: #f6f8f8;
      border: 1px solid var(--border);
      padding: 12px;
      margin-bottom: 12px;
    }
    .promo-mode[hidden] { display: none; }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-size: 13px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    tr:last-child td { border-bottom: 0; }
    .detail h2 { margin: 0 0 4px; font-size: 22px; line-height: 27px; }
    .detail-section { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 14px; }
    .photo {
      width: 100%;
      max-height: 240px;
      object-fit: cover;
      border-radius: 16px;
      border: 1px solid var(--border);
      margin-top: 12px;
      background: var(--bg);
    }
    .link {
      color: var(--teal);
      font-weight: 850;
      text-decoration: none;
    }
    .field { margin-top: 10px; }
    .label { display: block; color: var(--muted); font-size: 12px; font-weight: 850; margin-bottom: 5px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .empty {
      color: var(--muted);
      padding: 22px;
      text-align: center;
      font-weight: 700;
    }
    .error { color: var(--danger); font-weight: 800; margin-top: 8px; }
    .ok { color: var(--green); font-weight: 800; margin-top: 8px; }
    @media (max-width: 860px) {
      header { flex-direction: column; }
      .auth { width: 100%; min-width: 0; }
      .grid { grid-template-columns: 1fr; }
      .summary { grid-template-columns: repeat(2, 1fr); }
      .user-grid { grid-template-columns: 1fr; }
      .promo-form { grid-template-columns: 1fr; }
      .ops-hero { grid-template-columns: 1fr; }
      .ops-live { justify-content: center; }
    }
  </style>
</head>
<body>
  <section class="login-screen" id="loginScreen">
    <form class="login-card" id="authForm">
      <div class="login-mark">Б</div>
      <h1>Вход в админку</h1>
      <p>Управление обращениями, пользователями, промокодами и выгрузками проекта.</p>
      <div class="login-form">
        <label><span class="label">Логин</span><input id="adminLogin" type="text" placeholder="Введите логин" autocomplete="username" /></label>
        <label><span class="label">Пароль</span><input id="adminPassword" type="password" placeholder="Введите пароль" autocomplete="current-password" /></label>
        <button id="saveToken">Войти</button>
        <div id="loginMessage" class="hint"></div>
      </div>
    </form>
  </section>

  <div class="shell app-shell" id="adminApp" hidden>
    <header>
      <div>
        <h1>Админка</h1>
        <div class="subtitle">Байкал в наших руках · обращения, пользователи, промокоды</div>
      </div>
      <button class="ghost" id="logout">Выйти</button>
    </header>

    <section class="ops-hero">
      <div>
        <div class="ops-hero-title">Операционный центр</div>
        <div class="ops-hero-text">Здесь видно, что происходит в приложении: новые обращения, база участников, бонусные коды и выгрузки для команды.</div>
      </div>
      <div class="ops-live" id="adminState">Вход не выполнен</div>
    </section>

    <section class="summary" id="summary"></section>

    <nav class="tabs" id="tabs">
      <button class="tab active" data-tab="reports">Очередь обращений</button>
      <button class="tab" data-tab="users">База пользователей</button>
      <button class="tab" data-tab="promos">Промокоды</button>
      <button class="tab" data-tab="database">База и выгрузка</button>
    </nav>

    <main class="grid panel" data-panel="reports">
      <section class="reports">
        <div class="toolbar">
          <button class="secondary" data-filter="all">Все</button>
          <button class="secondary" data-filter="moderation">Модерация</button>
          <button class="secondary" data-filter="active">Активные</button>
          <button class="secondary" data-filter="terminal">Закрытые</button>
          <button id="refresh" class="secondary">Обновить</button>
        </div>
        <div id="reportList" class="empty">Войдите как администратор</div>
      </section>
      <aside class="detail" id="detail">
        <div class="empty">Выберите заявку</div>
      </aside>
    </main>

    <section class="users panel" data-panel="users" hidden>
      <div class="section-head">
        <div>
          <h2>Пользователи</h2>
          <div class="section-note">База аккаунтов: заявки, баланс листиков, списанные бонусы и последняя активность. Приватные данные здесь не показываются.</div>
        </div>
        <button id="refreshUsers" class="secondary">Обновить базу</button>
      </div>
      <div id="userList" class="empty">Войдите как администратор</div>
    </section>

    <section class="promo panel" data-panel="promos" hidden>
      <div class="section-head">
        <div>
          <h2>Промокоды</h2>
          <div class="section-note">Создавайте персональные промокоды для участников или общие коды для партнерских кампаний.</div>
        </div>
      </div>
      <div class="promo-modes">
        <button class="tab active" data-promo-mode="personal">Персональный</button>
        <button class="tab" data-promo-mode="global">Общий</button>
      </div>
      <div class="promo-mode" data-promo-panel="personal">
        <div class="promo-form">
          <label><span class="label">Пользователь</span><select id="promoUser"></select></label>
          <label><span class="label">Бонус</span><select id="promoReward"></select></label>
          <label><span class="label">Кол-во</span><input id="promoQuantity" type="number" min="1" max="1" value="1" disabled /></label>
          <button id="createPromo">Создать</button>
        </div>
      </div>
      <div class="promo-mode" data-promo-panel="global" hidden>
        <div class="promo-form">
          <label><span class="label">Кампания</span><input id="globalPromoTitle" type="text" value="Партнерская кампания" /></label>
          <label><span class="label">Бонус</span><select id="globalPromoReward"></select></label>
          <label><span class="label">Кол-во</span><input id="globalPromoQuantity" type="number" min="1" max="100" value="10" /></label>
          <button id="createGlobalPromo">Создать пачку</button>
        </div>
      </div>
      <div id="promoMessage"></div>
      <div id="promoList" class="empty">Промокодов пока нет</div>
    </section>

    <section class="database panel" data-panel="database" hidden>
      <div class="section-head">
        <div>
          <h2>База и выгрузка</h2>
          <div class="section-note">Операционный срез: пользователи, заявки и выданные промокоды. Приватные данные здесь не отображаются.</div>
        </div>
      </div>
      <div class="export-actions">
        <button class="secondary" data-export="reports">Выгрузить обращения</button>
        <button class="secondary" data-export="users">Выгрузить пользователей</button>
        <button class="secondary" data-export="promo-codes">Выгрузить промокоды</button>
      </div>
      <div id="dbView" class="empty">Войдите как администратор</div>
    </section>
  </div>

  <template id="statusOptions">${statusOptions}</template>

  <script>
    const state = {
      token: localStorage.getItem('baikalAdminToken') || '',
      db: null,
      reports: [],
      users: [],
      rewards: [],
      promoCodes: [],
      summary: null,
      selectedId: null,
      filter: 'all',
      activeTab: 'reports',
      promoMode: 'personal',
    };

    const loginInput = document.querySelector('#adminLogin');
    const passwordInput = document.querySelector('#adminPassword');
    const loginScreen = document.querySelector('#loginScreen');
    const adminApp = document.querySelector('#adminApp');

    const statusLabels = {
      moderation: 'На модерации',
      transferred: 'Передано',
      in_progress: 'В работе',
      resolved: 'Решено',
      rejected: 'Отклонено',
    };

    function headers() {
      return {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + state.token,
        'x-admin-id': 'admin:web-panel',
      };
    }

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    function formatDate(value) {
      if (!value) return '';
      return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    }

    function userLabel(profileId) {
      const user = state.users.find((item) => item.profileId === profileId);
      if (user) return '@' + user.username;
      if (profileId === 'demo-profile') return 'демо-профиль';
      if (profileId === 'seed-profile') return 'тестовый профиль';
      return profileId || 'профиль не указан';
    }

    function promoStatusLabel(status) {
      if (status === 'active') return 'Активен';
      if (status === 'issued') return 'Выдан';
      if (status === 'used') return 'Погашен';
      return status || 'Без статуса';
    }

    function filteredReports() {
      if (state.filter === 'moderation') return state.reports.filter((r) => r.status.code === 'moderation');
      if (state.filter === 'active') return state.reports.filter((r) => !r.status.terminal);
      if (state.filter === 'terminal') return state.reports.filter((r) => r.status.terminal);
      return state.reports;
    }

    function renderSummary() {
      const summary = state.summary || { total: 0, active: 0, resolved: 0, byStatus: {} };
      loginScreen.hidden = Boolean(state.token);
      adminApp.hidden = !state.token;
      document.querySelector('#adminState').textContent = state.token ? 'Админ вошел' : 'Вход не выполнен';
      document.querySelector('#summary').innerHTML = [
        ['Всего', summary.total || 0],
        ['Активные', summary.active || 0],
        ['Модерация', summary.byStatus?.moderation || 0],
        ['Пользователи', state.users.length || 0],
      ].map(([label, value]) => '<div class="stat"><strong>' + value + '</strong><span>' + label + '</span></div>').join('');

      document.querySelectorAll('[data-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === state.activeTab);
      });
      document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== state.activeTab;
      });
      document.querySelectorAll('[data-promo-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.promoMode === state.promoMode);
      });
      document.querySelectorAll('[data-promo-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.promoPanel !== state.promoMode;
      });
    }

    function renderReports() {
      const list = document.querySelector('#reportList');
      const reports = filteredReports();
      if (!reports.length) {
        list.className = 'empty';
        list.textContent = state.token ? 'Заявок нет' : 'Войдите как администратор';
        return;
      }

      list.className = '';
      list.innerHTML = reports.map((report) => {
        const active = report.id === state.selectedId ? ' active' : '';
        return '<button class="report' + active + '" data-id="' + report.id + '">' +
          '<div class="row"><div><div class="id">' + esc(report.id) + ' · ' + esc(report.locationText) + '</div>' +
          '<div class="title">' + esc(report.title) + '</div>' +
          '<div class="meta">' + esc(report.category) + ' · ' + formatDate(report.createdAt) + '</div>' +
          '<div class="profile-pill">' + esc(userLabel(report.profileId)) + '</div></div>' +
          '<span class="pill">' + esc(report.status.label) + '</span></div>' +
        '</button>';
      }).join('');
    }

    function renderDetail() {
      const detail = document.querySelector('#detail');
      const report = state.reports.find((item) => item.id === state.selectedId);
      if (!report) {
        detail.innerHTML = '<div class="empty">Выберите заявку</div>';
        return;
      }

      const actionButtons = (report.allowedNextStatuses || []).map((status) =>
        '<button data-status="' + status + '">' + (statusLabels[status] || status) + '</button>'
      ).join('');

      const events = (report.events || []).map((event) =>
        '<div class="event">[' + formatDate(event.createdAt) + '] ' + esc(event.actor) + ': ' + esc(event.comment || event.status || event.type) + '</div>'
      ).join('') || '<div class="hint">Истории пока нет</div>';
      const photo = report.photoUrl ? '<img class="photo" src="' + esc(report.photoUrl) + '" alt="Фото заявки" />' : '<div class="hint">Фото не приложено</div>';
      const mapsUrl = 'https://maps.apple.com/?ll=' + report.latitude + ',' + report.longitude + '&q=' + encodeURIComponent(report.title);

      detail.innerHTML = '<div class="row"><div><div class="id">' + esc(report.id) + '</div><h2>' + esc(report.title) + '</h2>' +
        '<div class="meta">' + esc(report.category) + ' · ' + esc(report.locationText) + '</div></div>' +
        '<span class="pill">' + esc(report.status.label) + '</span></div>' +
        '<div class="detail-section"><span class="label">Фото</span>' + photo + '</div>' +
        '<div class="detail-section"><span class="label">Описание</span><div>' + esc(report.description || 'Нет описания') + '</div></div>' +
        '<div class="detail-section"><span class="label">Профиль</span><div>' + esc(userLabel(report.profileId)) + '</div></div>' +
        '<div class="detail-section"><span class="label">Координаты</span><div>' + esc(report.latitude) + ', ' + esc(report.longitude) + ' · <a class="link" target="_blank" rel="noreferrer" href="' + esc(mapsUrl) + '">Открыть карту</a></div></div>' +
        '<div class="detail-section"><span class="label">Комментарий администратора</span><textarea id="comment" placeholder="Например: передано координатору района"></textarea>' +
        '<div class="actions">' + (actionButtons || '<span class="hint">Финальный статус, действий нет</span>') + '</div><div id="message"></div></div>' +
        '<div class="detail-section"><span class="label">История</span>' + events + '</div>';
    }

    function renderUsers() {
      const list = document.querySelector('#userList');
      if (!state.users.length) {
        list.className = 'empty';
        list.textContent = state.token ? 'Пользователей пока нет' : 'Войдите как администратор';
        return;
      }

      list.className = 'user-grid';
      list.innerHTML = state.users.map((user) => {
        return '<article class="user-card">' +
          '<div class="user-name">@' + esc(user.username) + '</div>' +
          '<div class="meta">' + esc(user.profileId) + '</div>' +
          '<div class="meta">Создан: ' + formatDate(user.createdAt) + '</div>' +
          '<div class="meta">Активность: ' + (user.lastSeenAt ? formatDate(user.lastSeenAt) : 'еще не было') + '</div>' +
          '<div class="user-metrics">' +
            '<div class="user-metric"><strong>' + user.balance + '</strong><span>листиков</span></div>' +
            '<div class="user-metric"><strong>' + user.spent + '</strong><span>списано</span></div>' +
            '<div class="user-metric"><strong>' + user.reports + '</strong><span>заявок</span></div>' +
            '<div class="user-metric"><strong>' + user.activeReports + '</strong><span>активных</span></div>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    function renderPromoTools() {
      const userSelect = document.querySelector('#promoUser');
      const rewardSelect = document.querySelector('#promoReward');
      const globalRewardSelect = document.querySelector('#globalPromoReward');
      const promoList = document.querySelector('#promoList');
      userSelect.innerHTML = state.users.map((user) => '<option value="' + esc(user.profileId) + '">@' + esc(user.username) + ' · ' + user.balance + ' листиков</option>').join('');
      const rewardOptions = state.rewards.map((reward) => '<option value="' + esc(reward.id) + '">' + esc(reward.title) + ' · ' + reward.cost + ' листиков</option>').join('');
      rewardSelect.innerHTML = rewardOptions;
      globalRewardSelect.innerHTML = rewardOptions;

      if (!state.promoCodes.length) {
        promoList.className = 'empty';
        promoList.textContent = state.token ? 'Промокодов пока нет' : 'Войдите как администратор';
        return;
      }

      promoList.className = 'table-wrap';
      promoList.innerHTML = '<table><thead><tr><th>Код</th><th>Тип</th><th>Получатель/кампания</th><th>Бонус</th><th>Списано</th><th>Статус</th><th>Дата</th></tr></thead><tbody>' +
        state.promoCodes.map((promo) => '<tr><td><strong>' + esc(promo.code) + '</strong></td><td>' + (promo.promoType === 'global' ? 'Общий' : 'Персональный') + '</td><td>' + esc(promo.promoTitle || userLabel(promo.profileId)) + '</td><td>' + esc(promo.rewardTitle) + '</td><td>' + promo.pointsSpent + '</td><td>' + esc(promoStatusLabel(promo.status)) + '</td><td>' + formatDate(promo.createdAt) + '</td></tr>').join('') +
      '</tbody></table>';
    }

    function renderDbView() {
      const dbView = document.querySelector('#dbView');
      if (!state.db) {
        dbView.className = 'empty';
        dbView.textContent = state.token ? 'База загружается' : 'Войдите как администратор';
        return;
      }

      dbView.className = 'table-wrap';
      dbView.innerHTML = '<table><thead><tr><th>Раздел</th><th>Всего</th><th>Что внутри</th></tr></thead><tbody>' +
        '<tr><td>Пользователи</td><td>' + state.users.length + '</td><td>Аккаунты, балансы, активность</td></tr>' +
        '<tr><td>Обращения</td><td>' + state.reports.length + '</td><td>Фото, координаты, статусы, история</td></tr>' +
        '<tr><td>Промокоды</td><td>' + state.promoCodes.length + '</td><td>Выданные бонусные коды</td></tr>' +
      '</tbody></table>';
    }

    function render() {
      renderSummary();
      renderReports();
      renderDetail();
      renderUsers();
      renderPromoTools();
      renderDbView();
    }

    function resetDashboard() {
      state.db = null;
      state.reports = [];
      state.users = [];
      state.rewards = [];
      state.promoCodes = [];
      state.summary = null;
      state.selectedId = null;
    }

    async function loadDashboard() {
      if (!state.token) {
        resetDashboard();
        render();
        return;
      }
      const list = document.querySelector('#reportList');
      list.className = 'empty';
      list.textContent = 'Загрузка...';
      const userList = document.querySelector('#userList');
      userList.className = 'empty';
      userList.textContent = 'Загрузка пользователей...';
      try {
        const response = await fetch('/api/admin/db', { headers: headers() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить данные');
        state.db = payload;
        state.reports = payload.reports || [];
        state.summary = payload.summary ? {
          total: payload.summary.reports || 0,
          active: payload.summary.activeReports || 0,
          byStatus: Object.fromEntries(['moderation', 'transferred', 'in_progress', 'resolved', 'rejected'].map((status) => [status, (payload.reports || []).filter((report) => report.status.code === status).length])),
        } : null;
        state.users = payload.users || [];
        state.rewards = payload.rewards || [];
        state.promoCodes = payload.promoCodes || [];
        state.selectedId = state.selectedId || state.reports[0]?.id || null;
        render();
      } catch (error) {
        list.className = 'error';
        list.textContent = error.message;
        userList.className = 'error';
        userList.textContent = error.message;
      }
    }

    async function loginAdmin() {
      document.querySelector('#loginMessage').className = 'hint';
      document.querySelector('#loginMessage').textContent = 'Проверяем доступ...';
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: loginInput.value, password: passwordInput.value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось войти');
      state.token = payload.token;
      localStorage.setItem('baikalAdminToken', state.token);
      passwordInput.value = '';
      document.querySelector('#loginMessage').textContent = '';
      await loadDashboard();
    }

    async function createPromoCode(mode) {
      const message = document.querySelector('#promoMessage');
      message.className = 'hint';
      message.textContent = 'Создаем код...';
      try {
        const body = mode === 'global'
          ? {
              mode: 'global',
              title: document.querySelector('#globalPromoTitle').value,
              rewardId: document.querySelector('#globalPromoReward').value,
              quantity: document.querySelector('#globalPromoQuantity').value,
            }
          : {
              mode: 'personal',
              profileId: document.querySelector('#promoUser').value,
              rewardId: document.querySelector('#promoReward').value,
            };
        const response = await fetch('/api/admin/promo-codes', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось создать промокод');
        message.className = 'ok';
        message.textContent = payload.alreadyExisted
          ? 'Промокод уже есть: ' + payload.promoCode.code
          : (payload.promoCodes?.length > 1 ? 'Промокоды созданы: ' + payload.promoCodes.length : 'Промокод создан: ' + payload.promoCode.code);
        state.db = payload.db;
        state.reports = payload.db.reports || [];
        state.users = payload.db.users || [];
        state.rewards = payload.db.rewards || [];
        state.promoCodes = payload.db.promoCodes || [];
        render();
      } catch (error) {
        message.className = 'error';
        message.textContent = error.message;
      }
    }

    async function exportData(kind) {
      const response = await fetch('/api/admin/export?kind=' + encodeURIComponent(kind), { headers: headers() });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Не удалось выгрузить файл');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'baikal-' + kind + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function changeStatus(reportId, status) {
      const message = document.querySelector('#message');
      const comment = document.querySelector('#comment')?.value || '';
      message.className = 'hint';
      message.textContent = 'Сохраняем...';
      try {
        const response = await fetch('/api/admin/reports/' + reportId + '/status', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ status, comment }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось сменить статус');
        const index = state.reports.findIndex((item) => item.id === reportId);
        if (index >= 0) state.reports[index] = payload.report;
        message.className = 'ok';
        message.textContent = 'Статус обновлен';
        await loadDashboard();
      } catch (error) {
        message.className = 'error';
        message.textContent = error.message;
      }
    }

    document.querySelector('#authForm').addEventListener('submit', (event) => {
      event.preventDefault();
      loginAdmin().catch((error) => {
        const message = document.querySelector('#loginMessage');
        message.className = 'error';
        message.textContent = error.message;
      });
    });

    document.querySelector('#logout').addEventListener('click', () => {
      state.token = '';
      localStorage.removeItem('baikalAdminToken');
      resetDashboard();
      render();
    });

    document.querySelector('#refresh').addEventListener('click', loadDashboard);
    document.querySelector('#refreshUsers').addEventListener('click', loadDashboard);
    document.querySelector('#createPromo').addEventListener('click', () => createPromoCode('personal'));
    document.querySelector('#createGlobalPromo').addEventListener('click', () => createPromoCode('global'));

    document.querySelector('#tabs').addEventListener('click', (event) => {
      const tab = event.target?.dataset?.tab;
      if (!tab) return;
      state.activeTab = tab;
      render();
    });

    document.querySelector('.promo-modes').addEventListener('click', (event) => {
      const mode = event.target?.dataset?.promoMode;
      if (!mode) return;
      state.promoMode = mode;
      render();
    });

    document.querySelectorAll('[data-export]').forEach((button) => {
      button.addEventListener('click', () => {
        exportData(button.dataset.export).catch((error) => {
          document.querySelector('#adminState').textContent = error.message;
        });
      });
    });

    document.querySelector('.toolbar').addEventListener('click', (event) => {
      const filter = event.target?.dataset?.filter;
      if (!filter) return;
      state.filter = filter;
      render();
    });

    document.querySelector('#reportList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-id]');
      if (!button) return;
      state.selectedId = button.dataset.id;
      render();
    });

    document.querySelector('#detail').addEventListener('click', (event) => {
      const button = event.target.closest('[data-status]');
      if (!button || !state.selectedId) return;
      changeStatus(state.selectedId, button.dataset.status);
    });

    loadDashboard();
  </script>
</body>
</html>`;
}

function legalPageHtml({ title, subtitle, sections }) {
  const sectionHtml = sections
    .map(
      (section) => `
      <section>
        <h2>${section.title}</h2>
        <p>${section.text}</p>
      </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | Байкал в наших руках</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8f7;
      --surface: #ffffff;
      --text: #151515;
      --muted: #667085;
      --teal: #008f9a;
      --border: #e5e7eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
    }
    main {
      width: min(760px, calc(100% - 32px));
      margin: 0 auto;
      padding: 44px 0 64px;
    }
    .hero {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 28px;
      margin-bottom: 14px;
    }
    .eyebrow {
      color: var(--teal);
      font-size: 13px;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    h1 {
      margin: 8px 0 10px;
      font-size: clamp(30px, 6vw, 46px);
      line-height: 1.04;
      letter-spacing: 0;
    }
    .subtitle { color: var(--muted); font-size: 17px; font-weight: 700; }
    section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 20px 22px;
      margin-top: 10px;
    }
    h2 { margin: 0 0 8px; font-size: 19px; line-height: 1.2; }
    p { margin: 0; color: var(--muted); }
    a { color: var(--teal); font-weight: 800; }
    footer { color: var(--muted); margin-top: 18px; font-size: 13px; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <div class="eyebrow">Байкал в наших руках</div>
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    ${sectionHtml}
    <section>
      <h2>Оператор</h2>
      <p>${legalOperatorName}. ИНН: ${legalOperatorInn}. Адрес: ${legalOperatorAddress}. Контакт: <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
    </section>
    <footer>Дата вступления в силу: ${legalEffectiveDate}. Дата технического обновления: ${new Intl.DateTimeFormat('ru-RU').format(new Date())}.</footer>
  </main>
</body>
</html>`;
}

function privacyPageHtml() {
  return legalPageHtml({
    title: 'Политика конфиденциальности',
    subtitle: 'Мы собираем только данные, необходимые для обработки экологических обращений.',
    sections: [
      {
        title: 'Какие данные обрабатываются',
        text: 'Приложение может обрабатывать описание проблемы, выбранную категорию, координаты точки, фотографию обращения, статус обращения, начисленные листики и техническую информацию, необходимую для стабильной работы сервиса.',
      },
      {
        title: 'Зачем это нужно',
        text: 'Данные используются для модерации обращений, передачи информации ответственным службам, отображения статусов, начисления листиков и предотвращения дублей.',
      },
      {
        title: 'Публичность',
        text: 'Контакты пользователя не отображаются публично. В публичных списках показываются только обезличенные сведения о проблеме, статусе и месте.',
      },
      {
        title: 'Хранение и удаление',
        text: `Запрос на удаление данных можно отправить на ${supportEmail}. Данные хранятся не дольше, чем нужно для обработки обращения, соблюдения закона и защиты прав участников проекта.`,
      },
      {
        title: 'Локализация',
        text: dataHostingNote,
      },
    ],
  });
}

function supportPageHtml() {
  return legalPageHtml({
    title: 'Поддержка',
    subtitle: 'Поможем с заявками, статусами, баллами и доступом к приложению.',
    sections: [
      {
        title: 'Как связаться',
        text: `Напишите на ${supportEmail}. В сообщении укажите номер заявки, устройство и что именно не получилось сделать.`,
      },
      {
        title: 'Срочные ситуации',
        text: 'Если есть опасность для людей, сначала обращайтесь в экстренные службы. Приложение помогает фиксировать и сопровождать экологические обращения, но не заменяет экстренный вызов.',
      },
      {
        title: 'Администрирование',
        text: 'Модераторы видят обращения в админ-панели, меняют статусы и добавляют комментарии по ходу работы.',
      },
    ],
  });
}

function dataDeletionPageHtml() {
  return legalPageHtml({
    title: 'Удаление данных',
    subtitle: 'Пользователь может запросить удаление своих обращений и связанных данных.',
    sections: [
      {
        title: 'Что отправить',
        text: `Напишите на ${supportEmail}: номер заявки, примерную дату отправки и какие данные нужно удалить.`,
      },
      {
        title: 'Что удаляется',
        text: 'После проверки запроса удаляются или обезличиваются описание, фотография, координаты и история действий, если хранение этих данных больше не требуется по закону.',
      },
      {
        title: 'Срок обработки',
        text: 'Для релизной версии срок должен быть закреплен юридически. Для тестового запуска используйте эту страницу как рабочий публичный процесс удаления данных.',
      },
    ],
  });
}

function termsPageHtml() {
  return legalPageHtml({
    title: 'Пользовательское соглашение',
    subtitle: 'Правила использования приложения для фиксации экологических обращений.',
    sections: [
      {
        title: 'Назначение сервиса',
        text: 'Приложение помогает пользователям сообщать об экологических проблемах, прикладывать описание, место и фото, отслеживать статус обращения и получать листики за полезные действия.',
      },
      {
        title: 'Ответственность пользователя',
        text: 'Пользователь должен отправлять достоверные сведения, не публиковать чужие персональные данные без оснований и не использовать приложение для заведомо ложных сообщений.',
      },
      {
        title: 'Модерация',
        text: 'Оператор может проверять обращения, уточнять сведения, менять статус, отклонять некорректные обращения и передавать информацию ответственным службам.',
      },
      {
        title: 'Баллы и бонусы',
        text: 'Листики являются внутренней системой поощрения проекта и не являются денежными средствами. Условия бонусов могут меняться, а выдача зависит от доступности предложений партнеров.',
      },
      {
        title: 'Ограничение сервиса',
        text: 'Приложение не заменяет экстренные службы. При угрозе жизни, здоровью или имуществу пользователь должен сначала обратиться в соответствующие экстренные службы.',
      },
    ],
  });
}

function createReportId(existingReports) {
  const numericIds = existingReports
    .map((report) => Number(String(report.id).replace('BR-', '')))
    .filter(Number.isFinite);
  return `BR-${Math.max(1200, ...numericIds) + 1}`;
}

function validateReportPayload(payload) {
  const required = ['category', 'description', 'latitude', 'longitude'];
  for (const key of required) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
      throw createDomainError(400, `Missing field: ${key}`);
    }
  }

  if (String(payload.description).trim().length < 10) {
    throw createDomainError(400, 'Description must be at least 10 characters');
  }

  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw createDomainError(400, 'Latitude must be a valid coordinate');
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw createDomainError(400, 'Longitude must be a valid coordinate');
  }
}

async function route(request, response) {
  applyCors(request, response);
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'baikal-backend', time: new Date().toISOString() });
    return;
  }

  const uploadFileMatch = url.pathname.match(/^\/uploads\/([a-f0-9-]+\.(?:jpg|png|webp|heic))$/);
  if (request.method === 'GET' && uploadFileMatch) {
    const fileName = uploadFileMatch[1];
    const extension = fileName.split('.').pop();
    const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'heic' ? 'image/heic' : 'image/jpeg';
    try {
      const payload = await readFile(join(uploadDir, fileName));
      sendBuffer(response, 200, payload, contentType);
    } catch (error) {
      if (error.code === 'ENOENT') throw createDomainError(404, 'Upload not found');
      throw error;
    }
    return;
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    sendHtml(response, 200, adminPageHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/privacy') {
    sendHtml(response, 200, privacyPageHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/support') {
    sendHtml(response, 200, supportPageHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/data-deletion') {
    sendHtml(response, 200, dataDeletionPageHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/terms') {
    sendHtml(response, 200, termsPageHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/statuses') {
    sendJson(response, 200, { statuses: Object.entries(reportStatuses).map(([code]) => publicStatus(code)) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/uploads') {
    const upload = await saveUpload(request);
    sendJson(response, 201, { upload });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const payload = await readJson(request);
    const { username, password } = validateCredentials(payload);
    const existingUser = await findUserByUsername(username);
    if (existingUser) throw createDomainError(409, 'Username is already taken');

    const now = new Date().toISOString();
    const user = await createUser({
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      createdAt: now,
    });
    const session = await createSession({ token: createAuthToken(), userId: user.id, createdAt: now });
    sendJson(response, 201, session);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const payload = await readJson(request);
    const { username, password } = validateCredentials(payload);
    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw createDomainError(401, 'Invalid username or password');
    }

    const session = await createSession({ token: createAuthToken(), userId: user.id, createdAt: new Date().toISOString() });
    sendJson(response, 200, session);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    const payload = await readJson(request);
    sendJson(response, 200, validateAdminCredentials(payload));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await userFromRequest(request);
    if (!user) throw createDomainError(401, 'Authorization required');
    sendJson(response, 200, { user });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/rewards') {
    sendJson(response, 200, { rewards: rewardCatalog });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/me/summary') {
    const db = await readDb();
    const profileId = await profileIdFromRequest(request);
    sendJson(response, 200, { profile: profileSummary(db.reports, db.rewardClaims, profileId) });
    return;
  }

  const rewardClaimMatch = url.pathname.match(/^\/api\/rewards\/([^/]+)\/claim$/);
  if (request.method === 'POST' && rewardClaimMatch) {
    const rewardId = rewardClaimMatch[1];
    const reward = rewardCatalog.find((item) => item.id === rewardId);
    if (!reward) throw createDomainError(404, 'Reward not found');
    const profileId = await profileIdFromRequest(request);

    const nextDb = await updateDb((db) => {
      const summary = profileSummary(db.reports, db.rewardClaims, profileId);
      const existingClaim = db.rewardClaims.find((claim) => claim.profileId === summary.id && claim.rewardId === rewardId);
      if (existingClaim) throw createDomainError(409, 'Reward is already claimed');
      if (summary.balance < reward.cost) throw createDomainError(409, 'Not enough points');

      const now = new Date().toISOString();
      const claim = {
        id: randomUUID(),
        profileId: summary.id,
        rewardId,
        code: createRewardCode(rewardId),
        pointsSpent: reward.cost,
        status: 'issued',
        createdAt: now,
      };

      return {
        rewardClaims: [claim, ...db.rewardClaims],
      };
    });

    const claim = nextDb.rewardClaims.find((item) => item.rewardId === rewardId && item.profileId === profileId);
    sendJson(response, 201, {
      claim,
      profile: profileSummary(nextDb.reports, nextDb.rewardClaims, profileId),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/reports') {
    const db = await readDb();
    sendJson(response, 200, { reports: db.reports.map(publicReport) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reports') {
    const payload = await readJson(request);
    validateReportPayload(payload);
    const profileId = await profileIdFromRequest(request);

    const nextDb = await updateDb((db) => {
      const now = new Date().toISOString();
      const id = createReportId(db.reports);
      const report = {
        id,
        title: payload.title || `Проблема: ${payload.category}`,
        category: payload.category,
        description: String(payload.description).trim(),
        locationText: payload.locationText || 'Точка на карте',
        latitude: Number(payload.latitude),
        longitude: Number(payload.longitude),
        status: 'moderation',
        points: 50,
        confirmations: 0,
        photoUrl: payload.photoUrl || null,
        profileId,
        createdAt: now,
        updatedAt: now,
      };

      return {
        reports: [report, ...db.reports],
        events: [
          {
            id: randomUUID(),
            reportId: id,
            type: 'created',
            status: 'moderation',
            actor: `mobile:${profileId}`,
            comment: 'Заявка создана из мобильного приложения.',
            createdAt: now,
          },
          ...db.events,
        ],
      };
    });

    sendJson(response, 201, { report: publicReport(nextDb.reports[0]) });
    return;
  }

  const confirmMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/confirm$/);
  if (request.method === 'POST' && confirmMatch) {
    const reportId = confirmMatch[1];
    const profileId = await profileIdFromRequest(request);

    const nextDb = await updateDb((db) => {
      const index = db.reports.findIndex((report) => report.id === reportId);
      if (index === -1) throw createDomainError(404, 'Report not found');

      const current = db.reports[index];
      if (reportStatuses[current.status].terminal) {
        throw createDomainError(409, 'Report is already closed');
      }

      const now = new Date().toISOString();
      const updated = {
        ...current,
        confirmations: current.confirmations + 1,
        updatedAt: now,
      };

      const reports = [...db.reports];
      reports[index] = updated;

      return {
        reports,
        events: [
          {
            id: randomUUID(),
            reportId,
            type: 'confirmed',
            status: current.status,
            actor: `mobile:${profileId}`,
            comment: 'Пользователь подтвердил, что видел проблему на месте.',
            createdAt: now,
          },
          ...db.events,
        ],
      };
    });

    const report = nextDb.reports.find((item) => item.id === reportId);
    sendJson(response, 200, { report: publicReport(report) });
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/status$/);
  if (request.method === 'POST' && statusMatch) {
    const reportId = statusMatch[1];
    const payload = await readJson(request);
    requireAdmin(request);

    const nextDb = await updateDb((db) => {
      const index = db.reports.findIndex((report) => report.id === reportId);
      if (index === -1) throw createDomainError(404, 'Report not found');

      const current = db.reports[index];
      assertCanTransition(current.status, payload.status);

      const now = new Date().toISOString();
      const updated = {
        ...current,
        status: payload.status,
        updatedAt: now,
        points: payload.status === 'resolved' ? Math.max(current.points, 100) : current.points,
      };

      const reports = [...db.reports];
      reports[index] = updated;

      return {
        reports,
        events: [
          {
            id: randomUUID(),
            reportId,
            type: 'status_changed',
            status: payload.status,
            actor: String(adminId),
            comment: payload.comment || reportStatuses[payload.status].mobileHint,
            createdAt: now,
          },
          ...db.events,
        ],
      };
    });

    const report = nextDb.reports.find((item) => item.id === reportId);
    sendJson(response, 200, { report: adminReport(report, nextDb.events) });
    return;
  }

  const adminReportMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if (request.method === 'GET' && adminReportMatch) {
    requireAdmin(request);
    const db = await readDb();
    const report = db.reports.find((item) => item.id === adminReportMatch[1]);
    if (!report) throw createDomainError(404, 'Report not found');
    sendJson(response, 200, { report: adminReportWithActions(report, db.events) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/reports') {
    requireAdmin(request);
    const db = await readDb();
    sendJson(response, 200, {
      summary: reportSummary(db.reports),
      reports: db.reports.map((report) => adminReportWithActions(report, db.events)),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    requireAdmin(request);
    const db = await readDb();
    const users = await listUsers();
    sendJson(response, 200, {
      users: adminUsers(users, db),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/db') {
    requireAdmin(request);
    sendJson(response, 200, await adminDatabaseSnapshot());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/export') {
    requireAdmin(request);
    const kind = ['reports', 'users', 'promo-codes'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'reports';
    sendDownload(response, `baikal-${kind}.csv`, await adminExportCsv(kind), 'text/csv; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/promo-codes') {
    const payload = await readJson(request);
    requireAdmin(request);
    const mode = payload.mode === 'global' ? 'global' : 'personal';
    const rewardId = String(payload.rewardId || '').trim();
    const quantity = Math.min(100, Math.max(1, Number.parseInt(String(payload.quantity || 1), 10) || 1));
    const title = promoSlug(payload.title || 'общий-промокод');
    const profileId = mode === 'global'
      ? `promo:${title}:${randomUUID().slice(0, 8)}`
      : String(payload.profileId || '').trim();
    const reward = rewardCatalog.find((item) => item.id === rewardId);
    if (!profileId) throw createDomainError(400, 'Выберите пользователя');
    if (!reward) throw createDomainError(404, 'Бонус не найден');

    if (mode === 'personal') {
      const snapshot = await adminDatabaseSnapshot();
      const existingClaim = snapshot.promoCodes.find((claim) => claim.profileId === profileId && claim.rewardId === rewardId);
      if (existingClaim) {
        sendJson(response, 200, {
          promoCode: existingClaim,
          promoCodes: [existingClaim],
          alreadyExisted: true,
          db: snapshot,
        });
        return;
      }
    }

    const nextDb = await updateDb((db) => {
      const now = new Date().toISOString();
      const claims = Array.from({ length: quantity }, () => ({
        id: randomUUID(),
        profileId: mode === 'global' ? `promo:${title}:${randomUUID().slice(0, 8)}` : profileId,
        rewardId,
        code: createRewardCode(rewardId),
        pointsSpent: reward.cost,
        status: mode === 'global' ? 'active' : 'issued',
        createdAt: now,
      }));

      return {
        rewardClaims: [...claims, ...db.rewardClaims],
      };
    });

    const createdClaims = mode === 'global'
      ? nextDb.rewardClaims.filter((item) => item.profileId.startsWith(`promo:${title}:`) && item.rewardId === rewardId).slice(0, quantity)
      : nextDb.rewardClaims.filter((item) => item.profileId === profileId && item.rewardId === rewardId).slice(0, 1);
    sendJson(response, 201, {
      promoCode: publicRewardClaim(createdClaims[0]),
      promoCodes: createdClaims.map(publicRewardClaim),
      db: await adminDatabaseSnapshot(),
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(response, statusCode, { error: statusCode === 500 ? 'Internal server error' : error.message });
  }
});

server.listen(port, () => {
  console.log(`Baikal backend listening on http://localhost:${port}`);
});
