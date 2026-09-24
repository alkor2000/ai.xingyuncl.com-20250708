'use strict';

// Default-off runtime for the P09 website-artifact source side. Unset or "false" costs nothing: no
// pool, no credential read, no listener, and every mounted route answers website_artifacts_disabled.
// "true" builds strictly and fails startup closed when any instance, issuer, ledger or preview fact is
// missing or wrong; any other value is a configuration error, never an implicit "on".
//
// Trust facts, in order: the instance identity (one name per deployment, never two schemes), the task
// context issuers (absent ⇒ the endpoints exist and refuse — that is the deployed state until edu has a
// real issuer), the restricted ledger role, and the isolated preview origin (absent ⇒ no preview).
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { fail, P09Error } = require('./errors');
const { WebsiteArtifactStore, TABLES } = require('./store');
const { TaskGrantVerifier, parseIssuers } = require('./taskGrant');
const { createSourceReader } = require('./snapshot');
const { createAssetResolver } = require('./assets');
const { createEligibilityProvider } = require('./eligibility');
const { createSubmitRelay } = require('./submitRelay');
const { createWebsiteArtifactService } = require('./service');

const SWITCH = 'P09_WEBSITE_ARTIFACTS_ENABLED';
const LAB = 'P09_LAB';
const INSTANCE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function resolveSwitch(env = process.env) {
  const value = env[SWITCH];
  if (value === undefined || value === '' || value === 'false') return 'disabled';
  if (value === 'true') return 'enabled';
  fail('invalid_request');
}

// Laboratory facts for a non-production run of the real server: issuers, preview origin and the
// synthetic instance name. Honoured only in development/test; production refuses the variable outright.
function laboratory(env) {
  const file = env[LAB];
  if (file === undefined || file === '') return null;
  if (!['development', 'test'].includes(env.NODE_ENV)) fail('invalid_request');
  let spec;
  try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('invalid_request'); }
  const keys = ['source_instance', 'issuers', 'preview_origin', 'integration_clients', 'eligibility', 'submit', 'app_hosts'];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some(k => !keys.includes(k)) ||
      typeof spec.source_instance !== 'string' || !INSTANCE.test(spec.source_instance)) fail('invalid_request');
  return spec;
}

function instanceIdentity(env, lab) {
  const configured = lab ? lab.source_instance : env.P09_SOURCE_INSTANCE;
  if (typeof configured !== 'string' || !INSTANCE.test(configured) || configured.length < 2 || configured.length > 64) fail('invalid_request');
  // One deployment, one instance name: when Identity is enrolled its key is the authority and P09 may
  // not invent a second identity for the same site.
  const identityKey = env.IDENTITY_DEPLOYMENT_INSTANCE_KEY;
  if (!lab && typeof identityKey === 'string' && identityKey !== '' && identityKey !== configured) fail('invalid_request');
  return configured;
}

// Issuers come from a private file in production (0400/0600 next to the other deployment credentials);
// inline JSON is a development/test convenience only.
function issuersFrom(env, lab) {
  if (lab) return parseIssuers(JSON.stringify(lab.issuers ?? []));
  const file = env.P09_TASK_ISSUERS_FILE;
  if (typeof file === 'string' && file !== '') {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { fail('task_context_unavailable', 503); }
    return parseIssuers(raw);
  }
  if (env.P09_TASK_ISSUERS && ['development', 'test'].includes(env.NODE_ENV)) return parseIssuers(env.P09_TASK_ISSUERS);
  return [];   // strict refusal: the endpoints exist, every grant-bearing call is refused
}

// Static service credentials for edu's server-side reads. contracts/integration-clients.md does not
// exist yet, so this registry is a named candidate: client key, key id, secret hash, allowed actions
// and the school scope the client may read. Secrets are never held in memory in the clear.
function integrationClients(env, lab) {
  const raw = lab ? JSON.stringify(lab.integration_clients ?? []) : (() => {
    const file = env.P09_INTEGRATION_CLIENTS_FILE;
    if (typeof file !== 'string' || file === '') return '[]';
    try { return fs.readFileSync(file, 'utf8'); } catch { fail('invalid_request'); }
  })();
  let list;
  try { list = JSON.parse(raw); } catch { fail('invalid_request'); }
  if (!Array.isArray(list) || list.length > 8) fail('invalid_request');
  return list.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['client_key', 'key_id', 'secret', 'actions', 'school_refs'].includes(k)) ||
        typeof item.client_key !== 'string' || !/^[a-z0-9_-]{2,32}$/.test(item.client_key) ||
        typeof item.key_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(item.key_id) ||
        typeof item.secret !== 'string' || item.secret.length < 32 ||
        !Array.isArray(item.actions) || item.actions.some(a => !['artifacts:read', 'artifacts:review', 'artifacts:freeze'].includes(a)) ||
        !Array.isArray(item.school_refs) || item.school_refs.some(s => typeof s !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(s))) fail('invalid_request');
    return Object.freeze({ clientKey: item.client_key, keyId: item.key_id, secret: item.secret,
      actions: Object.freeze([...item.actions]), schoolRefs: Object.freeze([...item.school_refs]) });
  });
}

