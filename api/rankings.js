import { getGlobalRankings } from '../db.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // 診斷用：確認這個 handler 確實被執行
  console.log('RANKINGS_HANDLER_HOOKED');
  try {
    const rankings = await getGlobalRankings();
    return res.status(200).json(rankings);
  } catch (err) {
    console.error('獲取總積分榜失敗:', err);
    return res.status(500).json({ error: '內部伺服器錯誤', debug: err.message });
  }
}