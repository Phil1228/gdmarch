import http from 'node:http';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  listPlayers, addPlayer, deletePlayer, getPlayer, searchPlayers,
  createEvent, getEvent, listEvents, setEventStatus,
  registerPlayer, removeRegistration, listRegistrations, registeredPlayerIds, listTeams, listMatches, renameTeam,
} from './db.mjs';
import { buildTeams, buildRoundTeams, buildMatchups, buildAllRounds, recordMatch, standings } from './tournament.mjs';
import * as auth from './auth.mjs';

const PORT = process.env.PORT || 3000;

export async function handleRequest(req, res) {
  const send = (code, obj) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const getOrigin = (req) => {
    const fwdHost = req.headers?.['x-forwarded-host'];
    const fwdProto = req.headers?.['x-forwarded-proto'] || 'https';
    if (fwdHost) return `${fwdProto}://${fwdHost}`;
    return url.origin;
  };
  const j = () => readBody(req);

  // ---------- 靜態頁: 首頁比賽列表 / 後台 / 掃碼報名 ----------
  if (p === '/' || p === '/index.html') {
    return serveHtml(res, join(__dirname, 'public', 'index.html'), {});
  }
  if (p === '/login' || p === '/login.html') {
    return serveHtml(res, join(__dirname, 'public', 'login.html'), {});
  }
  if (p === '/admin' || p === '/admin.html') {
    return serveHtml(res, join(__dirname, 'public', 'admin.html'), {});
  }
  if (p.startsWith('/events/')) {
    const eventId = p.split('/')[2] || '';
    return serveHtml(res, join(__dirname, 'public', 'event.html'), { eventId });
  }
  if (p.startsWith('/view/')) {
    const eventId = p.split('/')[2] || '';
    return serveHtml(res, join(__dirname, 'public', 'view.html'), { eventId });
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
    const token = auth.tokenFromReq(req);
  const me = await auth.getUserByToken(token); // 當前用戶 (null 表示未登入)

  // ---------- 用戶認證 ----------
  if (p === '/api/auth/register' && req.method === 'POST') {
    const b = await j();
    try {
      const uid = await auth.register(b.username, b.password, b.displayName);
      const { token: tk, user } = await auth.login(b.username, b.password);
      res.setHeader('Set-Cookie', `gd_token=${tk}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}`);
      return send(201, { user });
    } catch (e) { return send(400, { error: e.message }); }
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await j();
    try {
      const { token: tk, user } = await auth.login(b.username, b.password);
      res.setHeader('Set-Cookie', `gd_token=${tk}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}`);
      return send(200, { user });
    } catch (e) { return send(401, { error: e.message }); }
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    await auth.logout(token);
    res.setHeader('Set-Cookie', 'gd_token=; Path=/; HttpOnly; Max-Age=0');
    return send(200, { ok: true });
  }
  if (p === '/api/auth/me' && req.method === 'GET') {
    return send(200, { user: me });
  }
  // 管理員: 用戶列表 / 重設密碼 / 刪除
  if (p === '/api/admin/users' && req.method === 'GET') {
    if (!me || me.role !== 'admin') return send(403, { error: '需要管理員權限' });
    return send(200, await auth.listUsers());
  }
  if (p.match(/\/api\/admin\/users\/\d+\/reset$/) && req.method === 'POST') {
    if (!me || me.role !== 'admin') return send(403, { error: '需要管理員權限' });
    const uid = Number(p.split('/')[4]);
    try { await auth.resetPassword(uid, (await j()).password); return send(200, { ok: true }); }
    catch (e) { return send(400, { error: e.message }); }
  }
  if (p.match(/\/api\/admin\/users\/\d+$/) && req.method === 'DELETE') {
    if (!me || me.role !== 'admin') return send(403, { error: '需要管理員權限' });
    const uid = Number(p.split('/')[4]);
    await auth.deleteUser(uid);
    return send(200, { ok: true });
  }

  // ---------- 名單 ----------
    if (p === '/api/players' && req.method === 'GET')
      return send(200, await listPlayers());
    if (p.startsWith('/api/players/') && req.method === 'GET' && /^\/api\/players\/\d+$/.test(p)) {
      const id = Number(p.split('/').pop());
      return send(200, await getPlayer(id));
    }
    // 選手庫搜尋 (q=關鍵字)
    if (p === '/api/players/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      return send(200, await searchPlayers(q));
    }
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
      const vis = b.ruleConfig?.visibility || 'public';
      if (vis === 'private' && !me) return send(401, { error: '私享賽需先登入才能建立' });
      const ruleConfig = { ...(b.ruleConfig || {}), visibility: vis, owner_id: vis === 'private' ? (me?.id ?? null) : null };
      const id = await createEvent(b.name, ruleConfig);
      return send(201, { id });
    }
    if (p === '/api/events' && req.method === 'GET') {
      const all = await listEvents();
      // 未登入只看公開賽; 登入者看公開 + 自己私享; admin 看全部
      const filtered = (me && me.role === 'admin')
        ? all
        : all.filter(e => e.visibility === 'public' || (me && e.owner_id === me.id));
      return send(200, filtered);
    }
    if (p.startsWith('/api/events/') && p.endsWith('/detail') && req.method === 'GET') {
      const id = Number(p.split('/')[3]);
      return send(200, await getEvent(id));
    }
    if (p.startsWith('/api/events/') && p.endsWith('/status') && req.method === 'POST') {
      const id = Number(p.split('/')[3]);
      const b = await j();
      await setEventStatus(id, b.status);
      return send(200, { ok: true, status: b.status });
    }
    // 報名 QR 碼 (回傳 PNG dataURL)
    if (p.startsWith('/api/events/') && p.endsWith('/qrcode') && req.method === 'GET') {
      const id = Number(p.split('/')[3]);
      const link = `${getOrigin(req)}/r/${id}`;
      const dataUrl = await QRCode.toDataURL(link, { margin: 2, width: 360 });
      return send(200, { link, qrcode: dataUrl });
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
    // ---------- 賽事專屬: 名單 (player 屬於某場比賽) ----------
    if (p.startsWith('/api/events/') && p.endsWith('/players') && req.method === 'POST') {
      const eventId = Number(p.split('/')[3]);
      const b = await j();
      const { id, badge } = await addPlayer(b.name, b.contact, b.note, b.source || 'manual');
      await registerPlayer(eventId, id);
      return send(201, { id, badge });
    }
    if (p.startsWith('/api/events/') && p.match(/\/players\/\d+$/) && req.method === 'DELETE') {
      const parts = p.split('/');
      const eventId = Number(parts[3]);
      const pid = Number(parts[5]);
      await removeRegistration(eventId, pid);
      return send(200, { ok: true });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/import') && req.method === 'POST') {
      const eventId = Number(p.split('/')[3]);
      const b = await j();
      const lines = (b.csv || '').trim().split('\n');
      const added = [];
      for (const line of lines) {
        const cols = line.split(/[,;\t]/).map((s) => s.trim());
        const name = cols[0];
        if (!name) continue;
        const { id, badge } = await addPlayer(name, cols[1] || null, cols[2] || null, 'import');
        await registerPlayer(eventId, id);
        added.push({ id, badge, name });
      }
      return send(201, { added });
    }

    // ---------- 掃碼自行錄入 ----------
    if (p === '/api/events/self-register' && req.method === 'POST') {
      const b = await j();
      const ev = await getEvent(b.eventId);
      if (ev?.visibility === 'private' && !me) return send(401, { error: '私享賽需先登入才能報名' });
      if (ev?.status === 'started' || ev?.status === 'closed') {
        return send(403, { error: '比賽已經開始，無法報名' });
      }
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
    // 一鍵生成所有輪次對陣
    if (p.startsWith('/api/events/') && p.endsWith('/build-all') && req.method === 'POST') {
      const eventId = Number(p.split('/')[3]);
      const ev = await getEvent(eventId);
      if (ev?.status === 'closed') return send(403, { error: '比賽已結束，不可生成或重置對陣' });
      const r = await buildAllRounds(eventId);
      return send(201, r);
    }
    if (p.startsWith('/api/events/') && p.endsWith('/teams') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      const roundNo = url.searchParams.get('round') ? Number(url.searchParams.get('round')) : null;
      return send(200, await listTeams(eventId, roundNo));
    }
    // 改隊名 (僅開放報名中可改)
    if (p.match(/\/api\/events\/\d+\/teams\/\d+\/rename$/) && req.method === 'POST') {
      const parts = p.split('/');
      const eventId = Number(parts[3]); const teamId = Number(parts[5]);
      const ev = await getEvent(eventId);
      if (ev?.status !== 'open') return send(403, { error: '比賽已開始或已結束，隊名不可再修改' });
      const b = await j();
      await renameTeam(teamId, b.name);
      return send(200, { ok: true });
    }
    if (p.startsWith('/api/events/') && p.endsWith('/matches') && req.method === 'GET') {
      const eventId = Number(p.split('/')[3]);
      const roundNo = url.searchParams.get('round') ? Number(url.searchParams.get('round')) : null;
      return send(200, await listMatches(eventId, roundNo));
    }

    // ---------- 記分 ----------
    if (p === '/api/matches' && req.method === 'POST') {
      const b = await j();
      const r = await recordMatch(b.matchId, b.levelA, b.levelB);
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
  auth.ensureSeedAdmin().catch(() => {});
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => console.log(`gdmarch server on http://localhost:${PORT}`));
}

// Vercel: 第一次請求時確保種子 admin 存在 (幂等)
let _seeded = false;
export default async function handleRequestWithSeed(req, res) {
  if (!_seeded) { _seeded = true; await auth.ensureSeedAdmin().catch(() => {}); }
  return handleRequest(req, res);
}
