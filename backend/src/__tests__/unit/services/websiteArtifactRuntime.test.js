'use strict';

// Deployment posture: the switch, the instance identity, where issuers and client credentials may come
// from, and the isolated preview origin. Plus the task-grant verification matrix, which is the only way
// an assignment or a student subject can enter the source side.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createWebsiteArtifactRuntime, resolveSwitch, verifyClient } = require('../../../services/websiteArtifact/runtime');
const { TaskGrantVerifier, parseIssuers, signGrant } = require('../../../services/websiteArtifact/taskGrant');
const { TABLES } = require('../../../services/websiteArtifact/store');

const SECRET = 'lab-issuer-secret-'.repeat(3);
const INSTANCE = 'practice-lab';
// A scripted mysql2-like pool: only the readiness queries are answered and nothing is ever written.
function fakePool({ database = 'ai_platform', version = '8.0.43', tables = Object.values(TABLES) } = {}) {
  let ended = false;
  return {
    get ended() { return ended; },
    async query(sql) {
      if (sql.startsWith('SELECT DATABASE()')) return [[{ db: database, version }]];
      if (sql.includes('information_schema.tables')) return [tables.map(t => ({ t }))];
      throw new Error('unexpected query');
    },
    async getConnection() { throw new Error('unexpected connection'); },
    async end() { ended = true; }
  };
}
const models = { User: { findById: async () => null }, HtmlProject: { findById: async () => null },
  HtmlPage: { getUserPages: async () => ({ data: [] }), compileContent: () => '' } };
function labFile(spec) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p09-lab-')), 'lab.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
}
const ledgerEnv = { DB_NAME: 'ai_platform', DB_USER: 'ai_user', DB_PORT: '3306',
  P09_DB_USER: 'p09_ledger', P09_DB_PASSWORD: 'ledger-role-synthetic-value' };
const build = (env, options) => {
  const pools = [];
  return { pools, promise: createWebsiteArtifactRuntime({ env, deps: { models, now: () => 1790000000000,
    createPool: () => { const pool = fakePool(options); pools.push(pool); return pool; } } }) };
};

