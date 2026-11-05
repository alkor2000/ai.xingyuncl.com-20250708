#!/usr/bin/env node
// Run in the target backend runtime after migration and a verified database backup.
// Default is a bounded dry run. --apply quarantines only; it never auto-approves.
require('dotenv').config();
const db = require('../src/database/connection');
const legacy = require('../src/services/imageSafetyLegacy');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const after = Number(args.find(x => x.startsWith('--after='))?.slice(8) || 0);
const limit = Number(args.find(x => x.startsWith('--limit='))?.slice(8) || 100);
if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw Error('Invalid bounds');
(async () => {
  await db.initialize();
  const { rows } = await db.simpleQuery(`SELECT ig.id FROM image_generations ig LEFT JOIN image_safety s ON s.generation_id=ig.id
    WHERE ig.id>? AND ig.local_path IS NOT NULL AND s.file_key IS NULL ORDER BY ig.id LIMIT ?`, [after, limit]);
  let failed = 0;
  for (const row of rows) {
    if (!apply) { console.log(JSON.stringify({ id: row.id, action: 'would_quarantine' })); continue; }
    try { await legacy.importImage(row.id); console.log(JSON.stringify({ id: row.id, state: 'quarantined' })); }
    catch { failed++; console.log(JSON.stringify({ id: row.id, state: 'failed_review_required' })); }
  }
  console.log(JSON.stringify({ apply, examined: rows.length, failed, nextAfter: rows.at(-1)?.id || after }));
  await db.close();
  if (failed) process.exitCode = 1;
})().catch(async () => { console.error('Sweep failed; inspect state before retry'); await db.close(); process.exitCode = 1; });
