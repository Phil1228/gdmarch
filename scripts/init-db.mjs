import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || `file:${join(__dirname, '..', 'db', 'guandan.db')}`;

const client = createClient({ url });

const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
// split by statement, run each
for (const stmt of schema.split(';')) {
  const s = stmt.trim();
  if (s) await client.execute(s);
}
console.log('DB initialized at', url);
process.exit(0);
