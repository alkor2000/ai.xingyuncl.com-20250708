'use strict';

// Default-off formal runtime for the teacher artifact handoff (wire teacher-artifact-handoff/1, fc1+e1).
// It composes the pieces that already exist — the pinned HTTPS transport, the formal wire client, the MySQL
// durable ledger, the real-user eligibility authority and the formal orchestration — into one object the
// server may hold. It never mounts a public route: the save entry stays closed until separately authorized.
//
// Switch: P03_HANDOFF_ENABLED unset or exactly "false" -> disabled (no pool, no peer call, no new table, no
// credential read); exactly "true" -> strict construction; any other value -> configuration error, never on.
// Enabled construction refuses when any identity, instance, restricted-database, TLS-trust or wire fact is
// missing or wrong. Nothing here relaxes I03DraftSource's development/test gate.
const { TRUST, I03HttpsTransport } = require('./i03HttpsTransport');
const { I03FormalClient } = require('./i03Client');
const { I03FormalSource } = require('./i03Source');
const { MySQLHandoffStore, TABLES } = require('./mysqlStore');
const { createHandoffAuthority } = require('./handoffAuthority');
const { createSourceAdapter, fail, HandoffError } = require('./source');
const { FORMAL_VERSION } = require('./i03Draft');
const { loadIdentityDeploymentConfig } = require('../../config/identityEnrollmentRuntimeConfig');
const { validateIdentityRuntimeConfig } = require('../../config/identityRuntimeConfig');

const SWITCH = 'P03_HANDOFF_ENABLED';
// Explicit configuration contract (docs/integrations/p03-instance-binding-candidate.json, env_candidate_pku):
// every value must be present and equal to the pinned trust constant. Nothing is defaulted or inferred.
const REQUIRED = Object.freeze({
  P03_HANDOFF_STORE: 'mysql',
  P03_HANDOFF_WIRE_VERSION: FORMAL_VERSION,
  P03_HANDOFF_SOURCE_INSTANCE: TRUST.sourceInstance,
  P03_HANDOFF_TARGET_INSTANCE: TRUST.targetInstance,
  P03_HANDOFF_IDENTITY_ORIGIN: TRUST.identityOrigin,
  P03_HANDOFF_TARGET_ORIGIN: TRUST.targetOrigin
});
// Expected ledger shape, the same tables mysqlStore.SCHEMA creates and the migration candidate installs.
const COLUMNS = Object.freeze({
  [TABLES.owners]: ['owner', 'created_at'],
  [TABLES.operations]: ['id', 'owner', 'choice', 'status', 'expires_at', 'recovery_until', 'hold', 'record'],
  [TABLES.snapshots]: ['owner', 'id', 'operation_id', 'expires_at', 'record'],
  [TABLES.keys]: ['owner', 'id', 'operation_id', 'expires_at', 'record']
});
const LEDGER_PRIVILEGES = 'SELECT, INSERT, UPDATE, DELETE';

function resolveFormalHandoffSwitch(env = process.env) {
  const value = env[SWITCH];
  if (value === undefined || value === '' || value === 'false') return 'disabled';
  if (value === 'true') return 'enabled';
  fail('invalid_handoff_configuration');
}

// Identity facts come from the already-validated deployment configuration, never from request data.
function identityFacts(env) {
  const config = loadIdentityDeploymentConfig(env);
  if (!config.enabled || config.credentialError) fail('handoff_identity_not_ready', 503);
  if (config.issuer !== TRUST.identityOrigin || config.publicOrigin !== TRUST.sourceOrigin ||
      config.clientId !== TRUST.clientId || config.deploymentInstanceKey !== TRUST.sourceInstance) fail('handoff_instance_mismatch', 503);
  try { validateIdentityRuntimeConfig(config); } catch { fail('handoff_identity_not_ready', 503); }
  // The backchannel Basic credential is derived once; the transport re-validates its shape on every request.
  const authorization = 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  return { authorization, instanceKey: config.deploymentInstanceKey, clientId: config.clientId };
}

function ledgerConnection(env) {
  for (const [name, expected] of Object.entries(REQUIRED)) if (env[name] !== expected) fail('handoff_instance_mismatch', 503);
  const user = env.P03_HANDOFF_DB_USER, password = env.P03_HANDOFF_DB_PASSWORD;
  if (typeof user !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(user) || typeof password !== 'string' || password.length < 16 ||
      user === env.DB_USER) fail('handoff_ledger_role_missing', 503); // the ALL PRIVILEGES application account is never the ledger role
  const database = env.DB_NAME, port = Number(env.DB_PORT || 3306);
  if (typeof database !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(database) || !Number.isInteger(port) || port < 1 || port > 65535) fail('handoff_instance_mismatch', 503);
  return { host: env.DB_HOST || 'localhost', port, user, password, database };
}