describe('P09 runtime switch and facts', () => {
  test('unset or "false" is off with no pool or credential read; any other value is a configuration error', async () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: '' },
      { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: 'false' }]) {
      const { promise, pools } = build(env);
      const runtime = await promise;
      expect(runtime).toMatchObject({ enabled: false, switch: 'disabled' });
      expect(runtime.service).toBeUndefined();
      expect(pools).toHaveLength(0);
      await runtime.close();
    }
    for (const value of ['1', 'TRUE', 'yes', 'on', ' true']) {
      expect(() => resolveSwitch({ P09_WEBSITE_ARTIFACTS_ENABLED: value })).toThrow('invalid_request');
    }
  });

  test('enabled without issuers still builds: the endpoints exist and refuse every grant', async () => {
    const env = { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: 'true', P09_SOURCE_INSTANCE: 'pku-ai-platform-prod', ...ledgerEnv };
    const runtime = await build(env).promise;
    expect(runtime.readiness).toMatchObject({ task_context_configured: false, preview_origin: null, source_instance: 'pku-ai-platform-prod' });
    expect(() => runtime.grants.verify('anything', 'website_artifact_link')).toThrow('task_context_unavailable');
    expect(runtime.preview).toBeNull();
    await runtime.close();
  });

  test('the instance name is one per deployment and the laboratory file is refused in production', async () => {
    const base = { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: 'true', ...ledgerEnv };
    // A second naming scheme next to an enrolled Identity instance key is rejected.
    await expect(build({ ...base, P09_SOURCE_INSTANCE: 'something-else', IDENTITY_DEPLOYMENT_INSTANCE_KEY: 'pku-ai-platform-prod' }).promise)
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(build({ ...base, P09_SOURCE_INSTANCE: 'Not An Instance' }).promise).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(build({ ...base, P09_SOURCE_INSTANCE: 'pku-ai-platform-prod',
      P09_LAB: labFile({ source_instance: INSTANCE }) }).promise).rejects.toMatchObject({ code: 'invalid_request' });
    // The ledger role is never the application account.
    await expect(build({ ...base, P09_SOURCE_INSTANCE: 'pku-ai-platform-prod', P09_DB_USER: 'ai_user' }).promise)
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  test('the preview origin must be a real, separate https origin; the app origin is refused', async () => {
    const base = { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: 'true', P09_SOURCE_INSTANCE: 'pku-ai-platform-prod',
      APP_DOMAIN: 'ai.pkuailab.com', ...ledgerEnv };
    for (const origin of ['https://ai.pkuailab.com', 'http://pages.pkuailab.com', 'https://pages.pkuailab.com/base', 'not-a-url']) {
      await expect(build({ ...base, P09_PREVIEW_ORIGIN: origin }).promise).rejects.toMatchObject({ code: 'invalid_request' });
    }
    const runtime = await build({ ...base, P09_PREVIEW_ORIGIN: 'https://pages.pkuailab.com' }).promise;
    expect(runtime.preview).toMatchObject({ origin: 'https://pages.pkuailab.com', hostname: 'pages.pkuailab.com', port: 443 });
    await runtime.close();
  });

  test('readiness refuses a wrong database, an old MySQL and a missing ledger table, and closes the pool', async () => {
    const env = { NODE_ENV: 'production', P09_WEBSITE_ARTIFACTS_ENABLED: 'true', P09_SOURCE_INSTANCE: 'pku-ai-platform-prod', ...ledgerEnv };
    for (const options of [{ database: 'other_db' }, { version: '5.7.44' }, { tables: [TABLES.links] }]) {
      const { promise, pools } = build(env, options);
      await expect(promise).rejects.toMatchObject({ code: 'storage_unavailable' });
      expect(pools[0].ended).toBe(true);
    }
  });

  test('a laboratory run in test mode carries its own instance, issuers and preview origin', async () => {
    const file = labFile({ source_instance: INSTANCE, preview_origin: 'http://preview.localhost:4599',
      issuers: [{ issuer: 'edu', key_id: 'k1', secret: SECRET, purposes: ['website_artifact_link'] }],
      integration_clients: [{ client_key: 'edu', key_id: 'k1', secret: SECRET, actions: ['artifacts:read'], school_refs: ['123'] }] });
    const runtime = await build({ NODE_ENV: 'test', P09_WEBSITE_ARTIFACTS_ENABLED: 'true', P09_LAB: file, ...ledgerEnv }).promise;
    expect(runtime.readiness).toMatchObject({ laboratory: true, task_context_configured: true, source_instance: INSTANCE });
    expect(runtime.clients.map(client => client.clientKey)).toEqual(['edu']);
    expect(JSON.stringify(runtime.readiness)).not.toContain(SECRET);
    await runtime.close();
  });
});

