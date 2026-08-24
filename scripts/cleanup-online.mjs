import client from '../db.mjs';
// 清理本輪線上驗證殘留 (event 3 + 測試甲~丁 若未被報名則無 registrations)
await client.execute("DELETE FROM registrations WHERE event_id=3");
await client.execute("DELETE FROM events WHERE id=3");
// 刪掉測試甲~丁 (按名字)
await client.execute("DELETE FROM players WHERE name IN ('測試甲','測試乙','測試丙','測試丁','線上後台驗證')");
const chk = await client.execute("SELECT count(*) c FROM events WHERE id=3");
console.log('清理完, event3 剩:', chk.rows[0].c);
process.exit(0);
