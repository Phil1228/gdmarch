import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  listPlayers, addPlayer, deletePlayer, getPlayer,
  createEvent, getEvent, listEvents,
  registerPlayer, listRegistrations, registeredPlayerIds, listTeams,
} from './db.mjs';
import { buildTeams, buildRoundTeams, buildMatchups, recordMatch, standings } from './tournament.mjs';

const PORT = process.env.PORT || 3000;

export async function handleRequest(req, res) {
  const send = (code, obj) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const j = () => readBody(req);

  // ---------- 靜態頁: 掃碼報名 ----------
  if (p === '/' || p === '/index.html') {
    return serveHtml(res, join(__dirname, 'public', 'register.html'), { eventId: '', eventName: '' });
  }
  if (p.startsWith('/r/')) {
    const eventId = p.split('/')[2];
    try {
      const ev = await getEvent(Number(eventId));
      return serveHtml(res, join(__dirname, 'public', 'register.html'), { eventId, eventName: ev?.name || '' });
    } catch {
      return serveHtml(res, join(__dirname, 'public', 'register.html'), { eventId, eventName: '' });
    }
  }

  try {
    // ---------- 名單 ----------
    if (p === '/api/players' && req.method === 'GET')
      return send(200, await listPlayers());
    if (p === '/api/players' && req.method === 'POST') {
      const b = await j();
      const { id, badge } = await addPlayer(b.name, b.contact, b.note, b.source || 'manual');
      return send(201, { id, badge });
    }
    if (p.startsWith('/api/players/') && req.method === 'DELETE') {
      await deletePlayer(Number(p.split('/').pop()));
      return send(200, { ok: true });
    }

    // ---------- 賽事 ----------
    if (p === '/api/events' && req.method === 'POST') {
      const b = await j();
      const id = await createEvent(b.name, b.ruleConfig || {});
      return send(201, { id });
    }
    if (p === '/api/events' && req.method === 'GET')
      return send(200, await listEvents());
    if (p.startsWith('/api/events/') && p.endsWith('/detail') && req.method === 'GET') {
      const id = Number(p.split('/')[3]);
      return send(200, await getEvent(id));
    }

    // ---------- 報名 ----------
    if (p === '/api/registrations' && req.method === 'POST') {
      const b = await j();
      await registerPlayer(b.eventId, b.playerId);
      return send(201, { ok: true });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/registrations') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      return send(200, await listRegistrations(eventId));
    }

    // ---------- 掃碼自行錄入 ----------
    if (p === '/api/events/self-register' && req.method === 'POST') {
      const b = await j();
      const { id, badge } = await addPlayer(b.name, b.contact, b.note, 'self');
      await registerPlayer(b.eventId, id);
      return send(201, { id, badge });
    }

    // ---------- CSV 導入 ----------
    if (p === '/api/import-players' && req.method === 'POST') {
      const b = await j();
      const lines = (b.csv || '').trim().split('\n');
      const added = [];
      for (const line of lines) {
        const cols = line.split(/[,;\t]/).map((s) => s.trim());
        const name = cols[0];
        if (!name) continue;
        const { id, badge } = await addPlayer(name, cols[1] || null, cols[2] || null, 'import');
        added.push({ id, badge, name });
      }
      return send(201, { added });
    }

    // ---------- 分組 ----------
    if (p === '/api/build-teams' && req.method === 'POST') {
      const b = await j();
      const ids = b.scoringMode === 'team'
        ? await buildTeams(b.eventId)
        : await buildRoundTeams(b.eventId, b.roundNo);
      return send(201, { teamIds: ids });
    }
    if (p === '/api/matchups' && req.method === 'POST') {
      const b = await j();
      const r = await buildMatchups(b.eventId, b.roundNo, b.teamIds);
      return send(201, r);
    }
    if (p.startsWith('/api/events/') && p.endsWith('/teams') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      const roundNo = url.searchParams.get('round') ? Number(url.searchParams.get('round')) : null;
      return send(200, await listTeams(eventId, roundNo));
    }

    // ---------- 記分 ----------
    if (p === '/api/matches' && req.method === 'POST') {
      const b = await j();
      const r = await recordMatch(b.matchId, b.winner, b.scoreA, b.scoreB);
      return send(201, r);
    }
    if (p.startsWith('/api/events/') && p.endsWith('/standings') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      return send(200, await standings(eventId));
    }

    return send(404, { error: 'not found' });
  } catch (e) {
    return send(500, { error: e.message });
  }
}

async function serveHtml(res, filepath, ctx) {
  try {
    let html = await readFile(filepath, 'utf-8');
    html = html.replace(/__EVENT_ID__/g, ctx.eventId || '')
               .replace(/__EVENT_NAME__/g, ctx.eventName || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d ? JSON.parse(d) : {}));
    req.on('error', reject);
  });
}

// 本地開發時啟動 listen; Vercel 不透過這條路徑 (VERCEL env 設了就不 listen)
if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => console.log(`gdmarch server on http://localhost:${PORT}`));
}

// Vercel function 入口
export default handleRequest;
