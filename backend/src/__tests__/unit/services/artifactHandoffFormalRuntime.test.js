// Default-off formal runtime: switch semantics, required facts, restricted-ledger readiness, no public entry.
const { createFormalHandoffRuntime, resolveFormalHandoffSwitch, assessGrants, REQUIRED } = require('../../../services/artifactHandoff/formalRuntime');
const { TABLES } = require('../../../services/artifactHandoff/mysqlStore');
const { TRUST } = require('../../../services/artifactHandoff/i03HttpsTransport');

const secret = 'synthetic-secret-'.repeat(3);
const identityEnv = { IDENTITY_ENABLED: 'true', IDENTITY_ISSUER: TRUST.identityOrigin, IDENTITY_PUBLIC_ORIGIN: TRUST.sourceOrigin,
  IDENTITY_CLIENT_ID: TRUST.clientId, IDENTITY_CLIENT_SECRET: secret, IDENTITY_DEPLOYMENT_INSTANCE_KEY: TRUST.sourceInstance,
  IDENTITY_TOKEN_AUTH_METHOD: 'client_secret_post' };
const ledgerEnv = { ...REQUIRED, P03_HANDOFF_DB_USER: 'p03_handoff', P03_HANDOFF_DB_PASSWORD: 'ledger-role-synthetic-value',
  DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'ai_platform', DB_USER: 'ai_user', DB_PASSWORD: 'application-account' };
const enabledEnv = { NODE_ENV: 'test', P03_HANDOFF_ENABLED: 'true', ...identityEnv, ...ledgerEnv };
const grant = (table, privileges = 'SELECT, INSERT, UPDATE, DELETE', database = 'ai_platform') =>
  ({ Grants: `GRANT ${privileges} ON \`${database}\`.\`${table}\` TO \`p03_handoff\`@\`%\`` });
const goodGrants = () => [{ Grants: 'GRANT USAGE ON *.* TO `p03_handoff`@`%`' }, ...Object.values(TABLES).map(t => grant(t))];
const columns = () => Object.entries({ [TABLES.owners]: ['owner', 'created_at'],
  [TABLES.operations]: ['id', 'owner', 'choice', 'status', 'expires_at', 'recovery_until', 'hold', 'record'],
  [TABLES.snapshots]: ['owner', 'id', 'operation_id', 'expires_at', 'record'], [TABLES.keys]: ['owner', 'id', 'operation_id', 'expires_at', 'record'] })
  .flatMap(([t, cs]) => cs.map(c => ({ t, c })));
// A scripted mysql2-like pool: only the readiness queries are answered; nothing is written.
function fakePool({ database = 'ai_platform', version = '8.0.43', grants = goodGrants(), cols = columns(), fail = false } = {}) {
  const calls = []; let ended = false;
  return {
    calls, get ended() { return ended; },
    async query(sql) {
      calls.push(sql);
      if (fail) throw new Error('connect ECONNREFUSED 127.0.0.1:3306 password=should-not-leak');
      if (sql.startsWith('SELECT DATABASE()')) return [[{ db: database, version }]];
      if (sql.startsWith('SHOW GRANTS')) return [grants];
      if (sql.includes('information_schema.columns')) return [cols];
      throw new Error('unexpected query');
    },
    async execute() { throw new Error('unexpected execute'); },
    async getConnection() { throw new Error('unexpected connection'); },
    async end() { ended = true; }
  };
}
const models = { User: { findById: async () => null }, Message: { findById: async () => null }, Conversation: { findById: async () => null }, File: { findById: async () => null } };
const build = (env, poolOptions) => {
  const pools = [];
  const promise = createFormalHandoffRuntime({ env, deps: { createPool: () => { const p = fakePool(poolOptions); pools.push(p); return p; },
    models, uploadRoot: '/tmp/p03-uploads-unused', now: () => 1789819200000 } });
  return { promise, pools };
};

