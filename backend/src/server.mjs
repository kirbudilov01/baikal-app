import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDb, updateDb } from './store.mjs';
import { assertCanTransition, createDomainError, publicStatus, reportStatuses } from './status-machine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4000);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 1_000_000);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 6_000_000);
const uploadDir = process.env.UPLOAD_DIR ?? join(__dirname, '..', 'data', 'uploads');
const adminToken = process.env.ADMIN_TOKEN ?? '';
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
  response.setHeader('access-control-allow-headers', 'content-type,x-admin-id,x-admin-token,authorization');
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

function profileIdFromRequest(request) {
  const raw = String(request.headers['x-profile-id'] || '').trim();
  if (!raw) return 'demo-profile';
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || 'demo-profile';
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
  <title>Админка | Байкал в наших руках</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f7;
      --surface: #ffffff;
      --text: #141414;
      --muted: #6b7280;
      --border: #e5e7eb;
      --teal: #008f9a;
      --green: #247647;
      --danger: #a33a3a;
      --soft: #e8f5f3;
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
      padding: 28px 20px 40px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: 34px;
      line-height: 38px;
      letter-spacing: 0;
    }
    .subtitle {
      color: var(--muted);
      font-weight: 700;
      margin-top: 5px;
    }
    .auth, .summary, .reports, .detail {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 16px;
    }
    .auth {
      min-width: 320px;
      display: flex;
      gap: 8px;
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
    button.secondary {
      background: #eef0f2;
      color: var(--text);
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
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
      background: var(--bg);
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
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Админка</h1>
        <div class="subtitle">Байкал в наших руках · модерация заявок</div>
      </div>
      <div class="auth">
        <input id="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password" />
        <button id="saveToken">Войти</button>
      </div>
    </header>

    <section class="summary" id="summary"></section>

    <main class="grid">
      <section class="reports">
        <div class="toolbar">
          <button class="secondary" data-filter="all">Все</button>
          <button class="secondary" data-filter="moderation">Модерация</button>
          <button class="secondary" data-filter="active">Активные</button>
          <button class="secondary" data-filter="terminal">Закрытые</button>
          <button id="refresh" class="secondary">Обновить</button>
        </div>
        <div id="reportList" class="empty">Введите токен администратора</div>
      </section>
      <aside class="detail" id="detail">
        <div class="empty">Выберите заявку</div>
      </aside>
    </main>
  </div>

  <template id="statusOptions">${statusOptions}</template>

  <script>
    const state = {
      token: localStorage.getItem('baikalAdminToken') || '',
      reports: [],
      summary: null,
      selectedId: null,
      filter: 'all',
    };

    const tokenInput = document.querySelector('#token');
    tokenInput.value = state.token;

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
        'x-admin-token': state.token,
        'x-admin-id': 'admin:web-panel',
      };
    }

    function formatDate(value) {
      if (!value) return '';
      return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    }

    function filteredReports() {
      if (state.filter === 'moderation') return state.reports.filter((r) => r.status.code === 'moderation');
      if (state.filter === 'active') return state.reports.filter((r) => !r.status.terminal);
      if (state.filter === 'terminal') return state.reports.filter((r) => r.status.terminal);
      return state.reports;
    }

    function renderSummary() {
      const summary = state.summary || { total: 0, active: 0, resolved: 0, byStatus: {} };
      document.querySelector('#summary').innerHTML = [
        ['Всего', summary.total || 0],
        ['Активные', summary.active || 0],
        ['Модерация', summary.byStatus?.moderation || 0],
        ['Решено', summary.resolved || 0],
      ].map(([label, value]) => '<div class="stat"><strong>' + value + '</strong><span>' + label + '</span></div>').join('');
    }

    function renderReports() {
      const list = document.querySelector('#reportList');
      const reports = filteredReports();
      if (!reports.length) {
        list.className = 'empty';
        list.textContent = state.token ? 'Заявок нет' : 'Введите токен администратора';
        return;
      }

      list.className = '';
      list.innerHTML = reports.map((report) => {
        const active = report.id === state.selectedId ? ' active' : '';
        return '<button class="report' + active + '" data-id="' + report.id + '">' +
          '<div class="row"><div><div class="id">' + report.id + ' · ' + report.locationText + '</div>' +
          '<div class="title">' + report.title + '</div>' +
          '<div class="meta">' + report.category + ' · ' + formatDate(report.createdAt) + '</div></div>' +
          '<span class="pill">' + report.status.label + '</span></div>' +
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
        '<div class="event">[' + formatDate(event.createdAt) + '] ' + event.actor + ': ' + (event.comment || event.status || event.type) + '</div>'
      ).join('') || '<div class="hint">Истории пока нет</div>';
      const photo = report.photoUrl ? '<img class="photo" src="' + report.photoUrl + '" alt="Фото заявки" />' : '<div class="hint">Фото не приложено</div>';
      const mapsUrl = 'https://maps.apple.com/?ll=' + report.latitude + ',' + report.longitude + '&q=' + encodeURIComponent(report.title);

      detail.innerHTML = '<div class="row"><div><div class="id">' + report.id + '</div><h2>' + report.title + '</h2>' +
        '<div class="meta">' + report.category + ' · ' + report.locationText + '</div></div>' +
        '<span class="pill">' + report.status.label + '</span></div>' +
        '<div class="detail-section"><span class="label">Фото</span>' + photo + '</div>' +
        '<div class="detail-section"><span class="label">Описание</span><div>' + (report.description || 'Нет описания') + '</div></div>' +
        '<div class="detail-section"><span class="label">Профиль</span><div>' + (report.profileId || 'Неизвестно') + '</div></div>' +
        '<div class="detail-section"><span class="label">Координаты</span><div>' + report.latitude + ', ' + report.longitude + ' · <a class="link" target="_blank" rel="noreferrer" href="' + mapsUrl + '">Открыть карту</a></div></div>' +
        '<div class="detail-section"><span class="label">Комментарий администратора</span><textarea id="comment" placeholder="Например: передано координатору района"></textarea>' +
        '<div class="actions">' + (actionButtons || '<span class="hint">Финальный статус, действий нет</span>') + '</div><div id="message"></div></div>' +
        '<div class="detail-section"><span class="label">История</span>' + events + '</div>';
    }

    function render() {
      renderSummary();
      renderReports();
      renderDetail();
    }

    async function loadReports() {
      if (!state.token) {
        render();
        return;
      }
      const list = document.querySelector('#reportList');
      list.className = 'empty';
      list.textContent = 'Загрузка...';
      try {
        const response = await fetch('/api/admin/reports', { headers: headers() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить заявки');
        state.reports = payload.reports || [];
        state.summary = payload.summary || null;
        state.selectedId = state.selectedId || state.reports[0]?.id || null;
        render();
      } catch (error) {
        list.className = 'error';
        list.textContent = error.message;
      }
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
        await loadReports();
      } catch (error) {
        message.className = 'error';
        message.textContent = error.message;
      }
    }

    document.querySelector('#saveToken').addEventListener('click', () => {
      state.token = tokenInput.value.trim();
      localStorage.setItem('baikalAdminToken', state.token);
      loadReports();
    });

    document.querySelector('#refresh').addEventListener('click', loadReports);

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

    loadReports();
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

  if (request.method === 'GET' && url.pathname === '/api/rewards') {
    sendJson(response, 200, { rewards: rewardCatalog });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/me/summary') {
    const db = await readDb();
    const profileId = profileIdFromRequest(request);
    sendJson(response, 200, { profile: profileSummary(db.reports, db.rewardClaims, profileId) });
    return;
  }

  const rewardClaimMatch = url.pathname.match(/^\/api\/rewards\/([^/]+)\/claim$/);
  if (request.method === 'POST' && rewardClaimMatch) {
    const rewardId = rewardClaimMatch[1];
    const reward = rewardCatalog.find((item) => item.id === rewardId);
    if (!reward) throw createDomainError(404, 'Reward not found');
    const profileId = profileIdFromRequest(request);

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
    const profileId = profileIdFromRequest(request);

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
            actor: 'mobile:user',
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
    const adminId = requireAdmin(request);

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
