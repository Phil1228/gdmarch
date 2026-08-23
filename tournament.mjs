import client, { createTeam, listTeams, registeredPlayerIds, getEvent } from './db.mjs';

// ---------- 工具 ----------
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 把 ids 切成每組 size 的陣列 (不足一組的尾巴單獨成組)
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- 分組 ----------
// team 模式: 建賽時把參賽者配成固定 2 人隊 (round_no = NULL)
export async function buildTeams(eventId) {
  const ids = await registeredPlayerIds(eventId);
  const pairs = chunk(shuffle(ids), 2);
  const teamIds = [];
  for (const m of pairs) teamIds.push(await createTeam(eventId, m, null));
  return teamIds;
}

// individual 模式: 每輪重新隨機分 2 人隊 (round_no = 該輪)
export async function buildRoundTeams(eventId, roundNo) {
  const ids = shuffle(await registeredPlayerIds(eventId));
  const pairs = chunk(ids, 2);
  const teamIds = [];
  for (const m of pairs) teamIds.push(await createTeam(eventId, m, roundNo));
  return teamIds;
}

// 生成一輪對陣: 把本輪的隊兩兩配對 (輪空者單獨一筆 bye)
export async function buildMatchups(eventId, roundNo, teamIds) {
  const shuffled = shuffle(teamIds);
  const matchups = [];
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    matchups.push([shuffled[i], shuffled[i + 1]]);
  }
  const bye = shuffled.length % 2 === 1 ? shuffled[shuffled.length - 1] : null;
  // 持久化到 matches 表 (winner 暫空)
  for (const [a, b] of matchups) {
    await client.execute({
      sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b) VALUES (?, ?, ?, ?)',
      args: [eventId, roundNo, a, b],
    });
  }
  return { matchups, bye };
}

// ---------- 記分 (自動算 points) ----------
// winner: "A" | "B" | "draw"
// draw 只在 round_rule = time/rounds 時合法; untilA 必分勝負
export async function recordMatch(matchId, winner, scoreA = null, scoreB = null) {
  let pa = 0, pb = 0;
  if (winner === 'A') { pa = 2; pb = 0; }
  else if (winner === 'B') { pa = 0; pb = 2; }
  else if (winner === 'draw') { pa = 1; pb = 1; }
  else throw new Error('invalid winner');
  await client.execute({
    sql: `UPDATE matches SET winner = ?, score_a = ?, score_b = ?, points_a = ?, points_b = ?
          WHERE id = ?`,
    args: [winner, scoreA, scoreB, pa, pb, matchId],
  });
  return { points_a: pa, points_b: pb };
}

// ---------- 積分榜 ----------
// team 模式: 回傳 team -> 總分; individual 模式: 回傳 player -> 總分
export async function standings(eventId) {
  const ev = await getEvent(eventId);
  const mode = ev?.rule?.scoring_mode || 'individual';
  const rows = (await client.execute({
    sql: 'SELECT team_a, team_b, points_a, points_b FROM matches WHERE event_id = ? AND winner IS NOT NULL',
    args: [eventId],
  })).rows;
  const acc = {}; // teamId -> pts
  for (const m of rows) {
    acc[m.team_a] = (acc[m.team_a] ?? 0) + (m.points_a ?? 0);
    acc[m.team_b] = (acc[m.team_b] ?? 0) + (m.points_b ?? 0);
  }
  if (mode === 'team') {
    // 回傳 team 資訊
    const teams = (await client.execute({
      sql: 'SELECT id, member_ids FROM teams WHERE event_id = ?', args: [eventId],
    })).rows;
    return teams.map((t) => ({ team_id: t.id, members: JSON.parse(t.member_ids), points: acc[t.id] ?? 0 }));
  }
  // individual: 把 team 分攤到其成員
  const teams = (await client.execute({
    sql: 'SELECT id, member_ids FROM teams WHERE event_id = ?', args: [eventId],
  })).rows;
  const pts = {};
  for (const t of teams) {
    const members = JSON.parse(t.member_ids);
    const p = acc[t.id] ?? 0;
    for (const pid of members) pts[pid] = (pts[pid] ?? 0) + p;
  }
  return pts; // {playerId: totalPoints}
}
