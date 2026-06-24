import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'db.json');

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

export async function readDb() {
  try {
    return JSON.parse(await readFile(dbPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeDb(seed);
    return structuredClone(seed);
  }
}

export async function writeDb(nextDb) {
  await mkdir(dirname(dbPath), { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(nextDb, null, 2)}\n`);
  await rename(tmpPath, dbPath);
}

export async function updateDb(updater) {
  const db = await readDb();
  const nextDb = await updater(db);
  await writeDb(nextDb);
  return nextDb;
}

