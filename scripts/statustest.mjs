process.env.VERCEL = '1';
process.env.DATABASE_URL = 'file:db/_statustest.db';
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
const ev = await R('/api/events','POST',{ name:'st', ruleConfig:{ scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } });
const E = ev.json.id;
const d0 = await R('/api/events/'+E+'/detail','GET');
A(d0.json.status==='open', '新賽事預設 open (報名中)');
// 切到 started
const s1 = await R('/api/events/'+E+'/status','POST',{ status:'started' });
A(s1.json.status==='started', '切到 started');
// started 時 self-register 被拒
const reg = await R('/api/events/self-register','POST',{ eventId:E, name:'想報名' });
A(reg.status===403 && /無法報名/.test(reg.json.error), 'started 報名被拒: '+reg.json.error);
// open 時可報名
await R('/api/events/'+E+'/status','POST',{ status:'open' });
const reg2 = await R('/api/events/self-register','POST',{ eventId:E, name:'可報' });
A(reg2.status===201 && reg2.json.badge, 'open 報名成功');
console.log(`\n結果: ${ok} ok, ${fail} fail`);
process.exit(fail?1:0);
