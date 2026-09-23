// 线形一致的 edu 资格端点替身：**它不是 edu 的产品代码**。
//
// 它按 edu 固定源码 d2f54c9e 的字节形状回答（成功 200 + EligibilityAnswer，拒绝 403 + error 信封，
// 凭据不过 401 credential_refused，请求不合法 400 invalid_request），并用 edu Verifier 的同一套构造
// 校验签名（verify.go/signing.go 的算法，已对过 edu 自己发布的向量）。名单来自一个可写的 JSON 文件，
// 由 harness 改动——**它替代的是 edu 的名单库，而不是 edu 的判定代码**。
//
// 任何用它得到的结论都必须写成"线形与失败路径已验，edu 真实 Go 判定未执行"。
const fs = require('node:fs');
const https = require('node:https');
const { createHash, timingSafeEqual } = require('node:crypto');

const PATH = '/api/integrations/practice/e09/eligibility';
const REASONS = ['request_incomplete', 'purpose_unsupported', 'instance_mismatch', 'reviewer_unknown',
  'assignment_unknown', 'school_mismatch', 'assignment_closed', 'school_unmapped',
  'student_not_in_roster', 'link_revoked', 'not_eligible'];

const sign = ({ secret, method, path, query, body, timestamp, nonce }) => {
  const canonical = [method, path, query, createHash('sha256').update(body).digest('hex')].join('\n');
  const inner = createHash('sha256').update(canonical).digest('hex');
  return createHash('sha256').update(`${secret}\n${timestamp}\n${nonce}\n${inner}`).digest('hex');
};
const equal = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const answerOf = () => JSON.parse(fs.readFileSync(config.roster_file, 'utf8'));
const seen = new Map();
// 每一次**通过凭据校验**的询问都记一行：测试据此证明"资格端点确实又被问了一次"，
// 而不是靠一个可能根本没发生的调用去解释状态码。
const record = entry => {
  if (!config.call_log) return;
  try { fs.appendFileSync(config.call_log, JSON.stringify({ at: Date.now(), ...entry }) + '\n'); }
  catch { /* 日志失败不影响判定 */ }
};

const server = https.createServer({ key: fs.readFileSync(config.tls_key), cert: fs.readFileSync(config.tls_cert) },
  (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'https://placeholder');
      const send = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const roster = answerOf();
      if (roster.offline) { req.socket.destroy(); return; }
      if (roster.malformed) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>502</html>'); return; }
      const timestamp = Number(req.headers['x-p09-timestamp']);
      const nonce = String(req.headers['x-p09-nonce'] || '');
      const refuseCredential = () => send(401,
        { error: { code: 'credential_refused', message: '调用方凭据未通过', retryable: false } });
      if (req.method !== 'POST' || url.pathname !== PATH) return send(404, { error: { code: 'not_found' } });
      if (req.headers['x-p09-client'] !== config.client || req.headers['x-p09-key-id'] !== config.key_id) return refuseCredential();
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return refuseCredential();
      if (nonce.length < 16 || nonce.length > 128 || seen.has(nonce)) return refuseCredential();
      const want = sign({ secret: config.secret, method: 'POST', path: PATH,
        query: url.search.replace(/^\?/, ''), body, timestamp, nonce });
      if (!equal(want, req.headers['x-p09-signature'] || '')) return refuseCredential();
      seen.set(nonce, Date.now());
      for (const [key, at] of seen) if (Date.now() - at > 600000) seen.delete(key);

      let payload = null;
      try { payload = JSON.parse(body); } catch { return send(400, { error: { code: 'invalid_request' } }); }
      const known = ['schema_version', 'source_instance', 'school_ref', 'assignment_ref', 'reviewer_ref',
        'student_uuid', 'purpose'];
      if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => !known.includes(k))) {
        return send(400, { error: { code: 'invalid_request' } });
      }
      const decided = Math.floor(Date.now() / 1000);
      const refuse = reason => {
        record({ decision: 'refused', reason, reviewer_ref: payload.reviewer_ref,
          assignment_ref: payload.assignment_ref, student_uuid: payload.student_uuid });
        return send(403, { error: { code: 'not_eligible', message: reason, retryable: false }, decided_at: decided });
      };
      if (payload.schema_version !== 1 || !payload.school_ref || !payload.assignment_ref ||
          !payload.reviewer_ref || !payload.student_uuid) return refuse('request_incomplete');
      if (payload.purpose && payload.purpose !== 'website_artifact_review') return refuse('purpose_unsupported');
      if (payload.source_instance && payload.source_instance !== config.source_instance) return refuse('instance_mismatch');
      const rule = (roster.rules || []).find(item =>
        item.reviewer_ref === payload.reviewer_ref && item.school_ref === payload.school_ref &&
        item.assignment_ref === payload.assignment_ref && item.student_uuid === payload.student_uuid);
      if (!rule) return refuse(REASONS.includes(roster.default_reason) ? roster.default_reason : 'not_eligible');
      if (rule.reason) return refuse(REASONS.includes(rule.reason) ? rule.reason : 'not_eligible');
      record({ decision: 'eligible', reviewer_ref: payload.reviewer_ref,
        assignment_ref: payload.assignment_ref, student_uuid: payload.student_uuid });
      return send(200, { schema_version: 1, eligible: true, decided_at: decided, expires_at: decided + 120 });
    });
  });
server.listen(config.port, '127.0.0.1', () => {
  fs.writeFileSync(config.ready_file, JSON.stringify({ port: server.address().port }));
});
