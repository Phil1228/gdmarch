process.env.VERCEL = '1';
process.env.DATABASE_URL = 'file:db/_v6test.db';
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

const ev = await R('/api/events','POST',{ name:'v6', ruleConfig:{ scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } });
const E = ev.json.id;
for (const n of ['甲','乙','丙','丁']) await R('/api/events/'+E+'/players','POST',{ name:n });
await R('/api/events/'+E+'/build-all','POST',{});
const teams = (await R('/api/events/'+E+'/teams','GET')).json;
const T0 = teams[0].id;
// open 時改名
const rn = await R('/api/events/'+E+'/teams/'+T0+'/rename','POST',{ name:'龍之隊' });
const teams2 = (await R('/api/events/'+E+'/teams','GET')).json;
A(rn.status===200 && teams2.find(t=>t.id===T0).name==='龍之隊', 'open 可改名 龍之隊 ('+(teams2.find(t=>t.id===T0).name)+')');
// 切 started, 改名應被拒
await R('/api/events/'+E+'/status','POST',{ status:'started' });
const rn2 = await R('/api/events/'+E+'/teams/'+T0+'/rename','POST',{ name:'改不了' });
A(rn2.status===403, 'started 改名被拒');
// closed 報名被拒
await R('/api/events/'+E+'/status','POST',{ status:'closed' });
const reg = await R('/api/events/self-register','POST',{ eventId:E, name:'想報' });
A(reg.status===403 && /無法報名/.test(reg.json.error), 'closed 報名被拒: '+reg.json.error);

console.log(`\n結果: ${ok} ok, ${fail} fail`);
process.exit(fail?1:0);
