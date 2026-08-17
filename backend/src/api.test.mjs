import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const nodeBin = process.execPath;

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Server did not become healthy');
}

async function withServer(callback) {
  const dataDir = await mkdtemp(join(tmpdir(), 'baikal-api-test-'));
  const port = 4200 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(nodeBin, ['src/server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: join(dataDir, 'test.sqlite'),
      ADMIN_TOKEN: 'test-token',
      ALLOWED_ORIGINS: 'http://localhost:4173',
      SUPPORT_EMAIL: 'support@example.com',
      LEGAL_OPERATOR_NAME: 'Тестовый оператор',
      LEGAL_OPERATOR_ADDRESS: 'Иркутская область',
      LEGAL_OPERATOR_INN: '0000000000',
    },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(baseUrl);
    await callback(baseUrl);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('serves release-critical API, legal pages, and admin protection', async () => {
  await withServer(async (baseUrl) => {
    const privacy = await fetch(`${baseUrl}/privacy`);
    assert.equal(privacy.status, 200);
    assert.match(await privacy.text(), /Политика конфиденциальности/);

    const terms = await fetch(`${baseUrl}/terms`);
    assert.equal(terms.status, 200);
    assert.match(await terms.text(), /Пользовательское соглашение/);

    const rewards = await fetch(`${baseUrl}/api/rewards`).then((response) => response.json());
    assert.equal(rewards.rewards.length, 3);

    const claimed = await fetch(`${baseUrl}/api/rewards/${rewards.rewards[0].id}/claim`, {
      method: 'POST',
      headers: { 'x-profile-id': 'device:test-a' },
    }).then((response) => response.json());

    assert.match(claimed.claim.code, /^BAIKAL-/);
    assert.equal(claimed.profile.id, 'device:test-a');
    assert.equal(claimed.profile.claimedRewards.length, 1);
    assert.equal(claimed.profile.spent, rewards.rewards[0].cost);

    const repeatedClaim = await fetch(`${baseUrl}/api/rewards/${rewards.rewards[0].id}/claim`, {
      method: 'POST',
      headers: { 'x-profile-id': 'device:test-a' },
    });
    assert.equal(repeatedClaim.status, 409);

    const secondProfileClaim = await fetch(`${baseUrl}/api/rewards/${rewards.rewards[0].id}/claim`, {
      method: 'POST',
      headers: { 'x-profile-id': 'device:test-b' },
    }).then((response) => response.json());
    assert.equal(secondProfileClaim.profile.id, 'device:test-b');
    assert.equal(secondProfileClaim.profile.claimedRewards.length, 1);

    const uploaded = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contentType: 'image/png',
        dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      }),
    }).then((response) => response.json());

    assert.match(uploaded.upload.url, /^http:\/\/127\.0\.0\.1:\d+\/uploads\/.+\.png$/);
    const uploadedFile = await fetch(uploaded.upload.url);
    assert.equal(uploadedFile.status, 200);
    assert.equal(uploadedFile.headers.get('content-type'), 'image/png');

    const unauthAdmin = await fetch(`${baseUrl}/api/admin/reports`);
    assert.equal(unauthAdmin.status, 401);

    const created = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-profile-id': 'device:test-a' },
      body: JSON.stringify({
        title: 'Тестовая заявка',
        category: 'Мусор',
        description: 'Тестовая заявка с нормальным описанием проблемы',
        locationText: 'Листвянка',
        latitude: 51.8528,
        longitude: 104.8694,
        photoUrl: uploaded.upload.url,
      }),
    }).then((response) => response.json());

    assert.match(created.report.id, /^BR-/);
    assert.equal(created.report.confirmations, 0);
    assert.equal(created.report.photoUrl, uploaded.upload.url);

    const confirmed = await fetch(`${baseUrl}/api/reports/${created.report.id}/confirm`, {
      method: 'POST',
    }).then((response) => response.json());

    assert.equal(confirmed.report.id, created.report.id);
    assert.equal(confirmed.report.confirmations, 1);

    const admin = await fetch(`${baseUrl}/api/admin/reports`, {
      headers: { 'x-admin-token': 'test-token' },
    }).then((response) => response.json());

    const adminReport = admin.reports.find((report) => report.id === created.report.id);
    assert.equal(adminReport.profileId, 'device:test-a');
    assert.equal(adminReport.events.some((event) => event.type === 'confirmed'), true);
  });
});