// Parses SHOW GRANTS for the connected role. Accepts exactly USAGE on *.* plus SELECT, INSERT, UPDATE, DELETE
// on each of the four ledger tables of the expected database; anything else is too broad or missing.
function assessGrants(rows, database) {
  const seen = new Set();
  for (const row of rows) {
    const text = String(Object.values(row)[0]);
    const match = /^GRANT (.+?) ON (\S+|`[^`]+`\.\S+) TO /.exec(text);
    if (!match) fail('handoff_ledger_role_too_broad', 503);
    const [, privileges, target] = match;
    if (target === '*.*') {
      if (privileges.trim() !== 'USAGE') fail('handoff_ledger_role_too_broad', 503);
      continue;
    }
    const table = /^`([^`]+)`\.`([^`]+)`$/.exec(target);
    if (!table || table[1] !== database || !Object.values(TABLES).includes(table[2])) fail('handoff_ledger_role_too_broad', 503);
    const granted = privileges.split(',').map(s => s.trim()).sort().join(', ');
    if (granted !== LEDGER_PRIVILEGES.split(',').map(s => s.trim()).sort().join(', ')) fail('handoff_ledger_role_too_broad', 503);
    seen.add(table[2]);
  }
  if (Object.values(TABLES).some(t => !seen.has(t))) fail('handoff_ledger_role_missing', 503);
}

// Readiness: the connected account must be the restricted ledger role on the expected database and MySQL 8,
// and the four ledger tables must exist with the expected columns. Facts only; no credential leaves here.
async function probeLedger(pool, database) {
  let facts;
  try {
    const [[identity]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS version');
    if (identity.db !== database) fail('handoff_ledger_database_mismatch', 503);
    if (!/^8\./.test(String(identity.version))) fail('handoff_ledger_version_unsupported', 503);
    const [grants] = await pool.query('SHOW GRANTS FOR CURRENT_USER()');
    assessGrants(grants, database);
    const [columns] = await pool.query(
      'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (?, ?, ?, ?)',
      Object.values(TABLES));
    const present = {};
    for (const row of columns) (present[row.t] = present[row.t] || []).push(row.c);
    for (const [table, expected] of Object.entries(COLUMNS)) {
      if (!present[table]) fail('handoff_ledger_table_missing', 503);
      if (expected.some(c => !present[table].includes(c))) fail('handoff_ledger_schema_mismatch', 503);
    }
    facts = { database, mysql_version: String(identity.version), grant_count: grants.length, tables: Object.values(TABLES) };
  } catch (error) {
    if (error instanceof HandoffError) throw error;
    fail('handoff_ledger_unavailable', 503); // connection or query failure: never the driver message
  }
  return facts;
}

// Builds the runtime. `deps` allows tests and laboratories to inject the pool factory, models, clock and the
// isolated TLS routing (which the transport itself only accepts in development/test).
async function createFormalHandoffRuntime({ env = process.env, deps = {} } = {}) {
  const state = resolveFormalHandoffSwitch(env);
  if (state === 'disabled') return Object.freeze({ enabled: false, switch: 'disabled', close: async () => {} });
  const identity = identityFacts(env);
  const connection = ledgerConnection(env);
  const timeoutMs = env.P03_HANDOFF_TIMEOUT_MS === undefined ? 5000 : Number(env.P03_HANDOFF_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('invalid_handoff_configuration');
  const transport = new I03HttpsTransport({ ...TRUST, getAuthorization: () => identity.authorization, timeoutMs,
    ...(deps.laboratory ? { laboratory: deps.laboratory } : {}) }, env);
  const now = deps.now || Date.now;
  const client = new I03FormalClient({ transport, now, timeoutMs });
  const createPool = deps.createPool || (options => require('mysql2/promise').createPool(options));
  const pool = createPool({ ...connection, connectionLimit: 6, charset: 'utf8mb4', connectTimeout: 5000 });
  let readiness;
  try {
    readiness = await probeLedger(pool, connection.database);
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
  const store = new MySQLHandoffStore({ pool, now });
  const models = deps.models || {
    User: require('../../models/User'), Message: require('../../models/Message'), Conversation: require('../../models/Conversation'), File: require('../../models/File')
  };
  const uploadRoot = deps.uploadRoot || require('../../config').storage.paths.uploads;
  const source = createSourceAdapter({ Message: models.Message, Conversation: models.Conversation, File: models.File, uploadRoot });
  const authority = createHandoffAuthority({ User: models.User, Message: models.Message, Conversation: models.Conversation, store,
    ...(deps.isStudentAccount ? { isStudentAccount: deps.isStudentAccount } : {}) });
  const service = new I03FormalSource({ source, store, authority, client, now, sourceInstance: TRUST.sourceInstance, targetInstance: TRUST.targetInstance });
  let stopCleanup = null;
  return Object.freeze({
    enabled: true, switch: 'enabled', wire: FORMAL_VERSION, service, store, transport,
    readiness: Object.freeze({ ...readiness, identity_client_id: identity.clientId, instance_key: identity.instanceKey,
      source_instance: TRUST.sourceInstance, target_instance: TRUST.targetInstance, checked_at: new Date(now()).toISOString() }),
    startCleanup(options = {}) {
      if (!stopCleanup) stopCleanup = store.startCleanup({ intervalMs: 60000, ...options });
      return stopCleanup;
    },
    async close() {
      if (stopCleanup) { stopCleanup(); stopCleanup = null; }
      await pool.end().catch(() => {});
    }
  });
}

// Server startup hook: disabled costs nothing; an explicit switch that cannot be honoured fails startup closed.
async function bootstrapFormalHandoff({ env = process.env, logger = console, deps } = {}) {
  const runtime = await createFormalHandoffRuntime({ env, deps });
  if (runtime.enabled) {
    runtime.startCleanup();
    logger.info(`P03 formal handoff runtime ready (wire ${runtime.wire}, instance ${runtime.readiness.instance_key}); public save entry stays closed`);
  } else {
    logger.info('P03 formal handoff runtime disabled (default); no ledger connection or peer call');
  }
  return runtime;
}

module.exports = { createFormalHandoffRuntime, bootstrapFormalHandoff, resolveFormalHandoffSwitch, probeLedger, assessGrants, REQUIRED, COLUMNS, SWITCH };