// The eligibility provider's configuration. `P09_ELIGIBILITY_FILE` is the deployment form (http only,
// readable in any NODE_ENV); P09_LAB's inline spec stays development/test, exactly as before.
function eduIntegrationFile(env) {
  const file = env.P09_ELIGIBILITY_FILE;
  if (typeof file !== 'string' || file === '') return null;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { fail('invalid_request'); }
  let spec;
  try { spec = JSON.parse(raw); } catch { fail('invalid_request'); }
  if (!spec || spec.mode !== 'http') fail('invalid_request');     // the file form is for the real provider
  return spec;
}

function eligibilitySpec(env, lab, file) {
  if (file) {
    // The optional `submit` block travels in the same file because it is the same credential pair on
    // the same channel (edu 134d1d8 §3); it is split off here so the provider keeps its strict shape.
    const { submit, ...eligibility } = file;
    return createEligibilityProvider(eligibility, { env });
  }
  return lab && lab.eligibility ? createEligibilityProvider(lab.eligibility, { env }) : null;
}

// The 交作业 relay. It is configured only where the reviewer provider is — one credential, one channel —
// and it stays absent unless a deployment names edu's submit endpoint. Absent means the button refuses
// by name (`submit_unconfigured`) and nothing leaves this process.
function submitRelaySpec(env, lab, file) {
  const block = file ? file.submit : (lab ? lab.submit : null);
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const inherit = file || (lab && lab.eligibility) || {};
  const spec = {
    client_key: block.client_key ?? inherit.client_key,
    key_id: block.key_id ?? inherit.key_id,
    secret: block.secret ?? inherit.secret,
    endpoint: block.endpoint,
    ...(block.source_instance ?? inherit.source_instance ? { source_instance: block.source_instance ?? inherit.source_instance } : {}),
    ...(block.ca_file ?? inherit.ca_file ? { ca_file: block.ca_file ?? inherit.ca_file } : {}),
    ...(block.timeout_ms !== undefined ? { timeout_ms: block.timeout_ms } : {}),
    ...(block.max_bytes !== undefined ? { max_bytes: block.max_bytes } : {})
  };
  return createSubmitRelay(spec, { env });
}

function previewOrigin(env, lab) {
  const value = lab ? lab.preview_origin : env.P09_PREVIEW_ORIGIN;
  if (value === undefined || value === null || value === '') return null;
  let url;
  try { url = new URL(value); } catch { fail('invalid_request'); }
  const httpAllowed = ['development', 'test'].includes(env.NODE_ENV);
  if (!(url.protocol === 'https:' || (httpAllowed && url.protocol === 'http:')) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) fail('invalid_request');
  // The isolated origin must not be the application's own origin: student HTML never runs same-origin
  // with the API or the app (workspace hard constraint).
  const appOrigin = env.APP_DOMAIN ? `https://${env.APP_DOMAIN}` : null;
  if (appOrigin && url.origin === appOrigin) fail('invalid_request');
  return { origin: url.origin, hostname: url.hostname, port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80) };
}

function ledgerConnection(env) {
  const user = env.P09_DB_USER;
  const password = env.P09_DB_PASSWORD;
  if (typeof user !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(user) || typeof password !== 'string' ||
      password.length < 16 || user === env.DB_USER) fail('invalid_request'); // never the ALL PRIVILEGES app account
  const database = env.DB_NAME;
  const port = Number(env.DB_PORT || 3306);
  if (typeof database !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(database) || !Number.isInteger(port) || port < 1 || port > 65535) fail('invalid_request');
  return { host: env.DB_HOST || 'localhost', port, user, password, database };
}

