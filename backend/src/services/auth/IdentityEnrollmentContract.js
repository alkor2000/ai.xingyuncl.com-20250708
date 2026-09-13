'use strict';

const { isIP } = require('node:net');
const { randomUUID, randomBytes } = require('node:crypto');

const MAX_BYTES = 16384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECEIPT_KEYS = ['enrollment_id', 'instance_id', 'identity_issuer', 'identity_client_id',
  'deployment_instance_key', 'public_origin', 'contract_version', 'enrolled_at', 'result'];

// 错误只携带本模块固定分类；不能把JSON正文、Token、Secret或网络异常拼进错误。
function problem(code) { return Object.assign(new Error(code), { code }); }
function requireValue(condition, code = 'ENROLLMENT_CONTRACT_INVALID') {
  if (!condition) throw problem(code);
}
function exactKeys(value, required, optional = []) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value);
  requireValue(required.every(key => Object.hasOwn(value, key)));
  requireValue(keys.every(key => required.includes(key) || optional.includes(key)));
}
function uuid(value) {
  return typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
}
function randomEncoding(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}
function time(value) {
  requireValue(typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value));
  const milliseconds = Date.parse(value);
  requireValue(Number.isFinite(milliseconds));
  return milliseconds;
}

// 严格读取完整JSON，拒绝重复键、尾随正文和超深嵌套。JSON.parse单独使用会覆盖重复键。
function decodeJSON(raw) {
  let text;
  try {
    text = Buffer.isBuffer(raw) ? new TextDecoder('utf-8', { fatal: true }).decode(raw) : raw;
    requireValue(typeof text === 'string' && Buffer.byteLength(text) <= MAX_BYTES);
    let position = 0;
    const space = () => { while (/[\x20\t\r\n]/.test(text[position] || '\0')) position++; };
    function string() {
      const start = position++;
      while (position < text.length) {
        const character = text[position++];
        if (character === '\\') { position++; continue; }
        if (character === '"') {
          const value = JSON.parse(text.slice(start, position));
          for (const symbol of value) {
            const point = symbol.codePointAt(0);
            requireValue(point < 0xd800 || point > 0xdfff);
          }
          return value;
        }
      }
      throw problem('ENROLLMENT_JSON_INVALID');
    }
    function value(depth) {
      requireValue(depth <= 12);
      space();
      const character = text[position];
      if (character === '"') return string();
      if (character === '{' || character === '[') {
        const object = character === '{';
        const result = object ? Object.create(null) : [];
        const closing = object ? '}' : ']';
        position++;
        space();
        if (text[position] === closing) { position++; return result; }
        while (position < text.length) {
          space();
          if (object) {
            requireValue(text[position] === '"');
            const key = string();
            requireValue(!Object.hasOwn(result, key));
            space();
            requireValue(text[position++] === ':');
            result[key] = value(depth + 1);
          } else result.push(value(depth + 1));
          space();
          if (text[position] === closing) { position++; return result; }
          requireValue(text[position++] === ',');
        }
        throw problem('ENROLLMENT_JSON_INVALID');
      }
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position));
      requireValue(Boolean(match));
      position += match[0].length;
      const scalar = JSON.parse(match[0]);
      requireValue(typeof scalar !== 'number' || Number.isFinite(scalar));
      return scalar;
    }
    const result = value(0);
    space();
    requireValue(position === text.length);
    return result;
  } catch { throw problem('ENROLLMENT_JSON_INVALID'); }
}

