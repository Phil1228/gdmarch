// Migration: drop old gdmarch dev tables on polybox-db, rebuild new schema.
// SAFETY: only drops tables in the GDMRACH_OLD set; never touches minimaths tables.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = await import('../db.mjs');
const client = db.default;

const GDMRACH_OLD = new Set(['players', 'events', 'registrations', 'groups', 'matches']);

// 1. list current tables, confirm what we are about to drop
const cur = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map(r => r.name);
const toDrop = cur.filter(t => GDMRACH_OLD.has(t));
console.log('當前 polybox-db tables:', cur.join(', '));
console.log('將 drop 的 gdmarch 舊表:', toDrop.join(', ') || '(無)');

// 2. drop (reverse FK order not needed for plain drop; use IF EXISTS)
for (const t of toDrop) {
  await client.execute(`DROP TABLE IF EXISTS ${t}`);
  console.log('  dropped:', t);
}

// 3. rebuild new schema
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) {
  const t = s.trim();
  if (!t) continue;
  try { await client.execute(t); }
  catch (e) { if (!String(e.message).includes('not an error')) throw e; }
}
console.log('✅ 新 schema 已建');

// 4. verify new tables exist with correct columns
const after = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map(r => r.name);
console.log('重建後全部 tables:', after.join(', '));
const pcols = (await client.execute('PRAGMA table_info(players)')).rows.map(r => r.name);
console.log('players 欄位:', pcols.join(', '));
const tcols = (await client.execute('PRAGMA table_info(matches)')).rows.map(r => r.name);
console.log('matches 欄位:', tcols.join(', '));

// 5. confirm minimaths tables untouched
const miniOk = after.includes('users') && after.includes('uno_players');
console.log('minimaths 表仍在 (users/uno_players):', miniOk);

process.exit(0);
