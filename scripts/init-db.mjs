import client from '../db.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
for (const stmt of schema.split(';')) {
  const s = stmt.trim();
  if (s) {
    try { await client.execute(s); }
    catch (e) { if (!String(e.message).includes('not an error')) throw e; }
  }
}
console.log('DB initialized (shared polybox-db)');
process.exit(0);
