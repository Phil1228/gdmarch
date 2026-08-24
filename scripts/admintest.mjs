process.env.VERCEL = '1';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_admintest.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;
const { readFileSync } = await import('node:fs');
const db = await import('../db.mjs');
const client = db.default;
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) { const t = s.trim(); if (!t) continue; try { await client.execute(t); } catch (e) { if (!String(e.message).includes('not an error')) throw e; } }

const { default: handleRequest } = await import('../server.mjs');

function makeReq(url, method='GET', body=null) {
  const req = { url, method, headers: { 'x-vercel-original-url': url }, on() {} };
  return req;
}
function makeRes() {
  const self = { headersSent:false, statusCode:200, body:'', writeHead(c){this.statusCode=c;}, end(b){this.body=b; this._r(b);}, on(){} };
  self._p = new Promise(r => self._r = r); return self;
}
async function call(url, method='GET', body=null) {
  const res = makeRes(); const req = makeReq(url, method);
  if (body) req.on = (ev, cb) => { if (ev==='data') cb(JSON.stringify(body)); if (ev==='end') cb(); };
  await handleRequest(req, res);
  try { return { status: res.statusCode, json: JSON.parse(res.body), body: res.body }; }
  catch { return { status: res.statusCode, json: res.body, body: res.body }; }
}

let ok = 0, fail = 0;
const A = (c, m) => { if (c) { ok++; console.log('  ok:', m); } else { fail++; console.error('  FAIL:', m); } };

// 1. 建 team 賽事
const ev = await call('/api/events','POST',{ name:'後台測試賽', ruleConfig:{ scoring_mode:'team', rounds:3, round_rule:'rounds', settlement:'points' } });
A(ev.json.id > 0, '建賽事 id=' + ev.json.id);
const eid = ev.json.id;

// 2. 加選手
const p1 = await call('/api/players','POST',{ name:'阿強', contact:'8521' });
const p2 = await call('/api/players','POST',{ name:'阿明', contact:'8522' });
const p3 = await call('/api/players','POST',{ name:'小美', contact:'8523' });
const p4 = await call('/api/players','POST',{ name:'小華', contact:'8524' });
A(p1.json.badge && p2.json.badge, '選手號牌: '+p1.json.badge+','+p2.json.badge);

// 3. 報名 (4人)
for (const p of [p1,p2,p3,p4]) await call('/api/registrations','POST',{ eventId:eid, playerId:p.json.id });

// 4. CSV 導入
const imp = await call('/api/import-players','POST',{ csv:'大雄,8525,來賓\n靜香,8526,' });
A(imp.json.added?.length === 2, 'CSV 導入 '+imp.json.added?.length+' 人');
// 匯入的也要報名才會進分組
for (const a of imp.json.added) await call('/api/registrations','POST',{ eventId:eid, playerId:a.id });

// 5. 建固定隊 (team 模式)
const bt = await call('/api/build-teams','POST',{ eventId:eid, scoringMode:'team' });
A(bt.json.teamIds?.length === 3, '配成 '+bt.json.teamIds?.length+' 隊 (6人/2)');

// 6. 生成對陣
const mu = await call('/api/matchups','POST',{ eventId:eid, roundNo:1, teamIds:bt.json.teamIds });
A(mu.json.matchups?.length === 1, '第1輪 1 場對陣 (3隊→1場+1輪空)');
const m0 = mu.json.matchups[0];
A(m0.matchId > 0, '對陣帶 matchId='+m0.matchId);

// 7. 記分 A勝
const rc = await call('/api/matches','POST',{ matchId:m0.matchId, winner:'A', scoreA:11, scoreB:5 });
A(rc.json.points_a === 2 && rc.json.points_b === 0, 'A勝自動算 2:0');

// 8. 積分榜
const st = await call('/api/events/'+eid+'/standings');
A(Array.isArray(st.json) && st.json.length === 3, '積分榜 '+st.json.length+' 隊');
A(st.json.some(t => t.points === 2), '有隊得2分');

// 9. admin.html serve
const admin = await call('/admin');
A(admin.body.includes('掼蛋賽務後台'), '/admin 頁面載入');

console.log(`\n結果: ${ok} ok, ${fail} fail`);
try { unlinkSync(TEST_DB); } catch {}
process.exit(fail ? 1 : 0);
