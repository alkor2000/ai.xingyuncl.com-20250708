#!/usr/bin/env node
// Enqueue previously public images from a verified, private withdrawal backup.
// Never approves, restores public URLs, or overrides a later owner/teacher decision.
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const db = require('../src/database/connection');
const safety = require('../src/services/imageSafetyService');
const args = process.argv.slice(2);
const arg = name => args.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes('--apply'), after = Number(arg('after') || 0), limit = Number(arg('limit') || 100);
async function run() {
  if (!arg('manifest') || !/^[a-f0-9]{64}$/.test(arg('sha256') || '') || !Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Invalid manifest or bounds');
  const bytes = fs.readFileSync(arg('manifest'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== arg('sha256')) throw Error('Manifest mismatch');
  const records = JSON.parse(bytes);
  if (!Array.isArray(records) || records.length > 50000 || records.some(r => !Number.isSafeInteger(r.id) || !Number.isSafeInteger(r.user_id) || Number(r.is_public) !== 1 || typeof r.prompt !== 'string')) throw Error('Invalid withdrawal backup');
  const selected = records.filter(r => r.id > after).sort((a, b) => a.id - b.id).slice(0, limit);
  if (!db.isConnected) await db.initialize();
  let queued = 0, skipped = 0;
  for (const row of selected) {
    if (!apply) { console.log(JSON.stringify({ id: row.id, action: 'would_check_and_enqueue' })); continue; }
    const changed = await db.transaction(async query => {
      const { rows } = await query('SELECT id,user_id,prompt,status FROM image_generations WHERE id=? FOR UPDATE', [row.id]);
      if (!rows.length || Number(rows[0].user_id) !== row.user_id || rows[0].prompt !== row.prompt || rows[0].status !== 'success') return false;
      const { rows: events } = await query("SELECT id FROM image_safety_events WHERE generation_id=? AND action IN ('gallery_submit','gallery_withdraw','gallery_decision','gallery_legacy_submission') LIMIT 1", [row.id]);
      if (events.length) return false;
      await query('INSERT IGNORE INTO image_safety (generation_id) VALUES (?)', [row.id]);
      const { rows: current } = await query('SELECT state,gallery_state FROM image_safety WHERE generation_id=? FOR UPDATE', [row.id]);
      if (current[0].state === 'block' || current[0].gallery_state !== 'private') return false;
      await query("UPDATE image_safety SET gallery_state='pending',gallery_requested_at=NOW(),revision=revision+1 WHERE generation_id=?", [row.id]);
      await query('UPDATE image_generations SET is_public=0,gallery_approved_by=NULL WHERE id=?', [row.id]);
      await safety.event(query, row.id, null, 'gallery_legacy_submission', 'pending', `withdrawal_backup:${arg('sha256')}`);
      return true;
    });
    changed ? queued++ : skipped++;
  }
  console.log(JSON.stringify({ apply, examined: selected.length, queued, skipped, nextAfter: selected.at(-1)?.id || after }));
}
if (require.main === module) run().catch(() => { console.error('Backfill failed; inspect the last completed cursor before retry'); process.exitCode = 1; }).finally(() => db.close());
module.exports = { run };
