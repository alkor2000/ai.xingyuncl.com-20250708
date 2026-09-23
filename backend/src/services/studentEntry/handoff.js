'use strict';

// The one-time handoff the browser carries. Two rules the contract rests on:
//   * the plain ticket exists once, in the exchange response; Redis holds only its sha256, so reading
//     the store never yields something that can be redeemed;
//   * consumption is a single atomic getDel, so a replayed or concurrent second use finds nothing.
// Redis is not optional here: without it there is no atomic consume, and the entry refuses rather than
// degrading to something that could be used twice.
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { fail } = require('./errors');

const TICKET = /^[A-Za-z0-9_-]{43}$/;
const KEY = 'c05:handoff:';
const NONCE_KEY = 'c05:nonce:';
const RATE_KEY = 'c05:rate:';
const sha256 = value => createHash('sha256').update(value).digest('hex');

function createHandoffStore({ redis, now = Date.now }) {
  if (!redis) fail('storage_unavailable', 503, true);
  const available = () => redis.isConnected === true;

  // A nonce may be seen once inside the replay window. SET NX is the whole check: if the key was
  // already there, this exchange is a replay.
  async function rememberNonce(nonce, seconds) {
    if (!available()) fail('storage_unavailable', 503, true);
    let stored;
    try { stored = await redis.setIfAbsent(`${NONCE_KEY}${sha256(nonce)}`, { at: now() }, seconds); }
    catch { fail('storage_unavailable', 503, true); }
    if (!stored) fail('replay_detected', 409);
  }

  async function issue(payload, ttlSeconds) {
    if (!available()) fail('storage_unavailable', 503, true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ticket = randomBytes(32).toString('base64url');
      let stored;
      try { stored = await redis.setIfAbsent(`${KEY}${sha256(ticket)}`, { version: 1, ...payload }, ttlSeconds); }
      catch { fail('storage_unavailable', 503, true); }
      if (stored) return { ticket, expires_at: now() + ttlSeconds * 1000 };
    }
    fail('internal_error', 500);
  }

  // Atomic: the first caller gets the payload, everyone after it gets nothing.
  async function consume(ticket) {
    if (typeof ticket !== 'string' || !TICKET.test(ticket)) fail('handoff_invalid', 401);
    if (!available()) fail('storage_unavailable', 503, true);
    let payload;
    try { payload = await redis.getDel(`${KEY}${sha256(ticket)}`); }
    catch { fail('storage_unavailable', 503, true); }
    if (!payload || payload.version !== 1) fail('handoff_invalid', 401);
    return payload;
  }

  // Contract §3.7: the exchange endpoint is limited per student, not per source IP — a busy school
  // behind one NAT address must not throttle itself, and one looping uuid must not run away.
  async function hitSubject(uuid, limitPerMinute) {
    if (!available()) fail('storage_unavailable', 503, true);
    const key = `${RATE_KEY}${sha256(uuid)}`;
    let count;
    try {
      if (typeof redis.incrWithExpiry === 'function') count = await redis.incrWithExpiry(key, 60);
      else {
        const client = redis.getClient();
        const replies = await client.multi().incr(key).expire(key, 60).exec();
        count = Number(Array.isArray(replies) ? replies[0] : replies);
      }
    } catch { fail('storage_unavailable', 503, true); }
    if (!Number.isFinite(count) || count > limitPerMinute) fail('rate_limited', 429, true);
    return count;
  }

  return { rememberNonce, issue, consume, hitSubject, available };
}

// Constant-time signature comparison that never reports which half differed.
function signatureMatches(expectedHex, givenHex) {
  if (typeof givenHex !== 'string' || givenHex.length !== expectedHex.length) return false;
  try { return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(givenHex, 'hex')); }
  catch { return false; }
}
module.exports = { createHandoffStore, signatureMatches, sha256, TICKET };
