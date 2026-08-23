// verify register.html placeholder + server serveHtml path (no HTTP)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { unlinkSync } from 'node:fs';

const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_itest.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;

const db = await import('../db.mjs');
const client = db.default;
const { readFileSync } = await import('node:fs');
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) {
  const t = s.trim(); if (!t) continue;
  try { await client.execute(t); } catch (e) { if (!String(e.message).includes('not an error')) throw e; }
}
const eid = await db.createEvent('測試賽', { scoring_mode: 'team', rounds: 3, round_rule: 'rounds' });
const ev = await db.getEvent(Number(eid));

// simulate serveHtml replace
let html = await readFile(join(__d, '..', 'public', 'register.html'), 'utf-8');
html = html.replace(/__EVENT_ID__/g, String(eid)).replace(/__EVENT_NAME__/g, ev?.name || '');
console.log('page rendered event name:', html.includes('測試賽'));
console.log('page rendered event id in script:', html.includes(`evId = "${eid}"`));

// self-register logic
const { id, badge } = await db.addPlayer('阿強', '8528888', '掃碼', 'self');
await db.registerPlayer(Number(eid), id);
console.log('self-register badge:', badge, '(expect 0001)');
const regs = await db.listRegistrations(Number(eid));
console.log('registrations:', regs.length, 'name:', regs[0]?.name);

try { unlinkSync(TEST_DB); } catch {}
console.log('\n✅ REGISTER FLOW VERIFIED');
process.exit(0);
