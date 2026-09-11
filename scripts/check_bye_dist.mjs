import client from '../db.mjs';

// 查詢賽事 18 選手名單、重建後的 teams/matches、統計輪空次數
async function main() {
  const db = await client;
  const EVENT_ID = 18;

  const regs = await db.execute({sql:`SELECT player_id, name FROM registrations WHERE event_id = ${EVENT_ID}`});
  const nameMap = {};
  for (const r of regs.rows) nameMap[r.player_id] = r.name;
  console.log('選手列表:');
  for (const pid of Object.keys(nameMap).map(Number).sort((a,b)=>a-b)) {
    console.log(`  ID ${pid}: ${nameMap[pid]}`);
  }

  const byeTeams = await db.execute({sql:`SELECT id, member_ids, round_no FROM teams WHERE round_no IN (1,2,3) ORDER BY round_no, id`});
  const allMatches = await db.execute({sql:`SELECT id, round_no, team_a, team_b, winner, points_a, points_b FROM matches WHERE event_id = ${EVENT_ID} ORDER BY round_no, id`});

  console.log('\n=== 對陣 + 輪空分佈 ===');
  const byeByPlayer = {};
  for (const m of allMatches.rows) {
    if (m.team_b === null) {
      const team = byeTeams.rows.find(t => t.id === m.team_a);
      if (team) {
        const mids = JSON.parse(team.member_ids);
        const pids = mids.map(m2 => typeof m2 === 'object' ? (m2.playerId || m2.id) : m2);
        pids.forEach(pid => { byeByPlayer[pid] = (byeByPlayer[pid] || 0) + 1; });
        console.log(`第 ${m.round_no} 輪 輪空: 成員 ${pids.map(pid => nameMap[pid] || pid).join(', ')} (隊ID ${m.team_a})`);
      }
    }
  }

  console.log('\n=== 每位選手輪空次數 ===');
  const allPids = Object.keys(nameMap).map(Number).sort((a,b)=>a-b);
  const neverBye = allPids.filter(pid => !byeByPlayer[pid]);
  for (const pid of allPids) {
    const cnt = byeByPlayer[pid] || 0;
    console.log(`  ${nameMap[pid]} (ID ${pid}): ${cnt} 次`);
  }
  if (neverBye.length) console.log(`  未輪空: ${neverBye.map(pid => nameMap[pid]).join(', ')}`);

  const counts = Object.values(byeByPlayer).map(v => v);
  const max = counts.length ? Math.max(...counts) : 0;
  const min = counts.length ? Math.min(...counts) : 0;
  console.log(`\n輪空次數範圍: 最大 ${max}，最小 ${min}，差距 ${max - min}`);
}

main();
