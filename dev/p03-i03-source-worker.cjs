// stdin/stdout driver for the actual Node draft services, using explicit synthetic facts.
// Invoked by p03-i03-source-check.py; no application env, database, or public listener.
const readline = require('readline');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { i03Fixture } = require('../backend/src/__tests__/helpers/p03I03Fixture');
const { I03DraftClient } = require('../backend/src/services/artifactHandoff/i03Client');
const { HandoffError } = require('../backend/src/services/artifactHandoff/source');
let fixture, now, afterPrepare;
async function mutate(kind) {
  return fixture.mutateSource(async () => {
    if (kind === 'revoke') fixture.policy.copy = false;
    else if (kind === 'version') fixture.messages[fixture.ids.message].content += '\nmodified';
    else if (kind === 'attachment') await fs.unlink(fixture.files[fixture.ids.file].file_path);
    else if (kind === 'disable') fixture.policy.active = false;
    else throw new HandoffError('invalid_request');
  });
}
async function run(r) {
  if (Number.isSafeInteger(r.now)) now = r.now;
  if (r.command === 'init') {
    if (fixture) throw new HandoffError('invalid_request');
    const auth = r.authorization;
    const client = new I03DraftClient({ identityOrigin: r.identityOrigin, targetOrigin: r.targetOrigin,
      endpointProfile: r.endpointProfile, getAuthorization: async () => auth, now: () => now, env: { NODE_ENV: 'test' } });
    const send = client.send.bind(client);
    client.send = async (...args) => {
      const response = await send(...args);
      if (args[2] === 'prepare' && afterPrepare) {
        const kind = afterPrepare; afterPrepare = null;
        await mutate(kind);
      }
      return response;
    };
    fixture = await i03Fixture(r.directory, client, () => now);
    return { ready: true };
  }
  if (!fixture) throw new HandoffError('invalid_request');
  const { service, owner } = fixture;
  if (r.command === 'freeze') return service.freeze(owner,
    { ...await fixture.selection(), ...(r.purpose ? { purpose: r.purpose } : {}) }, r.key || randomUUID(), '水循环探究合成片段');
  if (['resume', 'status', 'get', 'cancel'].includes(r.command)) return service[r.command](owner, r.operation_id);
  if (r.command === 'duplicates') return Promise.all(Array.from({ length: 4 }, () => service.resume(owner, r.operation_id)));
  if (r.command === 'mutate') { await mutate(r.kind); return { changed: true }; }
  if (r.command === 'after_prepare') { afterPrepare = r.kind; return { configured: true }; }
  throw new HandoffError('invalid_request');
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  try {
    const request = JSON.parse(line);
    const result = await run(request);
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error instanceof HandoffError ? error.code : 'local_failure' }) + '\n');
  }
});
