import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || join(defaultDataDir, 'baikal.sqlite');
const legacyJsonPath = join(defaultDataDir, 'db.json');

const seed = {
  reports: [
    {
      id: 'BR-1024',
      title: 'Незаконная вырубка леса',
      category: 'Вырубка',
      description: 'Свежие пни рядом с тропой, видны следы техники.',
      locationText: 'Большое Голоустное',
      latitude: 52.0398,
      longitude: 105.4053,
      status: 'in_progress',
      points: 50,
      confirmations: 4,
      photoUrl: null,
      createdAt: '2026-05-12T08:30:00.000Z',
      updatedAt: '2026-05-15T12:20:00.000Z',
      profileId: 'seed-profile',
    },
    {
      id: 'BR-1018',
      title: 'Мусор на берегу',
      category: 'Мусор',
      description: 'Пакеты и пластиковые бутылки у воды.',
      locationText: 'Листвянка',
      latitude: 51.8528,
      longitude: 104.8694,
      status: 'transferred',
      points: 20,
      confirmations: 2,
      photoUrl: null,
      createdAt: '2026-05-10T07:40:00.000Z',
      updatedAt: '2026-05-10T10:10:00.000Z',
      profileId: 'seed-profile',
    },
  ],
  events: [
    {
      id: 'EV-1',
      reportId: 'BR-1024',
      type: 'status_changed',
      status: 'in_progress',
      actor: 'admin:seed',
      comment: 'Передано в работу после проверки координат.',
      createdAt: '2026-05-15T12:20:00.000Z',
    },
  ],
};

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    location_text TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    status TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    confirmations INTEGER NOT NULL DEFAULT 0,
    photo_url TEXT,
    profile_id TEXT NOT NULL DEFAULT 'demo-profile',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT,
    actor TEXT NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reward_claims (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    reward_id TEXT NOT NULL,
    code TEXT NOT NULL,
    points_spent INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(profile_id, reward_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_events_report_id ON events(report_id);
  CREATE INDEX IF NOT EXISTS idx_reward_claims_profile_id ON reward_claims(profile_id);
`);

const reportColumns = sqlite.prepare('PRAGMA table_info(reports)').all().map((column) => column.name);
if (!reportColumns.includes('profile_id')) {
  sqlite.prepare("ALTER TABLE reports ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'demo-profile'").run();
}

const insertReport = sqlite.prepare(`
  INSERT OR REPLACE INTO reports (
    id,
    title,
    category,
    description,
    location_text,
    latitude,
    longitude,
    status,
    points,
    confirmations,
    photo_url,
    profile_id,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @title,
    @category,
    @description,
    @locationText,
    @latitude,
    @longitude,
    @status,
    @points,
    @confirmations,
    @photoUrl,
    @profileId,
    @createdAt,
    @updatedAt
  )
`);

const insertEvent = sqlite.prepare(`
  INSERT OR REPLACE INTO events (
    id,
    report_id,
    type,
    status,
    actor,
    comment,
    created_at
  ) VALUES (
    @id,
    @reportId,
    @type,
    @status,
    @actor,
    @comment,
    @createdAt
  )
`);

const insertRewardClaim = sqlite.prepare(`
  INSERT OR REPLACE INTO reward_claims (
    id,
    profile_id,
    reward_id,
    code,
    points_spent,
    status,
    created_at
  ) VALUES (
    @id,
    @profileId,
    @rewardId,
    @code,
    @pointsSpent,
    @status,
    @createdAt
  )
`);

function rowToReport(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    locationText: row.location_text,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    points: row.points,
    confirmations: row.confirmations,
    photoUrl: row.photo_url,
    profileId: row.profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    type: row.type,
    status: row.status,
    actor: row.actor,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

function rowToRewardClaim(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    rewardId: row.reward_id,
    code: row.code,
    pointsSpent: row.points_spent,
    status: row.status,
    createdAt: row.created_at,
  };
}

function safeLegacyDb() {
  if (!existsSync(legacyJsonPath)) return null;
  try {
    const legacy = JSON.parse(readFileSync(legacyJsonPath, 'utf8'));
    if (!Array.isArray(legacy.reports) || !Array.isArray(legacy.events)) return null;
    return legacy;
  } catch {
    return null;
  }
}

function replaceDb(nextDb) {
  sqlite.prepare('DELETE FROM reward_claims').run();
  sqlite.prepare('DELETE FROM events').run();
  sqlite.prepare('DELETE FROM reports').run();
  for (const report of nextDb.reports) insertReport.run({ ...report, profileId: report.profileId ?? 'demo-profile' });
  for (const event of nextDb.events) insertEvent.run(event);
  for (const claim of nextDb.rewardClaims ?? []) insertRewardClaim.run(claim);
}

const reportCount = sqlite.prepare('SELECT COUNT(*) AS count FROM reports').get().count;
if (reportCount === 0) {
  replaceDb(safeLegacyDb() ?? seed);
}

export async function readDb() {
  return {
    reports: sqlite.prepare('SELECT * FROM reports ORDER BY created_at DESC').all().map(rowToReport),
    events: sqlite.prepare('SELECT * FROM events ORDER BY created_at DESC').all().map(rowToEvent),
    rewardClaims: sqlite.prepare('SELECT * FROM reward_claims ORDER BY created_at DESC').all().map(rowToRewardClaim),
  };
}

export async function writeDb(nextDb) {
  const writeTransaction = sqlite.transaction(replaceDb);
  writeTransaction(nextDb);
}

export async function updateDb(updater) {
  const updateTransaction = sqlite.transaction(() => {
    const db = {
      reports: sqlite.prepare('SELECT * FROM reports ORDER BY created_at DESC').all().map(rowToReport),
      events: sqlite.prepare('SELECT * FROM events ORDER BY created_at DESC').all().map(rowToEvent),
      rewardClaims: sqlite.prepare('SELECT * FROM reward_claims ORDER BY created_at DESC').all().map(rowToRewardClaim),
    };
    const patch = updater(db);
    const nextDb = {
      reports: patch.reports ?? db.reports,
      events: patch.events ?? db.events,
      rewardClaims: patch.rewardClaims ?? db.rewardClaims,
    };
    replaceDb(nextDb);
    return nextDb;
  });

  return updateTransaction();
}
