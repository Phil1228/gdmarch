process.env.VERCEL = '1';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_allrounds.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;
const { readFileSync } = await import('node:fs');
const db = await import('../db.mjs');
const client = db.default;
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) { const t = s.trim(); if (!t) continue; try { await client.execute(t); } catch (e) { if (!String(e.message).includes('not an error')) throw e; } }

const { default: handleRequest } = await import('../server.mjs');
function makeReq(url, method='GET', body=null) { return { url, method, headers: { 'x-vercel-original-url': url }, on() {} }; }
function makeRes() { const self = { headersSent:false, statusCode:200, body:'', writeHead(c){this.statusCode=c;}, end(b){this.body=b;this._r(b);}, on(){} }; self._p=new Promise(r=>self._r=r); return self; }
async function call(url, method='GET', body=null) {
  const res = makeRes(); const req = makeReq(url, method);
  if (body) req.on=(ev,cb)=>{ if(ev==='data')cb(JSON.stringify(body)); if(ev==='end')cb(); };
  await handleRequest(req, res);
  try { return { status:res.statusCode, json:JSON.parse(res.body), body:res.body }; } catch { return { status:res.statusCode, json:res.body, body:res.body }; }
}
let ok=0, fail=0; const A=(c,m)=>{ if(c){ok++;console.log('  ok:',m);} else {fail++;console.error('  FAIL:',m);} };

// team 模式 8人 -> 4隊 -> 3輪循環賽
const ev = await call('/api/events','POST',{ name:'全輪次測試', ruleConfig:{ scoring_mode:'team', participant_count:8, rounds:3, round_rule:'rounds' } });
const EID = ev.json.id;
for (const n of ['A','B','C','D','E','F','G','H']) await call('/api/events/'+EID+'/players','POST',{ name:n });
const d = await call('/api/events/'+EID+'/build-all','POST',{});
A(d.json.rounds===3, '生成 3 輪');
const perRound = { 1:0, 2:0, 3:0 };
d.json.matchups.forEach(m => { if (m.matchId) perRound[m.round]++; });
A(perRound[1]===2 && perRound[2]===2 && perRound[3]===2, '每輪 2 場對陣 (4隊)');
// 檢查每隊在 3 輪都出現且對手不同
const teams = await call('/api/events/'+EID+'/teams');
const teamIds = teams.json.map(t=>t.id);
// 收集每隊的對手
const opp = {};
for (const t of teamIds) opp[t] = new Set();
const ms = await call('/api/events/'+EID+'/matches?round=1'); ms.json.concat(
  (await call('/api/events/'+EID+'/matches?round=2')).json,
  (await call('/api/events/'+EID+'/matches?round=3')).json
).forEach(m => {
  opp[m.team_a].add(m.team_b); opp[m.team_b].add(m.team_a);
});
const allPlayed = teamIds.every(t => opp[t].size === 3); // 3輪遇到3個不同對手
A(allPlayed, '每隊3輪遇到3個不同對手 (循環賽正確)');

// individual 模式 5人 -> 每輪重洗, 3輪, 輪空1人
const ev2 = await call('/api/events','POST',{ name:'個人全輪', ruleConfig:{ scoring_mode:'individual', participant_count:5, rounds:3, round_rule:'time' } });
const EID2 = ev2.json.id;
for (const n of ['甲','乙','丙','丁','戊']) await call('/api/events/'+EID2+'/players','POST',{ name:n });
const d2 = await call('/api/events/'+EID2+'/build-all','POST',{});
const perR2 = { 1:0, 2:0, 3:0 };
d2.json.matchups.forEach(m => { if (m.matchId) perR2[m.round]++; });
A(perR2[1]===1 && perR2[2]===1 && perR2[3]===1, '個人每輪 1 場 (5人→2隊4人+1輪空)');

console.log(`\n結果: ${ok} ok, ${fail} fail`);
try { unlinkSync(TEST_DB); } catch {}
process.exit(fail?1:0);
