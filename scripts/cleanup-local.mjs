import client from '../db.mjs';
await client.execute("DELETE FROM events WHERE id=1");
console.log('cleaned local test event');
process.exit(0);
