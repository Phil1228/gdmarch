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

// 運勢籤文：四等階各數則（title/text/yi宜/ji忌）—— 以掼蛋牌運為主軸
const FORTUNE_POOL = [
  [ // 大吉
    { title:'天胡開局', text:'今日手氣如神助，起手便見王牌連環。炸彈信手拈來，逢壓必能反制，牌搭子默契满分。', yi:'搶莊、埋炸、連環壓、放生搭子', ji:'浪叫真炸、輕易拆王、戀戰不收' },
    { title:'炸彈盈門', text:'牌運亨通，關鍵時刻總有炸兜底。接風順暢，對家送牌如約而至，穩坐上游無懸念。', yi:'控場、留炸收尾、配合對家', ji:'早洩炸、賭運氣、搶著出牌' },
    { title:'上游穩握', text:'今日必居頭遊。牌型齊整，單張不卡手，逢山開路遇水疊橋，對家亦得力。', yi:'首攻、洗牌重排、組隊開黑', ji:'猶豫、讓賢、散夥單打' },
  ],
  [ // 中吉
    { title:'漸入佳境', text:'起手平淡，越打越順。中盤抓到節奏，炸彈雖少但落點精準，穩穩保中游。', yi:'中段發力、記牌、控小牌', ji:'開局冒進、硬接大牌、內訌' },
    { title:'搭子同心', text:'與對家默契漸起，送牌接風皆有默契。牌運中上，關鍵一分靠配合補足。', yi:'喂牌、讓對家上游、溝通暗號', ji:'搶對家牌、單幹、誤判牌路' },
    { title:'暗藏一炸', text:'表面牌型尋常，實則藏著一記悶炸。耐心等到終盤，一舉翻盤。', yi:'蟄伏、留大牌、終局收網', ji:'提前亮底、心急出炸、分心' },
    { title:'順風小贏', text:'手氣溫和向好，少有大起大落。穩紮穩打，今日小贏即是福。', yi:'保守壓、記住出過的牌、早脫手', ji:'貪大、戀戰、追輸翻本' },
  ],
  [ // 吉
    { title:'牌路尚通', text:'手氣中規中矩，牌型能走通。無驚無險，靠基本功與算牌便能守住位次。', yi:'算牌、控場、穩出順子', ji:'賭運、拆關鍵搭、硬碰炸' },
    { title:'苦盡甘來', text:'前半程手風稍澀，後段轉順。撐過僵局，終見一線生機。', yi:'熬牌、保留實力、等轉機', ji:'焦躁、早洩火力、互相埋怨' },
    { title:'平手可期', text:'今日宜求穩，不輸即為贏。牌運平平，靠紀律壓過手風不順。', yi:'防守、記炸、護對家', ji:'冒險、賭氣叫牌、輕敵' },
    { title:'小炸偶現', text:'偶爾來記小炸救場，整體平穩。不貪不躁，位次可保中上。', yi:'見好就收、控節奏、喂對家', ji:'囤炸不用、強出頭遊、分心聊天' },
  ],
  [ // 小吉
    { title:'手風待轉', text:'今日牌運偏澀，起手多散張。宜養精蓄銳，觀察對手路數，伺機而動。', yi:'防守、記牌、學習牌路、早脫單', ji:'硬拚、賭炸、搶上游、熬夜戰' },
    { title:'以靜制動', text:'手氣清淡，正宜沉住氣。少輸當贏，保存實力，來日牌運自回。', yi:'觀戰、復盤、早睡養神', ji:'戀戰、情緒化叫牌、借錢上桌' },
    { title:'練牌養運', text:'今日非衝分之日，恰可練拆牌與記牌。運氣淡，功夫到，運自轉。', yi:'打練習局、研究牌型、讀譜', ji:'賭氣翻本、連莊不歇、忽視對家' },
  ],
];

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

    // ---------- 今日運勢籤 ----------
    if (p === '/api/fortune' && req.method === 'GET') {
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0').toString().split(',')[0].trim();
      const now = new Date();
      const o = now.getTime() + (now.getTimezoneOffset() * 60000) + (8 * 3600000); // UTC+8
      const d = new Date(o);
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      const uid = me?.id ?? 'anon';
      const ua = req.headers['user-agent'] || '';
      const lang = req.headers['accept-language'] || '';
      // 複合特徵字串（同日同用戶固定；IP/UA/語言作為設備/網路特徵）
      const seedStr = `loong-click|${ip}|${dateKey}|${uid}|${ua}|${lang}`;
      // FNV-1a 32-bit 哈希
      let h = 0x811c9dc5;
      for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const seed = (h >>> 0);
      // 加權等階：大吉10% 中吉30% 吉40% 小吉20%
      const r = seed % 100;
      let level, levelIdx;
      if (r < 10) { level = '大吉'; levelIdx = 0; }
      else if (r < 40) { level = '中吉'; levelIdx = 1; }
      else if (r < 80) { level = '吉'; levelIdx = 2; }
      else { level = '小吉'; levelIdx = 3; }
      const fortunes = FORTUNE_POOL[levelIdx];
      const pick = fortunes[seed % fortunes.length];
      return send(200, {
        level, levelIdx, date: dateKey, seed,
        title: pick.title, text: pick.text, yi: pick.yi, ji: pick.ji,
        loggedIn: !!me,
      });
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
      await registerPlayer(b.eventId, b.playerId, b.teamNo ?? null);
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
      await registerPlayer(eventId, id, b.teamNo ?? null);
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
        const cols = line.split(/[,\t]/).map((s) => s.trim());
        const name = cols[0];
        if (!name) continue;
        const { id, badge } = await addPlayer(name, cols[1] || null, cols[2] || null, 'import');
        const teamNo = cols[3] ? Number(cols[3]) : null;
        await registerPlayer(eventId, id, teamNo);
        added.push({ id, badge, name, teamNo });
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
