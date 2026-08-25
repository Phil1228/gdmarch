// e2e smoke test for gdmarch (direct import, no HTTP). Uses a temp db file, deleted at end.
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __d = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__d, '..', 'db', '_smoke_test.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;

const db = await import('../db.mjs');
const client = db.default;
const {
  listPlayers, addPlayer, createEvent, getEvent, registerPlayer,
  listRegistrations, registeredPlayerIds, listTeams,
} = db;
const {
  buildTeams, buildRoundTeams, buildMatchups, recordMatch, standings,
} = await import('../tournament.mjs');

const log = (...a) => console.log(...a);
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } log('  ok:', m); };

// load schema into temp db
const schema = readFileSync(join(__d, '..', 'db', 'schema.sql'), 'utf-8');
for (const s of schema.split(';')) {
  const t = s.trim();
  if (!t) continue;
  try { await client.execute(t); }
  catch (e) { if (!String(e.message).includes('not an error')) throw e; }
}

log('1. 導入 4 選手 + 自動發號牌');
const imp = [];
for (const n of ['小明', '小華', '小美', '小強']) imp.push(await addPlayer(n, null, null, 'import'));
log('   badges:', imp.map((x) => x.badge));
assert(imp.map((x) => x.badge).join(',') === '0001,0002,0003,0004', '號牌從0001連續發放');

log('2. 建 team 模式賽事');
const eid = await createEvent('週末掼蛋賽', {
  scoring_mode: 'team', rounds: 3, round_rule: 'rounds', settlement: 'points',
});
const ev = await getEvent(eid);
assert(ev.rule.scoring_mode === 'team', 'rule_config 正確存讀');

log('3. 報名 (4人全報)');
for (const x of imp) await registerPlayer(eid, x.id);
assert((await registeredPlayerIds(eid)).length === 4, '4人報名');

log('4. team 模式: 建固定隊 (2人一隊 → 2隊)');
const teamIds = await buildTeams(eid);
assert(teamIds.length === 2, '配成2隊');
const tA = (await listTeams(eid))[0];
assert(JSON.parse(tA.member_ids).length === 2, '每隊2人');

log('5. 生成對陣 + 記分 (A勝) → 自動算分');
await buildMatchups(eid, 1, teamIds);
const mId = (await client.execute('SELECT id FROM matches WHERE event_id=? AND round_no=1', [eid])).rows[0].id;
const r = await recordMatch(mId, 'J', '5');
assert(r.points_a === 2 && r.points_b === 0, '紅隊J勝→2:0 自動算分');

log('6. 積分榜 (team 模式)');
const st = await standings(eid);
assert(st.length === 2 && st.some((t) => t.points === 2) && st.some((t) => t.points === 0), '積分榜正確');

log('7. 掃碼自行錄入');
const self = await addPlayer('路人甲', '8529999', '掃碼來的', 'self');
await registerPlayer(eid, self.id);
assert(self.badge === '0005', '新選手發0005');
assert((await listRegistrations(eid)).length === 5, '名單變5人');

log('8. individual 模式: 每輪重洗隊 + 平局各+1');
const eid2 = await createEvent('個人賽', { scoring_mode: 'individual', rounds: 2, round_rule: 'time', settlement: 'points' });
for (const x of imp) await registerPlayer(eid2, x.id);
const rt1 = await buildRoundTeams(eid2, 1);
const rt2 = await buildRoundTeams(eid2, 2);
assert(rt1.length === 2 && rt2.length === 2, '個人賽每輪2隊');
await buildMatchups(eid2, 1, rt1);
const mId2 = (await client.execute('SELECT id FROM matches WHERE event_id=? AND round_no=1', [eid2])).rows[0].id;
await recordMatch(mId2, '10', '10');
const st2 = await standings(eid2);
assert(st2.length === 4, '4人攤到個人積分');
assert(st2.every((x) => x.points === 1), '平局各+1 攤到個人');

log('\n✅ ALL SMOKE TESTS PASSED');
try { unlinkSync(TEST_DB); } catch {}
process.exit(0);
