import client, { createTeam, listTeams, registeredPlayerIds, getEvent, playersMap } from './db.mjs';

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

// 循環賽輪轉對陣 (circle method): round 從 1 開始, 每輪輪轉使每隊都對到不同隊
function roundRobinPairings(ids, round) {
  let arr = [...ids];
  const hasBye = arr.length % 2 === 1;
  if (hasBye) arr.push(null); // null = 該輪輪空
  const k = arr.length;
  const half = k / 2;
  const fixed = arr[0];
  const rest = arr.slice(1);
  const rot = (round - 1) % (k - 1 || 1);
  for (let i = 0; i < rot; i++) rest.push(rest.shift());
  const circle = [fixed, ...rest];
  const pairs = [];
  let bye = null;
  for (let i = 0; i < half; i++) {
    const a = circle[i];
    const b = circle[k - 1 - i];
    if (a === null) bye = b;
    else if (b === null) bye = a;
    else pairs.push([a, b]);
  }
  return { pairs, bye };
}

// ---------- 分組 ----------
// team 模式: 固定 2 人隊 (round_no = NULL), 之後所有輪次用輪轉法產生對陣
export async function buildTeams(eventId) {
  const ids = await registeredPlayerIds(eventId);
  if (!ids.length) throw new Error('本場尚無報名選手，請先在名單加入');
  const teamIds = [];
  for (const m of chunk(shuffle(ids), 2)) teamIds.push(await createTeam(eventId, m, null));
  return teamIds;
}

// individual 模式: 每輪重隨機 2 人隊 (round_no = 該輪)
export async function buildRoundTeams(eventId, roundNo) {
  const ids = shuffle(await registeredPlayerIds(eventId));
  if (!ids.length) throw new Error('本場尚無報名選手，請先在名單加入');
  const teamIds = [];
  for (const m of chunk(ids, 2)) teamIds.push(await createTeam(eventId, m, roundNo));
  return teamIds;
}

// 一鍵生成所有輪次對陣
// team 模式: 固定隊 + 輪轉法 (每輪不同對陣, 每隊都捉對打過)
// individual 模式: 每輪重洗隊 + 隨機配對
export async function buildAllRounds(eventId) {
  const ev = await getEvent(eventId);
  const mode = ev?.rule?.scoring_mode || 'individual';
  const rounds = ev?.rule?.rounds || 1;
  // 先清空舊對陣 (及 individual 模式的臨時隊), 實現「重整 = 重來」
  await client.execute({ sql: 'DELETE FROM matches WHERE event_id = ?', args: [eventId] });
  await client.execute({ sql: 'DELETE FROM teams WHERE event_id = ?', args: [eventId] });
  if (mode === 'team') {
    let teamIds = (await listTeams(eventId)).map((t) => t.id);
    if (!teamIds.length) teamIds = await buildTeams(eventId);
    if (teamIds.length < 2) throw new Error('隊伍不足 2 隊，無法對陣');
    const out = [];
    for (let r = 1; r <= rounds; r++) {
      const { pairs, bye } = roundRobinPairings(teamIds, r);
      for (const [a, b] of pairs) {
        const r2 = await client.execute({
          sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b) VALUES (?, ?, ?, ?)',
          args: [eventId, r, a, b],
        });
        out.push({ matchId: Number(r2.lastInsertRowid), round: r, teamA: a, teamB: b });
      }
      if (bye != null) out.push({ round: r, bye: bye });
    }
    return { mode, rounds, matchups: out };
  }
  // individual
  const out = [];
  for (let r = 1; r <= rounds; r++) {
    const teamIds = await buildRoundTeams(eventId, r);
    const sh = shuffle(teamIds);
    for (let i = 0; i < sh.length - 1; i += 2) {
      const r2 = await client.execute({
        sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b) VALUES (?, ?, ?, ?)',
        args: [eventId, r, sh[i], sh[i + 1]],
      });
      out.push({ matchId: Number(r2.lastInsertRowid), round: r, teamA: sh[i], teamB: sh[i + 1] });
    }
    if (sh.length % 2 === 1) out.push({ round: r, bye: sh[sh.length - 1] });
  }
  return { mode, rounds, matchups: out };
}

// 生成一輪對陣: 把本輪的隊兩兩配對 (輪空者單獨一筆 bye)
export async function buildMatchups(eventId, roundNo, teamIds) {
  const shuffled = shuffle(teamIds);
  const matchups = [];
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    matchups.push([shuffled[i], shuffled[i + 1]]);
  }
  const bye = shuffled.length % 2 === 1 ? shuffled[shuffled.length - 1] : null;
  // 持久化到 matches 表 (winner 暫空), 並帶回 match id
  const persisted = [];
  for (const [a, b] of matchups) {
    const r = await client.execute({
      sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b) VALUES (?, ?, ?, ?)',
      args: [eventId, roundNo, a, b],
    });
    persisted.push({ matchId: Number(r.lastInsertRowid), teamA: a, teamB: b });
  }
  return { matchups: persisted, bye };
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
  // individual: 把 team 分攤到其成員, 回傳帶名字的陣列
  const teams = (await client.execute({
    sql: 'SELECT id, member_ids FROM teams WHERE event_id = ?', args: [eventId],
  })).rows;
  const pmap = await playersMap();
  const pts = {};
  for (const t of teams) {
    const members = JSON.parse(t.member_ids);
    const p = acc[t.id] ?? 0;
    for (const pid of members) pts[pid] = (pts[pid] ?? 0) + p;
  }
  return Object.entries(pts)
    .map(([pid, points]) => ({
      player_id: Number(pid),
      name: pmap[pid]?.name || '?',
      badge: pmap[pid]?.badge_no || '',
      points,
    }))
    .sort((a, b) => b.points - a.points);
}
