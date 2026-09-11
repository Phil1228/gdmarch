import client from '../db.mjs';
import { buildAllRounds } from '../tournament.mjs';
import { buildAllRounds } from '../tournament.mjs';

const EVENT_ID = 18;

async function main() {
  console.log(`開始重建賽事 ${EVENT_ID} 的對陣表...`);
  try {
    const result = await buildAllRounds(EVENT_ID);
    console.log('重建完成！');
    console.log(`模式: ${result.mode}`);
    console.log(`輪數: ${result.rounds}`);
    console.log(`產生的對陣數量: ${result.matchups.length}`);
    console.log('詳細對陣:');
    for (const m of result.matchups) {
      const type = m.teamB === null ? '輪空' : '正常比賽';
      console.log(`  第 ${m.round} 輪 | ${type} | teamA: ${m.teamA}${m.teamB !== null ? ' vs teamB: ' + m.teamB : ''} | winner: ${m.winner || '未定'} | 積分: ${m.pointsA || 0}-${m.pointsB || 0}`);
    }
  } catch (err) {
    console.error('重建失敗:', err);
  }
}

main();
