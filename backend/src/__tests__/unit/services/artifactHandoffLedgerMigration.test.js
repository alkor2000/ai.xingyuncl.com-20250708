// The ledger migration was promoted into backend/migrations on 2026-10-04: both sites create the four tables,
// and nothing else in either migrations directory may touch them.
const fs = require('node:fs');
const path = require('node:path');
const knexfile = require('../../../../knexfile');
const migration = require('../../../../migrations/20260921_001_p03_handoff_ledger');
const { SCHEMA, TABLES } = require('../../../services/artifactHandoff/mysqlStore');

const NAME = '20260921_001_p03_handoff_ledger.js';

describe('P03 ledger migration', () => {
  const backend = path.resolve(__dirname, '../../../..');
  const touchesLedger = file => Object.values(TABLES).some(t => fs.readFileSync(file, 'utf8').includes(t));

  test('is the only migration of every environment that touches the ledger tables', () => {
    for (const env of Object.values(knexfile)) {
      const directory = path.resolve(backend, env.migrations.directory);
      expect(directory).toBe(path.join(backend, 'migrations'));
      const touching = fs.readdirSync(directory).filter(name => touchesLedger(path.join(directory, name)));
      expect(touching).toEqual([NAME]);
    }
  });

  test('no copy is left behind in the candidates directory', () => {
    const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
    expect(files(path.join(backend, 'migrations-candidates')).filter(touchesLedger)).toEqual([]);
  });

  test('up replays mysqlStore.SCHEMA verbatim and down drops the four tables in foreign-key order', async () => {
    const ran = [];
    const knex = { raw: async sql => { ran.push(sql); } };
    await migration.up(knex);
    expect(ran).toEqual([...SCHEMA]);
    ran.length = 0;
    await migration.down(knex);
    expect(ran).toEqual(['keys', 'snapshots', 'operations', 'owners'].map(k => `DROP TABLE IF EXISTS \`${TABLES[k]}\``));
    expect(migration.tables).toEqual(Object.values(TABLES));
  });
});
