// Private, bounded, single-process development spool; NOT a teacher resource library.
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { retained } = require('./mysqlStore');
const queues = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

class DraftStore {
  constructor(directory, now = Date.now) {
    this.directory = path.resolve(directory);
    this.now = now;
  }
  // Accepts the owner-scoped signature of the durable candidate; one dev spool holds every owner.
  async transaction(owner, fn) {
    if (typeof owner === 'function') fn = owner;
    if (typeof fn !== 'function') throw new TypeError('transaction callback required');
    const previous = queues.get(this.directory) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const filename = path.join(this.directory, 'state.json');
      let state;
      try { state = JSON.parse(await fs.readFile(filename, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        state = { version: 1, snapshots: {}, keys: {}, grants: {}, operations: {}, received: {} };
      }
      if (state.version !== 1) throw new Error('Unsupported draft spool');
      for (const collection of ['snapshots', 'keys', 'grants', 'operations', 'received']) {
        for (const [id, item] of Object.entries(state[collection])) {
          // Operations follow the durable retention rule (recovery window, reconciliation hold).
          if (collection === 'operations' ? !retained(item, this.now()) : item.expires_at <= this.now()) delete state[collection][id];
        }
      }
      const pruned = structuredClone(state);
      let result, failure;
      try { result = await fn(state); }
      catch (error) { failure = error; state = pruned; }
      const temp = `${filename}.${randomUUID()}.tmp`;
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temp, filename);
      const dir = await fs.open(this.directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
      if (failure) throw failure;
      return structuredClone(result);
    });
    queues.set(this.directory, task);
    try { return await task; }
    finally { if (queues.get(this.directory) === task) queues.delete(this.directory); }
  }
}
module.exports = { DraftStore, TTL_MS };
