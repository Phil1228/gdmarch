process.env.VERCEL = '1';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_eventtest.db');
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

// 建 team 賽事 (8人)
const ev = await call('/api/events','POST',{ name:'單場管理測試', ruleConfig:{ scoring_mode:'team', participant_count:8, rounds:3, round_rule:'rounds', settlement:'points' } });
const EID = ev.json.id;
A(EID>0, '建賽事 id='+EID);

// event 專屬加人 (自動報名)
const p1 = await call('/api/events/'+EID+'/players','POST',{ name:'阿強', contact:'1' });
A(p1.json.id>0 && p1.json.badge, '加人並報名本場 badge='+p1.json.badge);
for (const n of ['小美','小華','大雄','靜香','胖虎','技安']) {
  await call('/api/events/'+EID+'/players','POST',{ name:n });
}
const regs = await call('/api/events/'+EID+'/registrations');
A(regs.json.length===7, '本場報名 '+regs.json.length+' 人 (應7: 阿強+6)');

// CSV 導入並報名 (再 +2)
const imp = await call('/api/events/'+EID+'/import','POST',{ csv:'測試A,852, \n測試B,853,' });
A(imp.json.added?.length===2, 'CSV 匯入並報名 '+imp.json.added?.length+' 人');
const regs2 = await call('/api/events/'+EID+'/registrations');
A(regs2.json.length===9, '報名變 '+regs2.json.length+' 人 (應9)');

// 移除一人
await call('/api/events/'+EID+'/players/'+p1.json.id,'DELETE');
const regs3 = await call('/api/events/'+EID+'/registrations');
A(regs3.json.length===8, '移除後 '+regs3.json.length+' 人 (應8)');

// 建隊 + 對陣 + 記分
const bt = await call('/api/build-teams','POST',{ eventId:EID, scoringMode:'team' });
A(bt.json.teamIds?.length===Math.floor(9/2)+1 || bt.json.teamIds?.length>=4, '配隊 '+bt.json.teamIds?.length+' 隊');
const mu = await call('/api/matchups','POST',{ eventId:EID, roundNo:1, teamIds:bt.json.teamIds });
A(mu.json.matchups?.length>=1, '第1輪 '+mu.json.matchups?.length+' 場');
const m0 = mu.json.matchups[0];
const rc = await call('/api/matches','POST',{ matchId:m0.matchId, winner:'A', scoreA:11, scoreB:5 });
A(rc.json.points_a===2, 'A勝算2分');

// 積分榜
const st = await call('/api/events/'+EID+'/standings');
A(Array.isArray(st.json) && st.json.length>=4, '積分榜 '+st.json.length+' 隊');

// event.html serve 帶 eventId
const pg = await call('/events/'+EID);
A(pg.body.includes('__EVENT_ID__')===false && pg.body.includes('比賽管理'), 'event.html 載入且替換 eventId');
A(pg.body.includes('const EID = "'+EID+'"'), 'EID 正確注入: '+EID);

// QR
const qr = await call('/api/events/'+EID+'/qrcode');
A(qr.json.link.includes('/r/'+EID), 'QR 連結正確: '+qr.json.link);

console.log(`\n結果: ${ok} ok, ${fail} fail`);
try { unlinkSync(TEST_DB); } catch {}
process.exit(fail?1:0);