// 接入授权限定为规范HTTPS DNS来源；禁止凭据、端口和路径，避免发送Token到歧义地址。
function origin(value) {
  requireValue(typeof value === 'string' && value.length <= 2048);
  let parsed;
  try { parsed = new URL(value); } catch { throw problem('ENROLLMENT_CONTRACT_INVALID'); }
  const host = parsed.hostname;
  requireValue(parsed.protocol === 'https:' && value === `https://${host}` && !isIP(host));
  requireValue(host.includes('.') && !host.endsWith('.local') && host.length <= 253);
  requireValue(host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
  return value;
}
function binding(input) {
  exactKeys(input, ['product_code', 'deployment_instance_key', 'display_name', 'public_origin',
    'identity_client_id', 'contract_version', 'account_link_enabled', 'redirect_uris']);
  requireValue(input.product_code === 'ai-platform' && input.contract_version === 1);
  requireValue(typeof input.deployment_instance_key === 'string' && input.deployment_instance_key.length >= 2 &&
    input.deployment_instance_key.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.deployment_instance_key));
  requireValue(typeof input.identity_client_id === 'string' && /^[\x21-\x7e]{2,128}$/.test(input.identity_client_id) &&
    !input.identity_client_id.includes(':'));
  requireValue(typeof input.display_name === 'string' && input.display_name.trim() === input.display_name &&
    [...input.display_name].length >= 1 && [...input.display_name].length <= 200 &&
    !/[\p{Cc}\p{Cs}]/u.test(input.display_name));
  const publicOrigin = origin(input.public_origin);
  // 本消费者只申请AI Platform已有的登录、绑定合同，不自行增加logout或扩大回调用途。
  requireValue(input.account_link_enabled === true && Array.isArray(input.redirect_uris) && input.redirect_uris.length === 2);
  const redirects = ['bind', 'login'].map(purpose => {
    const rows = input.redirect_uris.filter(row => row && row.purpose === purpose);
    requireValue(rows.length === 1);
    exactKeys(rows[0], ['purpose', 'redirect_uri']);
    const expected = publicOrigin + (purpose === 'bind' ? '/api/auth/identity/callback' : '/api/auth/identity/login/callback');
    requireValue(rows[0].redirect_uri === expected);
    return { purpose, redirect_uri: expected };
  });
  return { product_code: 'ai-platform', deployment_instance_key: input.deployment_instance_key,
    display_name: input.display_name, public_origin: publicOrigin, identity_client_id: input.identity_client_id,
    contract_version: 1, account_link_enabled: true, redirect_uris: redirects };
}
function validateRequest(input) {
  exactKeys(input, ['schema_version', 'identity_issuer', 'token_id', 'token_expires_at', 'enrollment_token',
    'idempotency_key', 'nonce', 'timestamp', 'binding']);
  requireValue(input.schema_version === 1 && uuid(input.token_id) && uuid(input.idempotency_key));
  origin(input.identity_issuer);
  requireValue(typeof input.enrollment_token === 'string' && input.enrollment_token.startsWith('pku_enroll_v1_') &&
    randomEncoding(input.enrollment_token.slice('pku_enroll_v1_'.length)) && randomEncoding(input.nonce));
  requireValue(typeof input.timestamp === 'string' && /^[1-9]\d{0,11}$/.test(input.timestamp) &&
    Number(input.timestamp) <= 253402300799);
  time(input.token_expires_at);
  const canonical = binding(input.binding);
  return { ...input, binding: canonical };
}
function createRequest(issuer, rawBinding, issued, now = Date.now()) {
  exactKeys(issued, ['request_id', 'token_id', 'enrollment_token', 'issued_at', 'expires_at']);
  requireValue(uuid(issued.request_id) && uuid(issued.token_id));
  const start = time(issued.issued_at), end = time(issued.expires_at);
  requireValue(Number.isSafeInteger(now) && end - start >= 60000 && end - start <= 86400000 &&
    start <= now + 30000 && end > now, 'ENROLLMENT_TOKEN_EXPIRED_OR_INVALID');
  return validateRequest({ schema_version: 1, identity_issuer: origin(issuer), token_id: issued.token_id,
    token_expires_at: issued.expires_at, enrollment_token: issued.enrollment_token,
    idempotency_key: randomUUID(), nonce: randomBytes(32).toString('base64url'),
    timestamp: String(Math.floor(now / 1000)), binding: binding(rawBinding) });
}
function receipt(input, request, type) {
  const http = type === 'first' || type === 'replay';
  exactKeys(input, [...RECEIPT_KEYS, ...(http ? ['replayed'] :
    ['request_id', 'current_secret_kid', 'instance_status', 'client_status']),
    ...(['first', 'recovery'].includes(type) ? ['client_secret'] : [])]);
  requireValue(uuid(input.enrollment_id) && uuid(input.instance_id));
  requireValue(input.identity_issuer === request.identity_issuer && input.result === 'enrolled_disabled' &&
    input.contract_version === 1 && input.identity_client_id === request.binding.identity_client_id &&
    input.public_origin === request.binding.public_origin &&
    input.deployment_instance_key === request.binding.deployment_instance_key);
  time(input.enrolled_at);
  if (http) requireValue(input.replayed === (type === 'replay'));
  else {
    requireValue(uuid(input.request_id) && /^enroll-v1-[0-9a-f]{32}$/.test(input.current_secret_kid));
    requireValue(input.instance_status === 'disabled' && input.client_status === 'disabled');
  }
  if (type === 'first' || type === 'recovery') requireValue(/^[0-9a-f]{64}$/.test(input.client_secret));
  const safe = Object.fromEntries(RECEIPT_KEYS.map(key => [key, input[key]]));
  if (!http) safe.current_secret_kid = input.current_secret_kid;
  return safe;
}
module.exports = { MAX_BYTES, problem, requireValue, exactKeys, decodeJSON, origin, binding,
  validateRequest, createRequest, receipt };
