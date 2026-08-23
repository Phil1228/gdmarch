// quick e2e smoke test (no HTTP, direct import)
import client from '../db.mjs';
import {
  listPlayers, addPlayer, deletePlayer, createEvent, listEvents,
  registerPlayer, listRegistrations,
} from '../db.mjs';
import { createGroups, listGroups, recordMatch, standings } from '../tournament.mjs';

const log = (...a) => console.log(...a);

log('1. add players');
const ids = [];
for (const n of ['小明', '小華', '小美', '小強']) ids.push(await addPlayer(n));
log('   players:', await listPlayers());

log('2. create event');
const eid = await createEvent('週末掼蛋賽', {});
log('   event id:', eid, 'list:', await listEvents());

log('3. register all');
for (const pid of ids) await registerPlayer(eid, pid);
log('   registrations:', await listRegistrations(eid));

log('4. random groups (4/grp)');
const groups = await createGroups(eid, 1, 4);
log('   groups:', groups);
log('   stored:', await listGroups(eid, 1));

log('5. record match (team 1,2 vs 3,4 ; 11:5 ; 2pts:0pts)');
const mid = await recordMatch(eid, 1, [1, 2], [3, 4], 11, 5, 2, 0);
log('   match id:', mid);

log('6. standings');
log('   ', await standings(eid));

log('7. cleanup test data (delete related rows first to satisfy FK)');
await client.execute('DELETE FROM matches');
await client.execute('DELETE FROM groups');
await client.execute('DELETE FROM registrations');
await client.execute('DELETE FROM events');
for (const pid of ids) await deletePlayer(pid);
log('   done. remaining players:', (await listPlayers()).length);
process.exit(0);
