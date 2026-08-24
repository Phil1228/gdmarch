import client from '../db.mjs';
await client.execute("DELETE FROM events WHERE name='域名測試'");
console.log('cleaned');
process.exit(0);
