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
// 支援錄入時手動指定 team_no: 同 team_no 者自動歸為一隊; 未指定者隨機補充分隊
export async function buildTeams(eventId) {
  const regs = await registeredPlayerIds(eventId); // [{playerId, teamNo}]
  if (!regs.length) throw new Error('本場尚無報名選手，請先在名單加入');
  const grouped = {}; // teamNo -> [pid]
  const rest = [];
  for (const r of regs) {
    if (r.teamNo != null) (grouped[r.teamNo] ||= []).push(r.playerId);
    else rest.push(r.playerId);
  }
  // 檢查手動指定隊是否都恰好 2 人 (否則提示)
  const badManual = Object.entries(grouped).filter(([, m]) => m.length !== 2);
  if (badManual.length) {
    const info = badManual.map(([n, m]) => `隊${n}(${m.length}人)`).join('、');
    throw new Error(`手動指定隊人數須為 2 人：${info}。未滿請補齊，或留空由系統自動分隊。`);
  }
  const teamIds = [];
  let autoNo = (Object.keys(grouped).map(Number).sort((a, b) => b - a)[0] || 0) + 1;
  // 先建手動隊 (依 teamNo 升序, 名稱保留指定號)
  for (const no of Object.keys(grouped).map(Number).sort((a, b) => a - b)) {
    teamIds.push(await createTeam(eventId, grouped[no], null, `第 ${no} 隊`));
  }
  // 剩餘未指定者隨機兩兩成隊
  for (const m of chunk(shuffle(rest), 2)) {
    teamIds.push(await createTeam(eventId, m, null, `第 ${autoNo} 隊`));
    autoNo++;
  }
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
      if (bye != null) {
        // 輪空：自動判勝 +2 分
        const r2 = await client.execute({
          sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b, winner, points_a, points_b) VALUES (?, ?, ?, NULL, ?, ?, ?)',
          args: [eventId, r, bye, 'A', 2, 0],
        });
        out.push({ matchId: Number(r2.lastInsertRowid), round: r, teamA: bye, teamB: null, winner: 'A', pointsA: 2 });
      }
    }
    return { mode, rounds, matchups: out };
  }
  // individual
  const out = [];
  const byeCount = {}; // playerId -> 累计轮空次数
  for (let r = 1; r <= rounds; r++) {
    const regs = await registeredPlayerIds(eventId);
    const pids = shuffle(regs.map(x => x.playerId));
    if (pids.length % 2 === 1) {
      // 优先让累计轮空最少的选手轮空
      let minC = Infinity, byePid = pids[pids.length - 1];
      for (const pid of pids) {
        const c = byeCount[pid] || 0;
        if (c < minC) { minC = c; byePid = pid; }
      }
      byeCount[byePid] = (byeCount[byePid] || 0) + 1;
      // 把 byePid 移到最后（chunk 会把它单独成组）
      const idx = pids.indexOf(byePid);
      if (idx !== pids.length - 1) {
        const tmp = pids[pids.length - 1];
        pids[pids.length - 1] = byePid;
        pids[idx] = tmp;
      }
    }
    const teamIds = [];
    for (const m of chunk(pids, 2)) {
      teamIds.push(await createTeam(eventId, m, r));
    }
    const sh = shuffle(teamIds);
    for (let i = 0; i < sh.length - 1; i += 2) {
      const r2 = await client.execute({
        sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b) VALUES (?, ?, ?, ?)',
        args: [eventId, r, sh[i], sh[i + 1]],
      });
      out.push({ matchId: Number(r2.lastInsertRowid), round: r, teamA: sh[i], teamB: sh[i + 1] });
    }
    if (sh.length % 2 === 1) {
      // 輪空：自動判勝 +2 分
      const bye = sh[sh.length - 1];
      const r2 = await client.execute({
        sql: 'INSERT INTO matches (event_id, round_no, team_a, team_b, winner, points_a, points_b) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        args: [eventId, r, bye, 'A', 2, 0],
      });
      out.push({ matchId: Number(r2.lastInsertRowid), round: r, teamA: bye, teamB: null, winner: 'A', pointsA: 2 });
    }
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

// ---------- 掼蛋級別 (升級順序, 索引越大級越高) ----------
export const LEVELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A1','A2','FIN'];
function levelIndex(lv) {
  const i = LEVELS.indexOf(lv);
  return i < 0 ? -1 : i;
}

