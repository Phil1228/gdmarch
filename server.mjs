import http from 'node:http';
import {
  listPlayers, addPlayer, deletePlayer,
  createEvent, listEvents, registerPlayer, listRegistrations,
} from './db.mjs';
import { createGroups, listGroups, recordMatch, standings } from './tournament.mjs';

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // 名單
    if (p === '/api/players' && req.method === 'GET') {
      return send(200, await listPlayers());
    }
    if (p === '/api/players' && req.method === 'POST') {
      const b = await readBody(req);
      const id = await addPlayer(b.name, b.contact, b.note);
      return send(201, { id });
    }
    if (p.startsWith('/api/players/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      await deletePlayer(Number(id));
      return send(200, { ok: true });
    }
    // 賽事
    if (p === '/api/events' && req.method === 'POST') {
      const b = await readBody(req);
      const id = await createEvent(b.name, b.ruleConfig || {});
      return send(201, { id });
    }
    if (p === '/api/events' && req.method === 'GET') {
      return send(200, await listEvents());
    }
    // 報名
    if (p === '/api/registrations' && req.method === 'POST') {
      const b = await readBody(req);
      await registerPlayer(b.eventId, b.playerId);
      return send(201, { ok: true });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/registrations') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      return send(200, await listRegistrations(eventId));
    }
    // 分組
    if (p === '/api/groups' && req.method === 'POST') {
      const b = await readBody(req);
      const groups = await createGroups(b.eventId, b.roundNo, b.groupSize || 4);
      return send(201, { groups });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/groups') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      const roundNo = url.searchParams.get('round') ? Number(url.searchParams.get('round')) : null;
      return send(200, await listGroups(eventId, roundNo));
    }
    // 積分
    if (p === '/api/matches' && req.method === 'POST') {
      const b = await readBody(req);
      const id = await recordMatch(b.eventId, b.roundNo, b.teamA, b.teamB, b.scoreA, b.scoreB, b.pointsA, b.pointsB);
      return send(201, { id });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/standings') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      return send(200, await standings(eventId));
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    return send(500, { error: e.message });
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d ? JSON.parse(d) : {}));
    req.on('error', reject);
  });
}

server.listen(PORT, () => console.log(`guandan server on http://localhost:${PORT}`));
