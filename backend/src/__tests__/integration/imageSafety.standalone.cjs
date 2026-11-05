/* Isolated real-MySQL verification. Credentials come from the local development
 * environment; host, port, database and storage are forcibly pinned to test-only values.
 * This runner never reads or truncates ai_platform / ai_platform_test. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '3307';
process.env.DB_NAME = 'image_safety_test_20261105';
let db, knex, server, storage;
(async () => {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), 'image-safety-test-'));
  process.env.STORAGE_PATH = storage;
  knex = require('knex')({ client: 'mysql2', connection: {
    host: '127.0.0.1', port: 3307, user: process.env.DB_USER || 'ai_user', password: process.env.DB_PASSWORD,
    database: 'image_safety_test_20261105'
  } });
  for (const table of ['image_safety_reports', 'image_safety_events', 'image_safety_restrictions', 'image_safety', 'image_safety_references', 'image_generations', 'image_models', 'users']) await knex.schema.dropTableIfExists(table);
  await knex.schema.createTable('image_generations', t => {
    t.bigInteger('id').primary(); t.bigInteger('user_id'); t.integer('model_id').defaultTo(1);
    t.boolean('is_public').defaultTo(false); t.string('status').defaultTo('success');
    t.text('prompt'); t.text('negative_prompt'); t.string('size'); t.integer('view_count').defaultTo(0);
    t.string('local_path'); t.string('thumbnail_path'); t.string('image_url'); t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('image_models', t => { t.integer('id').primary(); t.string('display_name'); t.string('provider'); t.string('icon'); });
  await knex.schema.createTable('users', t => { t.integer('id').primary(); t.string('username'); });
  await require('../../../migrations/20261105_001_image_safety').up(knex);
  await knex('image_generations').insert([1, 2, 3].map(id => ({ id, user_id: 7, prompt: 'test', local_path: '/uploads/legacy.jpg' })));
  await knex('image_models').insert({ id: 1, display_name: 'test', provider: 'test' });
  await knex('users').insert({ id: 7, username: 'test' });
  db = require('../../database/connection'); await db.initialize();
  const safety = require('../../services/imageSafetyService');
  const provider = require('../../services/imageCensorProvider');
  const ImageGeneration = require('../../models/ImageGeneration');
  const sharp = require('sharp');
  const buffer = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#226699' } }).png().toBuffer();
  provider.image = async () => ({ state: 'pass', reason: 'test' });
  provider.text = async () => ({ state: 'pass', reason: 'test' });

  await assert.rejects(safety.publish(1, 7), /审核/);
  await safety.capture(1, 7, buffer);
  assert.equal((await safety.get(1)).state, 'pass');
  await assert.rejects(safety.asset(1, { id: 8, role: 'user' }), /不可访问/);
  await safety.publish(1, 7);
  assert.ok((await safety.asset(1, { id: 8, role: 'user' })).length > 0);
  assert.equal((await ImageGeneration.getPublicGallery()).data.length, 1);
  await safety.decide(1, 9, 'block', 'test takedown', 1);
  assert.equal((await ImageGeneration.getPublicGallery()).data.length, 0);
  await assert.rejects(safety.publish(1, 7), /审核/);
  await assert.rejects(safety.asset(1, { id: 7, role: 'user' }), /不可访问/);
  await assert.rejects(safety.asset(1, { id: 9, role: 'user' }, false, true), /不可访问/);
  assert.ok((await safety.asset(1, { id: 9, role: 'super_admin' }, false, true)).length > 0);
  await safety.capture(1, 7, buffer); // duplicate completion cannot undo removal
  assert.equal((await safety.get(1)).state, 'block');
  await assert.rejects(safety.decide(1, 9, 'pass', 'stale review', 1), /已变更/);
  await safety.capture(2, 7, buffer); // same blocked pixels cannot be re-uploaded
  assert.equal((await safety.get(2)).state, 'block');
  await assert.rejects(safety.uploadReference(7, buffer), /未通过审核/);

  const other = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#aa5566' } }).png().toBuffer();
  await safety.capture(3, 7, other);
  const ref = await safety.uploadReference(7, other);
  assert.ok((await safety.references(7, [ref.url]))[0].startsWith('data:image/jpeg;base64,'));
  await assert.rejects(safety.references(8, [ref.url]), /失效/);
  await Promise.allSettled([safety.publish(3, 7), safety.decide(3, 9, 'block', 'concurrent removal', 1)]);
  assert.equal((await safety.get(3)).state, 'block');
  assert.equal(Number((await knex('image_generations').where({ id: 3 }).first()).is_public), 0);
  assert.equal((await ImageGeneration.getPublicGallery()).data.length, 0);

  const express = require('express');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 7), role: req.headers['x-test-role'] || 'user' }; next(); });
  app.use('/image', require('../../routes/imageSafety'));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/image`;
  assert.equal((await fetch(`${base}/admin/moderation`)).status, 403);
  assert.equal((await fetch(`${base}/admin/moderation/1/asset`)).status, 403);
  const admin = { 'x-test-user': '9', 'x-test-role': 'super_admin' };
  const queue = await (await fetch(`${base}/admin/moderation?state=block`, { headers: admin })).json();
  assert.equal(queue.data.total, 3);
  const preview = await fetch(`${base}/admin/moderation/1/asset`, { headers: admin });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${base}/generation/1/asset`)).status, 404);
  const before = await safety.get(1);
  await fs.writeFile(safety.assetPath(before.file_key), Buffer.from('tampered'));
  await assert.rejects(safety.asset(1, { id: 9, role: 'super_admin' }, false, true), /校验失败/);
  console.log('PASS: migration, quarantine, gallery, authorization, reference ownership, fingerprint deny, duplicate completion, stale review, publish/removal race, audit preview and tamper rejection');
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close(); if (knex) await knex.destroy();
  if (storage) await fs.rm(storage, { recursive: true, force: true });
});
