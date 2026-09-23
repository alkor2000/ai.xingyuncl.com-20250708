'use strict';

// The anchored walk that reads a frozen asset. Everything here happens in a temporary tree this test
// creates: no host file is ever opened, and "outside the upload root" is a sibling temp directory.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssetResolver } = require('../../../services/websiteArtifact/assets');

function tree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p09-anchor-test-'));
  const root = path.join(base, 'uploads');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'chat-images', '2026-09'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'chat-images/2026-09/mine.png'), 'INSIDE');
  fs.writeFileSync(path.join(outside, 'owned.png'), 'OUTSIDE');
  return { base, root, outside };
}
const rowsFor = stored => async sql => (sql.includes('FROM files')
  ? [{ id: 1, user_id: 7, status: 'ready', local_path: stored }] : []);
const ask = (resolver, reference) => resolver.resolve({ ownerUserId: 7, projectId: 3, reference: resolver.classify(reference) });

describe('P09 frozen-asset path anchoring', () => {
  test('a symlinked directory component is refused when it is met, before any name is resolved again', async () => {
    const { base, root, outside } = tree();
    try {
      fs.symlinkSync(outside, path.join(root, 'nested'));
      const resolver = createAssetResolver({ uploadRoot: root, models: { query: rowsFor('nested/owned.png') } });
      await expect(ask(resolver, '/uploads/nested/owned.png')).resolves.toEqual({ refused: 'symlink_refused' });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('a directory swapped after its descriptor was taken cannot redirect the read', async () => {
    const { base, root, outside } = tree();
    try {
      // The schedule that defeated a by-path check: read through the descriptor of the directory that
      // was verified, and the later rename is simply irrelevant.
      const resolver = createAssetResolver({ uploadRoot: root, models: { query: rowsFor('chat-images/2026-09/mine.png') } });
      const reading = ask(resolver, '/uploads/chat-images/2026-09/mine.png');
      fs.renameSync(path.join(root, 'chat-images'), path.join(base, 'parked'));
      fs.symlinkSync(outside, path.join(root, 'chat-images'));
      const result = await reading;
      // Either the original bytes (the walk got there first) or a refusal — never the outside file.
      if (result.refused) expect(['symlink_refused', 'file_missing']).toContain(result.refused);
      else expect(result.content.toString()).toBe('INSIDE');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('without the kernel anchoring it needs, asset freezing closes by name instead of guessing', async () => {
    const { base, root } = tree();
    try {
      const resolver = createAssetResolver({ uploadRoot: root, procFdDir: path.join(base, 'no-procfs-here'),
        models: { query: rowsFor('chat-images/2026-09/mine.png') } });
      await expect(ask(resolver, '/uploads/chat-images/2026-09/mine.png'))
        .resolves.toEqual({ refused: 'path_anchoring_unavailable' });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('the student\'s own file still reads, by relative path and by this deployment\'s own URL', async () => {
    const { base, root } = tree();
    try {
      const resolver = createAssetResolver({ uploadRoot: root, ownHosts: ['practice.localhost'],
        models: { query: rowsFor('chat-images/2026-09/mine.png') } });
      const relative = await ask(resolver, '/uploads/chat-images/2026-09/mine.png');
      const absolute = await ask(resolver, 'http://practice.localhost/uploads/chat-images/2026-09/mine.png');
      expect(relative.content.toString()).toBe('INSIDE');
      expect(absolute.content.toString()).toBe('INSIDE');
      expect(absolute.sha256).toBe(relative.sha256);
      // Someone else's site stays external and is never opened.
      expect(resolver.classify('https://cdn.example.com/uploads/x.png').kind).toBe('external');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  test('a path that tries to climb out is refused before anything is opened', async () => {
    const { base, root } = tree();
    try {
      const resolver = createAssetResolver({ uploadRoot: root, models: { query: rowsFor('../outside/owned.png') } });
      const climbing = { kind: 'upload', raw: '/uploads/../outside/owned.png',
        pathname: '/uploads/../outside/owned.png', key: '../outside/owned.png' };
      await expect(resolver.resolve({ ownerUserId: 7, projectId: 3, reference: climbing }))
        .resolves.toEqual({ refused: 'path_rejected' });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
