'use strict';

// The http eligibility provider, exercised against a REAL local HTTPS server with its own CA.
//
// What this file proves: that practice builds the request edu's fixed source accepts, signs it the way
// edu's Verifier checks, and turns every possible answer — and every non-answer — into the right
// verdict. What it does NOT prove: that edu's roster service says yes to a real teacher. That needs
// edu's own Go handler running, which is a separate, named step.
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createEligibilityProvider, signEligibility, reviewerHash } =
  require('../../../services/websiteArtifact/eligibility');

const PATH = '/api/integrations/practice/e09/eligibility';
const SECRET = 'e09-lab-client-secret-0123456789abcdef0123';
const AUDIENCE = reviewerHash('edu', '4021');
let tls = null;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e09-tls-'));
  const key = path.join(dir, 'server.key');
  const cert = path.join(dir, 'server.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', key, '-out', cert], { stdio: 'ignore' });
  tls = { dir, key, cert };
});
afterAll(() => { if (tls) fs.rmSync(tls.dir, { recursive: true, force: true }); });

// One server per case: it records what arrived and answers exactly what the case names.
function serve(handler) {
  return new Promise(resolve => {
    const server = https.createServer({ key: fs.readFileSync(tls.key), cert: fs.readFileSync(tls.cert) },
      (req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
      });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
const close = ({ server }) => new Promise(resolve => server.close(resolve));

const providerFor = (port, extra = {}, ca = tls.cert) => createEligibilityProvider({
  mode: 'http', endpoint: `https://localhost:${port}${PATH}`, client_key: 'practice', key_id: 'k1',
  secret: SECRET, source_instance: 'practice-integration', ...(ca ? { ca_file: ca } : {}), ...extra
}, { env: { NODE_ENV: 'production' } });

const ask = provider => provider.check({
  audienceRef: AUDIENCE, schoolRef: 'school-1', assignmentRef: 'assign-1', studentUuid: 'edu-uuid-0001' });

const answer = (res, status, payload) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

describe('C05/P09 eligibility over http: the request edu actually accepts', () => {
  test('the signature is the construction edu verifies, checked against edu own published vector', () => {
    // From edu's vectors_test.go at d2f54c9e (which recomputes the vector published with the fixed
    // practice source). If either side's construction drifts, this line fails.
    expect(signEligibility({ secret: 'p09-vector-client-0123456789abcdef0123456789ab', method: 'GET',
      path: '/api/integrations/edu/website-artifacts/state', query: 'school_ref=school-1', body: '',
      timestamp: 1790000000, nonce: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }))
      .toBe('d39709ccecbaa53454ab1fe3d04bfc04304215e60cf6eacc69a37f5591b190c7');
  });

  test('the body carries exactly the fields edu decodes, and the headers verify', async () => {
    let seen = null;
    const lab = await serve((req, res, body) => {
      seen = { headers: req.headers, body: JSON.parse(body), method: req.method, url: req.url };
      answer(res, 200, { schema_version: 1, eligible: true, decided_at: 1, expires_at: 2 });
    });
    try {
      expect(await ask(providerFor(lab.port))).toEqual({ eligible: true });
      // edu decodes with DisallowUnknownFields: an extra key is a 400, so the set must be exact.
      expect(Object.keys(seen.body).sort()).toEqual(
        ['assignment_ref', 'purpose', 'reviewer_ref', 'schema_version', 'school_ref', 'source_instance', 'student_uuid']);
      expect(seen.body.schema_version).toBe(1);
      expect(seen.body).not.toHaveProperty('audience_ref');     // edu's struct has no such field
      // Recompute the signature the way edu's Verifier does, over the bytes that arrived.
      const expected = signEligibility({ secret: SECRET, method: 'POST', path: PATH, query: '',
        body: JSON.stringify(seen.body), timestamp: Number(seen.headers['x-p09-timestamp']),
        nonce: seen.headers['x-p09-nonce'] });
      expect(seen.headers['x-p09-signature']).toBe(expected);
      expect(seen.headers['x-p09-client']).toBe('practice');
      expect(seen.headers['x-p09-nonce'].length).toBeGreaterThanOrEqual(16);
    } finally { await close(lab); }
  });

  test('a refusal arrives as edu sends it: 403 with the reason in the error envelope', async () => {
    const lab = await serve((req, res) => answer(res, 403,
      { error: { code: 'not_eligible', message: 'student_not_in_roster', retryable: false }, decided_at: 1 }));
    try {
      expect(await ask(providerFor(lab.port))).toEqual({ eligible: false, reason: 'student_not_in_roster' });
    } finally { await close(lab); }
  });

  test('a refusal whose reason is not in the vocabulary is still a refusal, not an echo', async () => {
    const lab = await serve((req, res) => answer(res, 403,
      { error: { code: 'not_eligible', message: '<script>surprise</script>' } }));
    try {
      expect(await ask(providerFor(lab.port))).toEqual({ eligible: false, reason: 'not_eligible' });
    } finally { await close(lab); }
  });
});

describe('nothing that is not an answer becomes a pass', () => {
  const unavailable = { eligible: false, reason: 'eligibility_unavailable' };

  test('a string instead of a boolean does not get coerced', async () => {
    const lab = await serve((req, res) => answer(res, 200, { schema_version: 1, eligible: 'true' }));
    try { expect(await ask(providerFor(lab.port))).toEqual(unavailable); } finally { await close(lab); }
  });

  test('a body without the schema version is not an answer', async () => {
    const lab = await serve((req, res) => answer(res, 200, { eligible: true }));
    try { expect(await ask(providerFor(lab.port))).toEqual(unavailable); } finally { await close(lab); }
  });

  test('our own credential being refused is unavailable, never "the teacher may not look"', async () => {
    const lab = await serve((req, res) => answer(res, 401,
      { error: { code: 'credential_refused', message: '调用方凭据未通过' } }));
    try { expect(await ask(providerFor(lab.port))).toEqual(unavailable); } finally { await close(lab); }
  });

  test('a malformed request answer, a server error and an error page are all unavailable', async () => {
    for (const [status, payload] of [[400, { error: { code: 'invalid_request' } }], [500, { error: {} }],
      [502, '<html><body>502 Bad Gateway</body></html>'], [200, 'not json at all']]) {
      const lab = await serve((req, res) => answer(res, status, payload));
      try { expect(await ask(providerFor(lab.port))).toEqual(unavailable); } finally { await close(lab); }
    }
  });

  test('a redirect is never followed, so the signature never travels somewhere else', async () => {
    const lab = await serve((req, res) => {
      res.writeHead(302, { location: 'https://elsewhere.example/eligibility' });
      res.end();
    });
    try { expect(await ask(providerFor(lab.port))).toEqual(unavailable); } finally { await close(lab); }
  });

  test('an oversized answer is dropped rather than parsed', async () => {
    const lab = await serve((req, res) => answer(res, 200,
      { schema_version: 1, eligible: true, padding: 'x'.repeat(2000) }));
    try {
      expect(await ask(providerFor(lab.port, { max_bytes: 512 }))).toEqual(unavailable);
    } finally { await close(lab); }
  });

  test('a provider that does not answer in time is unavailable, not permissive', async () => {
    const lab = await serve(() => { /* never answers */ });
    try {
      const started = Date.now();
      expect(await ask(providerFor(lab.port, { timeout_ms: 300 }))).toEqual(unavailable);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally { await close(lab); }
  });

  test('a certificate this deployment does not trust is unavailable', async () => {
    const lab = await serve((req, res) => answer(res, 200, { schema_version: 1, eligible: true }));
    try {
      // No ca_file: the self-signed certificate is not in the system store, so the call fails closed.
      expect(await ask(providerFor(lab.port, {}, null))).toEqual(unavailable);
    } finally { await close(lab); }
  });

  test('an outage after a success is still an outage: no last answer is reused', async () => {
    const good = await serve((req, res) => answer(res, 200, { schema_version: 1, eligible: true }));
    const provider = providerFor(good.port);
    expect(await ask(provider)).toEqual({ eligible: true });
    await close(good);
    expect(await ask(provider)).toEqual(unavailable);
  });
});

describe('what this deployment can prove about a reviewer', () => {
  test("edu's handler wants its own reviewer id, and this repository keeps only the hash", async () => {
    let seen = null;
    const lab = await serve((req, res, body) => {
      seen = JSON.parse(body);
      answer(res, 200, { schema_version: 1, eligible: true });
    });
    try {
      await ask(providerFor(lab.port));
      // Default: send what the session actually holds. edu's teaches() parses this as a numeric user
      // id, so a hash is `reviewer_unknown` there — the difference is named in the delivery document.
      expect(seen.reviewer_ref).toBe(AUDIENCE);
    } finally { await close(lab); }
  });

  test('a named mapping supplies the reviewer id, and an unmapped one is refused without a call', async () => {
    let called = 0;
    const lab = await serve((req, res, body) => {
      called += 1;
      expect(JSON.parse(body).reviewer_ref).toBe('4021');
      answer(res, 200, { schema_version: 1, eligible: true });
    });
    try {
      const mapped = providerFor(lab.port, { reviewer_ref: 'mapping', reviewer_refs: { [AUDIENCE]: '4021' } });
      expect(await ask(mapped)).toEqual({ eligible: true });
      expect(await mapped.check({ audienceRef: reviewerHash('edu', '9999'), schoolRef: 'school-1',
        assignmentRef: 'assign-1', studentUuid: 'edu-uuid-0001' }))
        .toEqual({ eligible: false, reason: 'reviewer_unknown' });
      expect(called).toBe(1);                       // the unmapped one never reached the network
    } finally { await close(lab); }
  });

  test('http may be assembled in a production configuration; static may not', () => {
    expect(providerFor(1).mode).toBe('http');
    expect(() => createEligibilityProvider({ mode: 'static', rules: [] }, { env: { NODE_ENV: 'production' } }))
      .toThrow();
    expect(() => createEligibilityProvider({ mode: 'http', endpoint: 'http://edu.example/x',
      client_key: 'practice', key_id: 'k1', secret: 'x'.repeat(40) }, { env: { NODE_ENV: 'production' } }))
      .toThrow();                                   // https only
  });

  test('no provider at all still refuses, and caching defaults to asking every time', () => {
    expect(createEligibilityProvider(null).mode).toBe('absent');
    expect(providerFor(1).cacheMs).toBe(0);
  });
});
