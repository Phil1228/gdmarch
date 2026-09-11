import { getGlobalRankings } from '../db.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const rankings = await getGlobalRankings();
    return res.status(200).json(rankings);
  } catch (err) {
    console.error('獲取總積分榜失敗:', err);
    return res.status(500).json({ error: '內部伺服器錯誤' });
  }
}