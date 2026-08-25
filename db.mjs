import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || `file:${join(__dirname, 'db', 'guandan.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;

let _client = null;
let _ensured = false;
function getClient() {
  if (!_client) _client = createClient(authToken ? { url, authToken } : { url });
  return _client;
}
// 補齊舊表缺失欄位 (線上 polybox-db 不會重跑 schema.sql)
async function ensureSchema() {
  if (_ensured) return;
  _ensured = true;
  for (const col of ['level_a', 'level_b']) {
    try { await client.execute(`ALTER TABLE matches ADD COLUMN ${col} TEXT`); }
    catch { /* 已存在則忽略 */ }
  }
  try { await client.execute("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'open'"); }
  catch { /* 已存在則忽略 */ }
  try { await client.execute("ALTER TABLE teams ADD COLUMN name TEXT"); }
  catch { /* 已存在則忽略 */ }
  try { await client.execute("ALTER TABLE events ADD COLUMN visibility TEXT DEFAULT 'public'"); }
  catch { /* 已存在則忽略 */ }
  try { await client.execute("ALTER TABLE events ADD COLUMN owner_id INTEGER"); }
  catch { /* 已存在則忽略 */ }
  // 用戶系統表 (與共用 DB 中其他 app 的 users 表區隔, 用 gd_ 前綴)
  await client.execute("CREATE TABLE IF NOT EXISTS gd_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT, role TEXT DEFAULT 'user', created_at TEXT DEFAULT (datetime('now')))");
  await client.execute("CREATE TABLE IF NOT EXISTS gd_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT)");
}
const client = new Proxy({}, {
  get(_t, prop) {
    return async (...args) => {
      await ensureSchema();
      return getClient()[prop](...args);
    };
  },
});
export default client;

// ---------- players (名單管理) ----------
// 自動發 4 位號牌: 從 0001 往上找第一個未被佔用的
async function nextBadge() {
  const rows = (await client.execute('SELECT badge_no FROM players WHERE badge_no IS NOT NULL')).rows;
  const used = new Set(rows.map((r) => r.badge_no));
  for (let i = 1; i <= 9999; i++) {
    const cand = String(i).padStart(4, '0');
    if (!used.has(cand)) return cand;
  }
  throw new Error('badge pool exhausted');
}
export async function addPlayer(name, contact = null, note = null, source = 'manual') {
  // 去重: 同名 (不分來源) 視為同一選手, 回傳現有 id/badge 不再新建
  const ex = (await client.execute({ sql: 'SELECT id, badge_no FROM players WHERE name = ?', args: [name] })).rows[0];
  if (ex) return { id: ex.id, badge: ex.badge_no };
  const badge = await nextBadge();
  const r = await client.execute({
    sql: 'INSERT INTO players (name, badge_no, contact, note, source) VALUES (?, ?, ?, ?, ?)',
    args: [name, badge, contact, note, source],
  });
  return { id: Number(r.lastInsertRowid), badge };
}
export async function searchPlayers(q) {
  if (!q || !q.trim()) return [];
  const rows = (await client.execute({ sql: 'SELECT id, name, badge_no, contact FROM players WHERE name LIKE ? ORDER BY badge_no LIMIT 20', args: ['%' + q.trim() + '%'] })).rows;
  return rows;
}
export async function listPlayers() {
  return (await client.execute('SELECT * FROM players ORDER BY badge_no')).rows;
}
export async function getPlayer(id) {
  const r = await client.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [id] });
  return r.rows[0];
}
export async function deletePlayer(id) {
  await client.execute({ sql: 'DELETE FROM players WHERE id = ?', args: [id] });
}

// ---------- events ----------
export async function createEvent(name, ruleConfig = {}) {
  // 業務校驗: 按隊計算時人數必須為偶數 (每隊 2 人)
  if (ruleConfig?.scoring_mode === 'team' && ruleConfig?.participant_count != null) {
    if (ruleConfig.participant_count % 2 !== 0) {
      throw new Error('按隊計算時人數必須為偶數');
    }
  }
  const r = await client.execute({
    sql: 'INSERT INTO events (name, rule_config, status, visibility, owner_id) VALUES (?, ?, ?, ?, ?)',
    args: [name, JSON.stringify(ruleConfig), 'open', ruleConfig?.visibility || 'public', ruleConfig?.owner_id ?? null],
  });
  return Number(r.lastInsertRowid);
}
export async function setEventStatus(id, status) {
  await client.execute({ sql: 'UPDATE events SET status = ? WHERE id = ?', args: [status, id] });
}
export async function getEvent(id) {
  const r = await client.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
  const e = r.rows[0];
  if (e) { e.rule = JSON.parse(e.rule_config); e.visibility = e.visibility || 'public'; }
  return e;
}
export async function listEvents() {
  const rows = (await client.execute('SELECT * FROM events ORDER BY id')).rows;
  for (const e of rows) e.visibility = e.visibility || 'public';
  return rows;
}

// ---------- registrations (報名) ----------
export async function registerPlayer(eventId, playerId) {
  await client.execute({
    sql: 'INSERT OR IGNORE INTO registrations (event_id, player_id) VALUES (?, ?)',
    args: [eventId, playerId],
  });
}
export async function removeRegistration(eventId, playerId) {
  await client.execute({
    sql: 'DELETE FROM registrations WHERE event_id = ? AND player_id = ?',
    args: [eventId, playerId],
  });
}
export async function listRegistrations(eventId) {
  return (await client.execute({
    sql: `SELECT r.id, r.player_id, p.name, p.badge_no, p.contact, r.status
          FROM registrations r JOIN players p ON p.id = r.player_id
          WHERE r.event_id = ? ORDER BY p.badge_no`,
    args: [eventId],
  })).rows;
}
export async function registeredPlayerIds(eventId) {
  const rows = (await client.execute({
    sql: 'SELECT player_id FROM registrations WHERE event_id = ?', args: [eventId],
  })).rows;
  return rows.map((r) => r.player_id);
}

// ---------- teams ----------
export async function createTeam(eventId, memberIds, roundNo = null, name = null) {
  if (!name) {
    const n = (await client.execute({ sql: 'SELECT COUNT(*) AS c FROM teams WHERE event_id = ?', args: [eventId] })).rows[0].c;
    name = '第 ' + (n + 1) + ' 隊';
  }
  const r = await client.execute({
    sql: 'INSERT INTO teams (event_id, round_no, member_ids, name) VALUES (?, ?, ?, ?)',
    args: [eventId, roundNo, JSON.stringify(memberIds), name],
  });
  return Number(r.lastInsertRowid);
}

// 改名 (僅開放報名中可改; 由呼叫方檢查 status)
export async function renameTeam(teamId, name) {
  await client.execute({ sql: 'UPDATE teams SET name = ? WHERE id = ?', args: [name, teamId] });
}
export async function listMatches(eventId, roundNo = null) {
  const sql = roundNo
    ? 'SELECT * FROM matches WHERE event_id = ? AND round_no = ? ORDER BY id'
    : 'SELECT * FROM matches WHERE event_id = ? ORDER BY round_no, id';
  const args = roundNo ? [eventId, roundNo] : [eventId];
  return (await client.execute({ sql, args })).rows;
}
export async function listTeams(eventId, roundNo = null) {
  const sql = roundNo
    ? 'SELECT * FROM teams WHERE event_id = ? AND round_no = ?'
    : 'SELECT * FROM teams WHERE event_id = ?';
  const args = roundNo ? [eventId, roundNo] : [eventId];
  const teams = (await client.execute({ sql, args })).rows;
  const players = (await client.execute('SELECT id, name, badge_no FROM players')).rows;
  const pmap = {};
  for (const p of players) pmap[p.id] = p;
  return teams.map((t) => ({
    ...t,
    name: t.name || ('第 ' + (t.id) + ' 隊'),
    members: JSON.parse(t.member_ids).map((mid) => ({
      id: mid,
      name: pmap[mid]?.name || '?',
      badge: pmap[mid]?.badge_no || '',
    })),
  }));
}
export async function playersMap() {
  const rows = (await client.execute('SELECT id, name, badge_no FROM players')).rows;
  const m = {};
  for (const r of rows) m[r.id] = r;
  return m;
}
