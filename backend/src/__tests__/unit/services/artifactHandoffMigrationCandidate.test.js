// The ledger migration candidate stays out of every automatic execution path until release is authorized.
const fs = require('node:fs');
const path = require('node:path');
const knexfile = require('../../../../knexfile');
const candidate = require('../../../../migrations-candidates/p03/20260921_001_p03_handoff_ledger');
const { SCHEMA, TABLES } = require('../../../services/artifactHandoff/mysqlStore');

describe('P03 ledger migration candidate', () => {
  const backend = path.resolve(__dirname, '../../../..');
  test('lives outside the knex migrations directory of every environment and no scanned migration touches the ledger tables', () => {
    for (const env of Object.values(knexfile)) {
      const directory = path.resolve(backend, env.migrations.directory);
      expect(directory).toBe(path.join(backend, 'migrations'));
      expect(fs.readdirSync(directory).some(name => name.includes('p03_handoff'))).toBe(false);
      for (const name of fs.readdirSync(directory)) {
        const text = fs.readFileSync(path.join(directory, name), 'utf8');
        expect(Object.values(TABLES).some(t => text.includes(t))).toBe(false);
      }
    }
  });
  test('up replays mysqlStore.SCHEMA verbatim and down drops the four tables in foreign-key order', async () => {
    const ran = [];
    const knex = { raw: async sql => { ran.push(sql); } };
    await candidate.up(knex);
    expect(ran).toEqual([...SCHEMA]);
    ran.length = 0;
    await candidate.down(knex);
    expect(ran).toEqual(['keys', 'snapshots', 'operations', 'owners'].map(k => `DROP TABLE IF EXISTS \`${TABLES[k]}\``));
    expect(candidate.tables).toEqual(Object.values(TABLES));
  });
});