// ---------- 記分 (按兩隊級別自動判勝負, 算 points) ----------
// levelA: 紅隊本局打到的級; levelB: 藍隊本局打到的級
// 級高者勝; 同級視為平局
export async function recordMatch(matchId, levelA, levelB) {
  const ia = levelIndex(levelA), ib = levelIndex(levelB);
  if (ia < 0 || ib < 0) throw new Error('無效的級別');
  let winner, pa, pb;
  if (ia > ib) { winner = 'A'; pa = 2; pb = 0; }
  else if (ib > ia) { winner = 'B'; pa = 0; pb = 2; }
  else { winner = 'draw'; pa = 1; pb = 1; } // 同級平局
  await client.execute({
    sql: `UPDATE matches SET winner = ?, level_a = ?, level_b = ?, points_a = ?, points_b = ?
          WHERE id = ?`,
    args: [winner, levelA, levelB, pa, pb, matchId],
  });
  // 更新兩隊當前級別 (取歷史最高級別索引 = 級數)
  const m = (await client.execute({ sql: 'SELECT team_a, team_b FROM matches WHERE id = ?', args: [matchId] })).rows[0];
  if (m) {
    if (m.team_a != null) await client.execute({ sql: 'UPDATE teams SET level_no = MAX(level_no, ?) WHERE id = ?', args: [ia, m.team_a] });
    if (m.team_b != null) await client.execute({ sql: 'UPDATE teams SET level_no = MAX(level_no, ?) WHERE id = ?', args: [ib, m.team_b] });
  }
  return { winner, points_a: pa, points_b: pb };
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
  const maxLv = {}; // teamId -> 最高級別索引 (從已記分局即時計算, 兼容歷史數據)
  for (const m of rows) {
    acc[m.team_a] = (acc[m.team_a] ?? 0) + (m.points_a ?? 0);
    acc[m.team_b] = (acc[m.team_b] ?? 0) + (m.points_b ?? 0);
    if (m.level_a != null) { const i = levelIndex(m.level_a); if (i > (maxLv[m.team_a] ?? -1)) maxLv[m.team_a] = i; }
    if (m.level_b != null) { const i = levelIndex(m.level_b); if (i > (maxLv[m.team_b] ?? -1)) maxLv[m.team_b] = i; }
  }
  if (mode === 'team') {
    // 回傳 team 資訊 (含成員名字, 與 listTeams 格式一致)
    const teams = (await client.execute({
      sql: 'SELECT id, name, member_ids, level_no FROM teams WHERE event_id = ?', args: [eventId],
    })).rows;
    const pmap = await playersMap();
    return teams.map((t) => {
      const raw = JSON.parse(t.member_ids);
      const ids = raw.map((mid) => (typeof mid === 'object' && mid != null ? (mid.playerId || mid.id || mid) : mid));
      const lv = Math.max(t.level_no ?? 0, maxLv[t.id] ?? 0);
      return {
        team_id: t.id,
        name: t.name || ('第 ' + t.id + ' 隊'),
        members: ids.map((pid) => ({ id: pid, name: pmap[pid]?.name || ('#' + pid), badge: pmap[pid]?.badge_no || '' })),
        points: acc[t.id] ?? 0,
        level_no: lv,
      };
    }).sort((a, b) => b.points - a.points || b.level_no - a.level_no);
  }
  // individual: 把 team 分攤到其成員, 回傳帶名字的陣列
  const teams = (await client.execute({
    sql: 'SELECT id, member_ids FROM teams WHERE event_id = ?', args: [eventId],
  })).rows;
  const players = (await client.execute('SELECT id, name, badge_no FROM players')).rows;
  const pmap = {};
  for (const p of players) pmap[p.id] = p;
  const regs = (await client.execute({
    sql: 'SELECT r.player_id, p.name, p.badge_no FROM registrations r LEFT JOIN players p ON p.id = r.player_id WHERE r.event_id = ?',
    args: [eventId],
  })).rows;
  for (const r of regs) {
    if (!pmap[r.player_id] && r.name) pmap[r.player_id] = { id: r.player_id, name: r.name, badge_no: r.badge_no };
  }
  const pts = {};
  for (const t of teams) {
    const members = JSON.parse(t.member_ids).map((mid) => (typeof mid === 'object' && mid != null ? (mid.playerId || mid.id || mid) : mid));
    const p = acc[t.id] ?? 0;
    for (const pid of members) pts[pid] = (pts[pid] ?? 0) + p;
  }
  return Object.entries(pts)
    .map(([pid, points]) => ({
      player_id: Number(pid),
      name: pmap[pid]?.name || ('#' + pid),
      badge: pmap[pid]?.badge_no || '',
      points,
    }))
    .sort((a, b) => b.points - a.points);
}
