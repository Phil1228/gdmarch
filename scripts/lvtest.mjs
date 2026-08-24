process.env.VERCEL = '1';
process.env.DATABASE_URL = 'file:db/_lvtest.db';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const db = await import('../db.mjs'); const client = db.default;
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) { const t=s.trim(); if(!t) continue; try { await client.execute(t); } catch(e){ if(!String(e.message).includes('not an error')) throw e; } }
const { default: h } = await import('../server.mjs');
const R = (u,m,b=null) => new Promise(async res => {
  const rs = { statusCode:200, body:'', writeHead(c){this.statusCode=c;}, end(x){this.body=x; res({status:this.statusCode, json:JSON.parse(x)});}, on(){} };
  const rq = { url:u, method:m, headers:{'x-vercel-original-url':u}, on:(e,cb)=>{ if(b){ if(e==='data')cb(JSON.stringify(b)); if(e==='end')cb(); } } };
  await h(rq, rs);
});
let ok=0, fail=0; const A=(c,m)=>{ if(c){ok++;console.log('  ok:',m);} else {fail++;console.error('  FAIL:',m);} };
const ev = await R('/api/events','POST',{ name:'lv', ruleConfig:{ scoring_mode:'team', participant_count:8, rounds:3, round_rule:'rounds' } });
const E = ev.json.id;
for (const n of ['a','b','c','d','e','f','g','h']) await R('/api/events/'+E+'/players','POST',{ name:n });
await R('/api/events/'+E+'/build-all','POST',{});
const ms = await R('/api/events/'+E+'/matches?round=1','GET');
const m1 = ms.json[0];
// 紅隊 J, 藍隊 5 -> 紅勝
const r1 = await R('/api/matches','POST',{ matchId:m1.id, levelA:'J', levelB:'5' });
A(r1.json.winner==='A' && r1.json.points_a===2, '紅 J > 藍 5 => 紅勝 +2');
// 同級 -> 平局
const m2 = ms.json[1];
const r2 = await R('/api/matches','POST',{ matchId:m2.id, levelA:'8', levelB:'8' });
A(r2.json.winner==='draw' && r2.json.points_a===1, '同級 8/8 => 平局 +1');
// 藍隊更高
const r3 = await R('/api/matches','POST',{ matchId:m1.id, levelA:'3', levelB:'K' });
A(r3.json.winner==='B' && r3.json.points_b===2, '藍 K > 紅 3 => 藍勝 +2 (重記覆蓋)');
// 無效級別
const r4 = await R('/api/matches','POST',{ matchId:m1.id, levelA:'X', levelB:'5' });
A(r4.status>=400 || r4.json.error, '無效級別 X 被拒');
// standings 含積分
const st = await R('/api/events/'+E+'/standings','GET');
A(Array.isArray(st.json) && st.json.length===4, '積分榜 4 隊 (team 8人=4隊)');
console.log(`\n結果: ${ok} ok, ${fail} fail`);
process.exit(fail?1:0);
