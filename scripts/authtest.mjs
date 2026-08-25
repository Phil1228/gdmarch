process.env.VERCEL = '1';
process.env.DATABASE_URL = 'file:db/_authtest.db';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const db = await import('../db.mjs'); const client = db.default;
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) { const t=s.trim(); if(!t) continue; try { await client.execute(t); } catch(e){ if(!String(e.message).includes('not an error')) throw e; } }
const { default: h } = await import('../server.mjs');
const R = (u,m,b=null,ck=null) => new Promise(async res => {
  const rs = { statusCode:200, body:'', _ck:null, writeHead(c){this.statusCode=c;}, end(x){this.body=x; res({status:this.statusCode, json:JSON.parse(x), cookie:this._ck});}, setHeader(k,v){ if(k.toLowerCase()==='set-cookie') this._ck=v; }, on(){} };
  const hd = { 'x-vercel-original-url':u }; if(ck) hd.cookie='gd_token='+ck;
  const rq = { url:u, method:m, headers:hd, on:(e,cb)=>{ if(b){ if(e==='data')cb(JSON.stringify(b)); if(e==='end')cb(); } } };
  await h(rq, rs);
});
let ok=0, fail=0; const A=(c,m)=>{ if(c){ok++;console.log('  ok:',m);} else {fail++;console.error('  FAIL:',m);} };

// 種子 admin 已建 (第一個用戶). 登入 admin
const login = await R('/api/auth/login','POST',{ username:'admin', password:'admin123' });
A(login.status===200 && login.json.user.role==='admin', 'admin 登入成功');
const ADM = login.cookie?.split(';')[0].split('=')[1];

// 註冊新用戶
const reg = await R('/api/auth/register','POST',{ username:'phil', password:'pass123', displayName:'菲爾' });
A(reg.status===201 && reg.json.user.username==='phil', '註冊 phil');
const login2 = await R('/api/auth/login','POST',{ username:'phil', password:'pass123' });
const PHIL = login2.cookie?.split(';')[0].split('=')[1];

// 未登入建私享賽 -> 401
const pe1 = await R('/api/events','POST',{ name:'私享A', ruleConfig:{ visibility:'private', scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } });
A(pe1.status===401, '未登入建私享賽被拒');

// 登入 phil 建私享賽 -> ok
const pe2 = await R('/api/events','POST',{ name:'私享B', ruleConfig:{ visibility:'private', scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } }, PHIL);
A(pe2.status===201, 'phil 建私享賽成功 id='+pe2.json.id);
const PRIV = pe2.json.id;

// 建公開賽 (未登入也可)
const pe3 = await R('/api/events','POST',{ name:'公開A', ruleConfig:{ visibility:'public', scoring_mode:'team', participant_count:4, rounds:1, round_rule:'rounds' } });
A(pe3.status===201, '未登入建公開賽成功');
const PUB = pe3.json.id;

// 列表過濾: 未登入只看公開
const lstAnon = await R('/api/events','GET');
A(lstAnon.json.every(e=>e.visibility==='public'), '未登入只見公開賽 ('+lstAnon.json.length+' 場)');
// phil 登入看 公開 + 自己私享
const lstPhil = await R('/api/events','GET', null, PHIL);
A(lstPhil.json.some(e=>e.id===PRIV) && lstPhil.json.some(e=>e.id===PUB), 'phil 看見公開+自己私享');
// admin 看全部
const lstAdm = await R('/api/events','GET', null, ADM);
A(lstAdm.json.length >= lstPhil.json.length, 'admin 看見全部');

// 私享賽未登入報名 -> 401
const sr = await R('/api/events/self-register','POST',{ eventId:PRIV, name:'路人' });
A(sr.status===401, '私享賽未登入報名被拒');
// 私享賽 phil 登入報名 -> ok
const sr2 = await R('/api/events/self-register','POST',{ eventId:PRIV, name:'菲爾本人' }, PHIL);
A(sr2.status===201, '私享賽 phil 報名成功');

// 管理員重設 phil 密碼
const rst = await R('/api/admin/users/'+reg.json.user.id+'/reset','POST',{ password:'newpass1' }, ADM);
A(rst.status===200, 'admin 重設 phil 密碼');
const relogin = await R('/api/auth/login','POST',{ username:'phil', password:'newpass1' });
A(relogin.status===200, '用新密碼登入成功');

console.log(`\n結果: ${ok} ok, ${fail} fail`);
process.exit(fail?1:0);
