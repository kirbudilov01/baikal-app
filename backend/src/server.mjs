import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readDb, updateDb } from './store.mjs';
import { assertCanTransition, createDomainError, publicStatus, reportStatuses } from './status-machine.mjs';

const port = Number(process.env.PORT ?? 4000);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-id',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
    adminAction: reportStatuses[report.status].adminAction,
    events: events.filter((event) => event.reportId === report.id),
  };
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
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'baikal-backend', time: new Date().toISOString() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/statuses') {
    sendJson(response, 200, { statuses: Object.entries(reportStatuses).map(([code]) => publicStatus(code)) });
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
            actor: 'mobile:user',
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

  const statusMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/status$/);
  if (request.method === 'POST' && statusMatch) {
    const reportId = statusMatch[1];
    const payload = await readJson(request);
    const adminId = request.headers['x-admin-id'] || 'admin:local';

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
    const db = await readDb();
    const report = db.reports.find((item) => item.id === adminReportMatch[1]);
    if (!report) throw createDomainError(404, 'Report not found');
    sendJson(response, 200, { report: adminReport(report, db.events) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/reports') {
    const db = await readDb();
    sendJson(response, 200, { reports: db.reports.map((report) => adminReport(report, db.events)) });
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