describe('P03 formal runtime switch', () => {
  test('unset or "false" is disabled: no pool, no peer, no credential read; other values are configuration errors, never on', async () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', P03_HANDOFF_ENABLED: '' }, { NODE_ENV: 'production', P03_HANDOFF_ENABLED: 'false' }]) {
      const { promise, pools } = build(env);
      const runtime = await promise;
      expect(runtime).toMatchObject({ enabled: false, switch: 'disabled' });
      expect(pools).toHaveLength(0);
      expect(runtime.service).toBeUndefined();
      await runtime.close();
    }
    for (const value of ['1', 'TRUE', 'yes', 'on', ' true', 'true ']) {
      expect(() => resolveFormalHandoffSwitch({ P03_HANDOFF_ENABLED: value })).toThrow('invalid_handoff_configuration');
      await expect(build({ ...enabledEnv, P03_HANDOFF_ENABLED: value }).promise).rejects.toMatchObject({ code: 'invalid_handoff_configuration' });
    }
  });
  test('enabled without identity, instance, wire, restricted role or origin facts is refused before any connection', async () => {
    const cases = [
      [{ IDENTITY_ENABLED: 'false' }, 'handoff_identity_not_ready'],
      [{ IDENTITY_DEPLOYMENT_INSTANCE_KEY: '' }, 'handoff_instance_mismatch'],
      [{ IDENTITY_DEPLOYMENT_INSTANCE_KEY: 'xingyun-ai-platform-test' }, 'handoff_instance_mismatch'],
      [{ IDENTITY_CLIENT_ID: 'ai-platform-xingyun-test-client' }, 'handoff_instance_mismatch'],
      [{ IDENTITY_ISSUER: 'https://id.example.invalid' }, 'handoff_instance_mismatch'],
      [{ IDENTITY_CLIENT_SECRET: 'short' }, 'handoff_identity_not_ready'],
      [{ P03_HANDOFF_WIRE_VERSION: 'i03-draft-0.1' }, 'handoff_instance_mismatch'],
      [{ P03_HANDOFF_STORE: 'file' }, 'handoff_instance_mismatch'],
      [{ P03_HANDOFF_TARGET_ORIGIN: 'http://workflow.pkuailab.com' }, 'handoff_instance_mismatch'],
      [{ P03_HANDOFF_TARGET_INSTANCE: 'tedna-synthetic' }, 'handoff_instance_mismatch'],
      [{ P03_HANDOFF_DB_USER: 'ai_user' }, 'handoff_ledger_role_missing'], // the ALL PRIVILEGES application account
      [{ P03_HANDOFF_DB_USER: '' }, 'handoff_ledger_role_missing'],
      [{ P03_HANDOFF_DB_PASSWORD: 'short' }, 'handoff_ledger_role_missing'],
      [{ P03_HANDOFF_TIMEOUT_MS: '500' }, 'invalid_handoff_configuration']
    ];
    for (const [override, code] of cases) {
      const { promise, pools } = build({ ...enabledEnv, ...override });
      await expect(promise).rejects.toMatchObject({ code });
      expect(pools).toHaveLength(0);
    }
  });
  test('readiness refuses a wrong database, a broad or incomplete role, missing tables and unreachable ledgers; the pool is closed', async () => {
    const cases = [
      [{ database: 'other_db' }, 'handoff_ledger_database_mismatch'],
      [{ version: '5.7.44' }, 'handoff_ledger_version_unsupported'],
      [{ grants: [{ Grants: 'GRANT ALL PRIVILEGES ON `ai_platform`.* TO `ai_user`@`%`' }] }, 'handoff_ledger_role_too_broad'],
      [{ grants: [{ Grants: 'GRANT ALL PRIVILEGES ON *.* TO `ai_user`@`%` WITH GRANT OPTION' }] }, 'handoff_ledger_role_too_broad'],
      [{ grants: [...goodGrants(), grant('users', 'SELECT')] }, 'handoff_ledger_role_too_broad'],
      [{ grants: [...goodGrants(), grant(TABLES.owners, 'SELECT, INSERT, UPDATE, DELETE, DROP')] }, 'handoff_ledger_role_too_broad'],
      [{ grants: goodGrants().slice(0, -1) }, 'handoff_ledger_role_missing'],
      [{ grants: [goodGrants()[0], ...Object.values(TABLES).map(t => grant(t, 'SELECT, INSERT, UPDATE'))] }, 'handoff_ledger_role_too_broad'],
      [{ grants: [goodGrants()[0], ...Object.values(TABLES).map(t => grant(t, undefined, 'other_db'))] }, 'handoff_ledger_role_too_broad'],
      [{ cols: columns().filter(x => x.t !== TABLES.keys) }, 'handoff_ledger_table_missing'],
      [{ cols: columns().filter(x => !(x.t === TABLES.operations && x.c === 'recovery_until')) }, 'handoff_ledger_schema_mismatch'],
      [{ fail: true }, 'handoff_ledger_unavailable']
    ];
    for (const [poolOptions, code] of cases) {
      const { promise, pools } = build(enabledEnv, poolOptions);
      const error = await promise.catch(e => e);
      expect(error.code).toBe(code);
      expect(JSON.stringify(error)).not.toMatch(/password|ECONNREFUSED|synthetic/);
      expect(pools).toHaveLength(1);
      expect(pools[0].ended).toBe(true);
    }
  });
  test('all facts present: a formal runtime with readiness facts only, no route, cleanup opt-in and closable', async () => {
    const { promise, pools } = build(enabledEnv);
    const runtime = await promise;
    expect(runtime).toMatchObject({ enabled: true, wire: 'teacher-artifact-handoff/1' });
    expect(runtime.service.formal).toBe(true);
    expect(runtime.service.wireVersion).toBe('teacher-artifact-handoff/1');
    expect(runtime.readiness).toMatchObject({ database: 'ai_platform', mysql_version: '8.0.43', grant_count: 5, instance_key: TRUST.sourceInstance,
      identity_client_id: TRUST.clientId, source_instance: TRUST.sourceInstance, target_instance: TRUST.targetInstance });
    expect(JSON.stringify(runtime.readiness)).not.toMatch(/synthetic|ledger-role/);
    expect(pools[0].calls.some(sql => /INSERT|UPDATE|DELETE|CREATE/i.test(sql))).toBe(false); // readiness never writes
    const stop = runtime.startCleanup({ intervalMs: 3600000 });
    expect(runtime.startCleanup()).toBe(stop); // idempotent per runtime
    await runtime.close();
    expect(pools[0].ended).toBe(true);
  });
  test('P03_HANDOFF_LAB: refused outside development/test; in test it renames the synthetic pair and routes to lab ports only', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-lab-'));
    const ca = path.join(dir, 'ca.pem'); fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    const spec = path.join(dir, 'lab.json');
    const write = value => fs.writeFileSync(spec, JSON.stringify(value));
    write({ ca, ports: { identity: 4431, target: 4432 }, source_instance: 'practice-synthetic', target_instance: 'tedna-synthetic' });
    const labEnv = { ...enabledEnv, P03_HANDOFF_LAB: spec, P03_HANDOFF_SOURCE_INSTANCE: 'practice-synthetic', P03_HANDOFF_TARGET_INSTANCE: 'tedna-synthetic',
      IDENTITY_DEPLOYMENT_INSTANCE_KEY: 'practice-synthetic' };
    // Production never honours the variable, whatever the file says.
    await expect(build({ ...labEnv, NODE_ENV: 'production' }).promise).rejects.toMatchObject({ code: 'invalid_handoff_configuration' });
    await expect(build({ ...labEnv, NODE_ENV: undefined }).promise).rejects.toMatchObject({ code: 'invalid_handoff_configuration' });
    // The configuration contract and the Identity deployment key must state the synthetic pair themselves.
    await expect(build({ ...labEnv, P03_HANDOFF_SOURCE_INSTANCE: TRUST.sourceInstance }).promise).rejects.toMatchObject({ code: 'handoff_instance_mismatch' });
    await expect(build({ ...labEnv, IDENTITY_DEPLOYMENT_INSTANCE_KEY: TRUST.sourceInstance }).promise).rejects.toMatchObject({ code: 'handoff_instance_mismatch' });
    const runtime = await build(labEnv).promise;
    expect(runtime.readiness).toMatchObject({ laboratory: true, source_instance: 'practice-synthetic', target_instance: 'tedna-synthetic', instance_key: 'practice-synthetic' });
    expect(runtime.service.sourceInstance).toBe('practice-synthetic');
    expect(runtime.service.targetInstance).toBe('tedna-synthetic');
    await runtime.close();
    // Malformed laboratory files are configuration errors, never partial routing.
    for (const bad of [{ ca, ports: { identity: 1, target: 2 }, source_instance: 'Practice', target_instance: 'tedna-synthetic' },
      { ca, ports: { identity: 1, target: 2 }, source_instance: 'same-key', target_instance: 'same-key' },
      { ca, ports: { identity: 1 }, source_instance: 'practice-synthetic', target_instance: 'tedna-synthetic' },
      { ca: path.join(dir, 'missing.pem'), ports: { identity: 1, target: 2 }, source_instance: 'practice-synthetic', target_instance: 'tedna-synthetic' },
      { ca, ports: { identity: 1, target: 2 }, source_instance: 'practice-synthetic', target_instance: 'tedna-synthetic', extra: true }]) {
      write(bad);
      await expect(build(labEnv).promise).rejects.toMatchObject({ code: 'invalid_handoff_configuration' });
    }
    fs.writeFileSync(spec, '{not json');
    await expect(build(labEnv).promise).rejects.toMatchObject({ code: 'invalid_handoff_configuration' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('grant assessment is exact about privilege sets and targets', () => {
    expect(() => assessGrants(goodGrants(), 'ai_platform')).not.toThrow();
    expect(() => assessGrants([{ Grants: 'GRANT SELECT ON *.* TO `x`@`%`' }, ...goodGrants().slice(1)], 'ai_platform')).toThrow('handoff_ledger_role_too_broad');
    expect(() => assessGrants([{ Grants: 'GRANT PROXY ON ``@`` TO `x`@`%`' }], 'ai_platform')).toThrow('handoff_ledger_role_too_broad');
    expect(() => assessGrants([], 'ai_platform')).toThrow('handoff_ledger_role_missing');
  });
});
