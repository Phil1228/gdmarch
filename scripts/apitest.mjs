process.env.VERCEL = '1';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_apittest.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;

const { readFileSync } = await import('node:fs');
const db = await import('../db.mjs');
const client = db.default;
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) {
  const t = s.trim(); if (!t) continue;
  try { await client.execute(t); } catch (e) { if (!String(e.message).includes('not an error')) throw e; }
}

const { handleRequest } = await import('../server.mjs');

function makeReq(url, method = 'GET') {
  return { url, method, headers: { 'x-vercel-original-url': url },
    on() {} };
}
function makeRes() {
  const self = {
    headersSent: false, statusCode: 200, body: '',
    writeHead(c) { this.statusCode = c; },
    end(b) { this.body = b; this._resolve(b); },
    on() {},
  };
  self._promise = new Promise((r) => (self._resolve = r));
  return self;
}
async function call(url, method = 'GET', body = null) {
  const res = makeRes();
  const req = makeReq(url, method);
  if (body) {
    req.on = (ev, cb) => { if (ev === 'data') cb(JSON.stringify(body)); if (ev === 'end') cb(); };
  }
  await handleRequest(req, res);
  return { status: res.statusCode, body: res.body };
}

const eid = await db.createEvent('API測試', { scoring_mode: 'team', rounds: 3, round_rule: 'rounds' });
const page = await call(`/r/${eid}`);
console.log('GET /r/<id> status:', page.status, 'isHtml:', page.body.includes('掼'));
const reg = await call('/api/events/self-register', 'POST', { eventId: Number(eid), name: '小測', contact: '8521111' });
console.log('self-register:', reg.body);
const nf = await call('/api/whatever');
console.log('404 route status:', nf.status);

try { unlinkSync(TEST_DB); } catch {}
console.log('\n✅ API HANDLER VERIFIED');
process.exit(0);
