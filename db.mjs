import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || `file:${join(__dirname, 'db', 'guandan.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;

let _client = null;
function getClient() {
  if (!_client) _client = createClient(authToken ? { url, authToken } : { url });
  return _client;
}
const client = new Proxy({}, {
  get(_t, prop) {
    return (...args) => getClient()[prop](...args);
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
  const badge = await nextBadge();
  const r = await client.execute({
    sql: 'INSERT INTO players (name, badge_no, contact, note, source) VALUES (?, ?, ?, ?, ?)',
    args: [name, badge, contact, note, source],
  });
  return { id: Number(r.lastInsertRowid), badge };
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
  const r = await client.execute({
    sql: 'INSERT INTO events (name, rule_config) VALUES (?, ?)',
    args: [name, JSON.stringify(ruleConfig)],
  });
  return Number(r.lastInsertRowid);
}
export async function getEvent(id) {
  const r = await client.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
  const e = r.rows[0];
  if (e) e.rule = JSON.parse(e.rule_config);
  return e;
}
export async function listEvents() {
  return (await client.execute('SELECT * FROM events ORDER BY id')).rows;
}

// ---------- registrations (報名) ----------
export async function registerPlayer(eventId, playerId) {
  await client.execute({
    sql: 'INSERT OR IGNORE INTO registrations (event_id, player_id) VALUES (?, ?)',
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
export async function createTeam(eventId, memberIds, roundNo = null) {
  const r = await client.execute({
    sql: 'INSERT INTO teams (event_id, round_no, member_ids) VALUES (?, ?, ?)',
    args: [eventId, roundNo, JSON.stringify(memberIds)],
  });
  return Number(r.lastInsertRowid);
}
export async function listTeams(eventId, roundNo = null) {
  const sql = roundNo
    ? 'SELECT * FROM teams WHERE event_id = ? AND round_no = ?'
    : 'SELECT * FROM teams WHERE event_id = ?';
  const args = roundNo ? [eventId, roundNo] : [eventId];
  return (await client.execute({ sql, args })).rows;
}
