import client from '../db.mjs';
await client.execute("DELETE FROM registrations WHERE event_id=2");
await client.execute("DELETE FROM events WHERE id=2");
await client.execute("DELETE FROM players WHERE name='阿龍'");
const p = await client.execute("SELECT count(*) c FROM players WHERE name='阿龍'");
const e = await client.execute("SELECT count(*) c FROM events WHERE id=2");
console.log('阿龍剩餘:', p.rows[0].c, '筆 | 賽事2剩餘:', e.rows[0].c, '筆');
process.exit(0);