describe('P09 task grant verification', () => {
  const issuers = parseIssuers(JSON.stringify([{ issuer: 'edu', key_id: 'k1', secret: SECRET,
    purposes: ['website_artifact_link', 'website_artifact_review'] }]));
  const verifier = new TaskGrantVerifier({ issuers, audience: INSTANCE });
  const now = () => Math.floor(Date.now() / 1000);
  const base = () => ({ secret: SECRET, schema_version: 1, issuer: 'edu', key_id: 'k1', grant_id: randomUUID(),
    audience: INSTANCE, purpose: 'website_artifact_link', school_ref: '123', assignment_ref: 'assign-1',
    lesson_ref: null, subject: { uuid: 'edu-uuid-0001', cohort: 'student' }, issued_at: now(), expires_at: now() + 300 });

  test('a well formed grant yields exactly the scope it signed', () => {
    const grant = verifier.verify(signGrant(base()), 'website_artifact_link');
    expect(grant).toMatchObject({ assignmentRef: 'assign-1', schoolRef: '123', subjectUuid: 'edu-uuid-0001', issuer: 'edu' });
    expect(grant.reviewerRef).toBeNull();
  });

  test('every tampered, stale, foreign or unknown-field grant is refused with a fixed code', () => {
    const cases = [
      ['task_context_invalid', { ...base(), secret: 'z'.repeat(40) }],
      ['task_context_invalid', { ...base(), key_id: 'k2' }],
      ['task_context_invalid', { ...base(), schema_version: 2 }],
      ['task_context_invalid', { ...base(), subject: { uuid: 'edu-uuid-0001', cohort: 'teacher' } }],
      ['task_context_invalid', { ...base(), purpose: 'website_artifact_revision' }],
      ['task_context_invalid', { ...base(), expires_at: now() + 4000 }],
      ['task_context_expired', { ...base(), issued_at: now() - 2000, expires_at: now() - 1000 }],
      ['task_context_instance_mismatch', { ...base(), audience: 'xingyun-ai-platform-test' }]
    ];
    for (const [code, payload] of cases) {
      expect(() => verifier.verify(signGrant(payload), 'website_artifact_link')).toThrow(code);
    }
    // Unknown fields and malformed envelopes never reach the business layer.
    const extra = signGrant({ ...base(), teacher_can_view: true });
    expect(() => verifier.verify(extra, 'website_artifact_link')).toThrow('task_context_invalid');
    for (const token of ['', 'p09g.x', 'p09g..', 'other.aaa.bbb', 'p09g.' + Buffer.from('{}').toString('base64url') + '.zz']) {
      expect(() => verifier.verify(token, 'website_artifact_link')).toThrow(/task_context_(invalid|required)/);
    }
  });

  test('a reviewer grant names one artifact and hides the teacher identity behind a hash', () => {
    const reviewerIssuers = parseIssuers(JSON.stringify([{ issuer: 'edu', key_id: 'k1', secret: SECRET, purposes: ['website_artifact_review'] }]));
    const reviewVerifier = new TaskGrantVerifier({ issuers: reviewerIssuers, audience: INSTANCE });
    const artifact = randomUUID();
    const token = signGrant({ ...base(), purpose: 'website_artifact_review', subject: undefined,
      reviewer: { ref: 'teacher-7' }, artifact_ref: artifact, expires_at: now() + 200 });
    const grant = reviewVerifier.verify(token, 'website_artifact_review');
    expect(grant.artifactRef).toBe(artifact);
    expect(grant.subjectUuid).toBeNull();
    expect(grant.reviewerRef).toMatch(/^[0-9a-f]{64}$/);
    expect(grant.reviewerRef).not.toContain('teacher-7');
  });
});

describe('P09 service credential', () => {
  const clients = [{ clientKey: 'edu', keyId: 'k1', secret: SECRET, actions: ['artifacts:read'], schoolRefs: ['123'] }];
  const good = () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, '');
    const canonical = 'GET\n/state\nschool_ref=123\nx';
    const signature = require('node:crypto').createHash('sha256')
      .update(`${SECRET}\n${timestamp}\n${nonce}\n${require('node:crypto').createHash('sha256').update(canonical).digest('hex')}`).digest('hex');
    return { clients, clientKey: 'edu', keyId: 'k1', timestamp, nonce, signature, canonical, action: 'artifacts:read', schoolRef: '123' };
  };
  test('accepts its own signature and refuses an unknown client, a stale stamp, a wrong action or school', () => {
    expect(verifyClient(good()).clientKey).toBe('edu');
    expect(() => verifyClient({ ...good(), clientKey: 'other' })).toThrow('unauthenticated');
    expect(() => verifyClient({ ...good(), timestamp: Math.floor(Date.now() / 1000) - 3000 })).toThrow('unauthenticated');
    expect(() => verifyClient({ ...good(), signature: 'f'.repeat(64) })).toThrow('unauthenticated');
    expect(() => verifyClient({ ...good(), action: 'artifacts:review' })).toThrow('forbidden');
    expect(() => verifyClient({ ...good(), schoolRef: '456' })).toThrow('school_not_provisioned');
  });
});