// Readiness facts only: the connected account must be the restricted role on the expected MySQL 8
// database and the ledger tables must exist. No credential or driver message ever leaves this function.
async function probeLedger(pool, database) {
  try {
    const [[identity]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS version');
    if (identity.db !== database) fail('storage_unavailable', 503);
    if (!/^8\./.test(String(identity.version))) fail('storage_unavailable', 503);
    const [rows] = await pool.query(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?,?,?,?,?,?,?,?)',
      Object.values(TABLES));
    const present = new Set(rows.map(row => row.t));
    const missing = Object.values(TABLES).filter(table => !present.has(table));
    if (missing.length) fail('storage_unavailable', 503);
    return { database, mysql_version: String(identity.version), tables: Object.values(TABLES) };
  } catch (error) {
    if (error instanceof P09Error) throw error;
    fail('storage_unavailable', 503);
  }
}

// Where the platform actually writes uploads. P09 only ever reads inside this root, and only files a
// model row proves belong to the student whose work is being frozen.
function uploadRootFrom(env) {
  try { return require('../../config').getStoragePath('uploads'); }
  catch { return require('node:path').resolve(env.STORAGE_PATH || process.cwd(), 'uploads'); }
}
// How often the background catch-up runs. Bounded by the service's own per-sweep limits; a deployment
// may slow it down but not switch it off, because that is what makes a lost marker recoverable.
function sweepIntervalFrom(env) {
  const raw = Number(env.P09_SYNC_INTERVAL_MS ?? 60000);
  if (!Number.isFinite(raw)) fail('invalid_request');
  return Math.min(Math.max(Math.trunc(raw), 5000), 600000);
}
// How long a work may go unverified before the self-healing pass re-reads it against the source. It is
// the recovery window for a change whose durable marker was itself lost.
function verifyAfterFrom(env) {
  const raw = Number(env.P09_SYNC_VERIFY_MS ?? 300000);
  if (!Number.isFinite(raw)) fail('invalid_request');
  return Math.min(Math.max(Math.trunc(raw), 10000), 3600000);
}

