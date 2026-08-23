import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || `file:${join(__dirname, 'db', 'guandan.db')}`;
const client = createClient({ url });
export default client;

// ---------- players (名單管理) ----------
export async function listPlayers() {
  return (await client.execute('SELECT * FROM players ORDER BY id')).rows;
}
export async function addPlayer(name, contact = null, note = null) {
  const r = await client.execute({
    sql: 'INSERT INTO players (name, contact, note) VALUES (?, ?, ?)',
    args: [name, contact, note],
  });
  return r.lastInsertRowid;
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
  return r.lastInsertRowid;
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
    sql: `SELECT r.id, r.player_id, p.name, p.contact, r.status
          FROM registrations r JOIN players p ON p.id = r.player_id
          WHERE r.event_id = ? ORDER BY r.id`,
    args: [eventId],
  })).rows;
}
