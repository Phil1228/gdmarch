process.env.VERCEL = '1';
process.env.DATABASE_URL = 'file:db/_v5test.db';
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

// 選手庫去重 + 搜尋
const p1 = await R('/api/players','POST',{ name:'王小明', source:'manual' });
const p2 = await R('/api/players','POST',{ name:'王小明', source:'self' });
A(p1.json.id===p2.json.id, 'addPlayer 同名去重 (同一 id)');
const sr = await R('/api/players/search?q='+encodeURIComponent('王'),'GET');
A(Array.isArray(sr.json) && sr.json.length>=1 && sr.json[0].name.includes('王'), '選手庫搜尋 王小明');

// 賽事 + 隊名預設
const ev = await R('/api/events','POST',{ name:'v5', ruleConfig:{ scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } });
const E = ev.json.id;
for (const n of ['甲','乙','丙','丁']) await R('/api/events/'+E+'/players','POST',{ name:n });
await R('/api/events/'+E+'/build-all','POST',{});
// 加第二隊手動驗證命名? createTeam 已由 buildTeams 呼叫 (預設 第1隊..)
const teams = await R('/api/events/'+E+'/teams','GET');
A(teams.json.length>=2 && /第\s*\d+\s*隊/.test(teams.json[0].name||''), '隊伍預設名 第N隊 ('+(teams.json[0].name)+')');
A(Array.isArray(teams.json[0].members) && teams.json[0].members[0].name, 'listTeams 回傳成員名字');

// 進行中才能記分: open 時記分應被拒 (前端隱藏, 後端不強制, 但 status 控制前端)
const m0 = (await R('/api/events/'+E+'/matches?round=1','GET')).json[0];
await R('/api/events/'+E+'/status','POST',{ status:'started' });
const rec = await R('/api/matches','POST',{ matchId:m0.id, levelA:'J', levelB:'5' });
A(rec.json.winner==='A', 'started 可記分 紅 J 勝');
const st = await R('/api/events/'+E+'/standings','GET');
A(st.json.length>=2 && st.json[0].members && st.json[0].members[0].name, '積分榜 team 模式含成員名字 ('+(st.json[0].members.map(m=>m.name).join(','))+')');

console.log(`\n結果: ${ok} ok, ${fail} fail`);
process.exit(fail?1:0);