async function createWebsiteArtifactRuntime({ env = process.env, deps = {} } = {}) {
  if (resolveSwitch(env) === 'disabled') return Object.freeze({ enabled: false, switch: 'disabled', close: async () => {} });
  const lab = laboratory(env);
  const sourceInstance = instanceIdentity(env, lab);
  const issuers = issuersFrom(env, lab);
  const clients = integrationClients(env, lab);
  const preview = previewOrigin(env, lab);
  const connection = ledgerConnection(env);
  const now = deps.now || Date.now;
  const createPool = deps.createPool || (options => require('mysql2/promise').createPool(options));
  const pool = createPool({ ...connection, connectionLimit: 6, charset: 'utf8mb4', connectTimeout: 5000, decimalNumbers: true });
  let readiness;
  try { readiness = await probeLedger(pool, connection.database); }
  catch (error) { await pool.end().catch(() => {}); throw error; }
  const store = new WebsiteArtifactStore({ pool, now });
  const models = deps.models || { User: require('../../models/User'), HtmlProject: require('../../models/HtmlProject'), HtmlPage: require('../../models/HtmlPage') };
  const source = deps.sourceQuery || ((sql, params) => require('../../database/connection').query(sql, params));
  // This deployment's own hostnames. The platform hands students absolute upload URLs on its own
  // domain (ossService builds them), so those references are the same local object — anything else
  // stays external and is never fetched.
  const ownHosts = [env.APP_DOMAIN, ...(lab && Array.isArray(lab.app_hosts) ? lab.app_hosts : [])]
    .filter(host => typeof host === 'string' && host !== '')
    .map(host => String(host).replace(/^https?:\/\//, '').split('/')[0].toLowerCase());
  const assets = createAssetResolver({ models: { query: source }, uploadRoot: deps.uploadRoot || uploadRootFrom(env), ownHosts });
  const reader = createSourceReader({ HtmlProject: models.HtmlProject, HtmlPage: models.HtmlPage, sourceInstance, assets });
  const grants = new TaskGrantVerifier({ issuers, audience: sourceInstance, now });
  // Reviewer eligibility. A deployment asks edu itself through `mode: 'http'`, named in its own file;
  // the laboratory's fixed roster is still only reachable through P09_LAB. Absent either way, the
  // interface exists and refuses — a teacher is never let in because nobody could be asked.
  const eduFile = eduIntegrationFile(env);
  const eligibility = eligibilitySpec(env, lab, eduFile);
  // Handing the work in: same file, same credential, one fixed endpoint, never configured by a browser.
  const submitRelay = submitRelaySpec(env, lab, eduFile);
  // A grant signed by a key this deployment no longer configures cannot keep a session alive.
  const issuerKeys = new Set(issuers.map(i => `${i.issuer}:${i.keyId}`));
  const issuerActive = key => issuerKeys.has(String(key));
  const verifyAfterMs = verifyAfterFrom(env);
  const logger = deps.logger || (() => { try { return require('../../utils/logger'); } catch { return null; } })();
  const service = createWebsiteArtifactService({ store, reader, models, sourceInstance, previewEnabled: !!preview,
    now, assets, eligibility, submitRelay, issuerActive, verifyAfterMs, logger });
  // Background catch-up: bounded, unreferenced, and never a substitute for the durable pending marker.
  const sweepIntervalMs = sweepIntervalFrom(env);
  const timer = setInterval(() => { service.sweep().catch(() => {}); }, sweepIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return Object.freeze({
    enabled: true, switch: 'enabled', sourceInstance, service, store, grants, preview, assets,
    clients: Object.freeze(clients),
    readiness: Object.freeze({ ...readiness, source_instance: sourceInstance, task_context_configured: issuers.length > 0,
      task_issuers: issuers.map(i => `${i.issuer}:${i.keyId}`), integration_clients: clients.map(c => `${c.clientKey}:${c.keyId}`),
      preview_origin: preview ? preview.origin : null, laboratory: !!lab,
      eligibility_provider: eligibility ? eligibility.mode : 'absent',
      // Enough to tell two deployments apart in a log line, and nothing that could leak a credential.
      eligibility_endpoint: eligibility && eligibility.endpointHost ? eligibility.endpointHost : null,
      eligibility_reviewer_ref: eligibility && eligibility.reviewerRefMode ? eligibility.reviewerRefMode : null,
      eligibility_cache_ms: eligibility ? eligibility.cacheMs : null, own_hosts: ownHosts,
      submit_relay: submitRelay ? 'http' : 'absent',
      submit_endpoint: submitRelay ? submitRelay.endpointHost : null,
      submit_timeout_ms: submitRelay ? submitRelay.timeoutMs : null,
      sync_interval_ms: sweepIntervalMs,
      sync_verify_ms: verifyAfterMs,
      checked_at: new Date(now()).toISOString() }),
    async close() { clearInterval(timer); await pool.end().catch(() => {}); }
  });
}

async function bootstrapWebsiteArtifacts({ env = process.env, logger = console, deps } = {}) {
  const runtime = await createWebsiteArtifactRuntime({ env, deps });
  if (runtime.enabled) {
    logger.info(`P09 website artifacts ready (instance ${runtime.sourceInstance}, task context ${runtime.readiness.task_context_configured ? 'configured' : 'absent: every grant refused'}, preview ${runtime.preview ? 'isolated origin' : 'off'}, reviewer eligibility ${runtime.readiness.eligibility_provider})`);
  } else {
    logger.info('P09 website artifacts disabled (default); no ledger connection, credential read or preview origin');
  }
  return runtime;
}

// Signature check for edu's server-side reads (candidate; see the delivery doc). Same shape as C05:
// HMAC-SHA256(secret, timestamp + "\n" + nonce + "\n" + sha256(canonical request)).
function verifyClient({ clients, clientKey, keyId, timestamp, nonce, signature, canonical, now = Date.now, action, schoolRef }) {
  const client = clients.find(c => c.clientKey === clientKey && c.keyId === keyId);
  if (!client) fail('unauthenticated', 401);
  if (!client.actions.includes(action)) fail('forbidden', 403);
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now() / 1000) - seconds) > 300) fail('unauthenticated', 401);
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) fail('unauthenticated', 401);
  const expected = createHash('sha256').update(`${client.secret}\n${seconds}\n${nonce}\n${createHash('sha256').update(canonical).digest('hex')}`).digest('hex');
  if (typeof signature !== 'string' || signature.length !== expected.length) fail('unauthenticated', 401);
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) fail('unauthenticated', 401);
  if (schoolRef !== undefined && !client.schoolRefs.includes(schoolRef)) fail('school_not_provisioned', 404);
  return client;
}

module.exports = { createWebsiteArtifactRuntime, bootstrapWebsiteArtifacts, resolveSwitch, probeLedger, verifyClient, SWITCH, LAB };
