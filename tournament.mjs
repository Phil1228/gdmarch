import client from './db.mjs';

// ---------- groups (隨機分組) ----------
// registrations: [{player_id,...}] ; groupSize: 每組人數 (掼蛋通常 4)
// 回傳分好的組陣列
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function createGroups(eventId, roundNo, groupSize = 4) {
  const regs = await client.execute({
    sql: 'SELECT player_id FROM registrations WHERE event_id = ?',
    args: [eventId],
  });
  const ids = regs.rows.map((r) => r.player_id);
  const shuffled = shuffle(ids);
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  // persist
  for (let gi = 0; gi < groups.length; gi++) {
    await client.execute({
      sql: 'INSERT INTO groups (event_id, round_no, group_no, player_ids) VALUES (?, ?, ?, ?)',
      args: [eventId, roundNo, gi + 1, JSON.stringify(groups[gi])],
    });
  }
  return groups;
}
export async function listGroups(eventId, roundNo = null) {
  const sql = roundNo
    ? 'SELECT * FROM groups WHERE event_id = ? AND round_no = ? ORDER BY group_no'
    : 'SELECT * FROM groups WHERE event_id = ? ORDER BY round_no, group_no';
  const args = roundNo ? [eventId, roundNo] : [eventId];
  return (await client.execute({ sql, args })).rows;
}

// ---------- matches / 積分記錄 ----------
// points 計算邏輯待用戶規則補完 (TODO)
export async function recordMatch(eventId, roundNo, teamA, teamB, scoreA, scoreB, pointsA = null, pointsB = null) {
  const r = await client.execute({
    sql: `INSERT INTO matches (event_id, round_no, team_a, team_b, score_a, score_b, points_a, points_b)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [eventId, roundNo, JSON.stringify(teamA), JSON.stringify(teamB), scoreA, scoreB, pointsA, pointsB],
  });
  return r.lastInsertRowid;
}

// 積分榜 (由 matches 計算每位選手累計 points)
export async function standings(eventId) {
  const rows = (await client.execute({
    sql: 'SELECT team_a, team_b, points_a, points_b FROM matches WHERE event_id = ?',
    args: [eventId],
  })).rows;
  const pts = {};
  for (const m of rows) {
    const a = JSON.parse(m.team_a), b = JSON.parse(m.team_b);
    const pa = m.points_a ?? 0, pb = m.points_b ?? 0;
    for (const pid of a) pts[pid] = (pts[pid] ?? 0) + pa;
    for (const pid of b) pts[pid] = (pts[pid] ?? 0) + pb;
  }
  return pts; // {playerId: totalPoints}
}
