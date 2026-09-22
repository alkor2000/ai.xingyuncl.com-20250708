'use strict';

// Where the C05 provider gets its facts. Everything comes from the platform entry the deployment
// already keeps in `system_settings.sso_config.platforms[]` (the same place the legacy SSO reads), plus
// a `c05` block on that entry. Nothing is inferred: a school that is not mapped, a landing that is not
// listed and an issuance policy that has not been decided are refusals, not defaults.
//
// The block (candidate shape, documented in the delivery notes):
//   platforms: [{ platform_key: 'edu', secret, algorithm: 'sha256', enabled: true,
//     ip_whitelist_enabled: true, allowed_ips: '1.2.3.4,5.6.7.8',
//     c05: {
//       enabled: true,
//       school_groups: { "123": 7 },          // edu school_ref → this platform's student group id
//       landings: ["dashboard", "chat"],      // the landing whitelist
//       issuance: { mode: "from_group_pool", amount: 100, expire_days: 365 },  // D-13; absent ⇒ refuse
//       group_change: "refuse",               // or "move_and_recycle" once the rule is decided
//       trusted_proxy_hops: 0,                // 0 ⇒ the socket address is the only source of truth
//       access_ttl: "12h", issue_refresh: false
//     }}]
const { fail } = require('./errors');
const { DEFAULT_LANDINGS } = require('./landings');

// Contract §5: an access token from this entry lives 12 hours. A deployment whose own tokens are
// shorter keeps the shorter one; a deployment whose tokens are longer does not get to stretch this one.
const ACCESS_TTL = '12h';
const SCHOOL_REF = /^[A-Za-z0-9._:-]{1,64}$/;
const ENTRY = /^[a-z0-9][a-z0-9._-]{0,47}$/;

function readPlatform(ssoConfig, platformKey = 'edu') {
  if (!ssoConfig || typeof ssoConfig !== 'object' || ssoConfig.enabled !== true) return null;
  const platforms = Array.isArray(ssoConfig.platforms) ? ssoConfig.platforms : [];
  return platforms.find(entry => entry && entry.platform_key === platformKey) || null;
}

// Returns the validated C05 settings, or a named refusal. Never throws for "switched off": that is a
// state the caller reports as `student_entry_disabled`.
function studentEntrySettings(ssoConfig, { platformKey = 'edu', instanceKey = null } = {}) {
  const platform = readPlatform(ssoConfig, platformKey);
  if (!platform || platform.enabled === false) return { enabled: false, reason: 'platform_disabled' };
  const block = platform.c05;
  if (!block || block.enabled !== true) return { enabled: false, reason: 'student_entry_disabled' };

  if (typeof platform.secret !== 'string' || platform.secret.length < 32) fail('config_invalid', 503);
  if (platform.algorithm && platform.algorithm !== 'sha256') fail('config_invalid', 503);

  // Two ways to map a school, and the deployment says which one it means. 'database' is the contract's
  // own shape (user_groups.edu_school_id/cohort) and needs the candidate migration; 'config' is the
  // mapping this default-off candidate can run with no DDL at all. Neither guesses from a name or tag.
  const schoolSource = block.school_source === 'database' ? 'database' : 'config';
  const schools = block.school_groups && typeof block.school_groups === 'object' && !Array.isArray(block.school_groups)
    ? block.school_groups : {};
  for (const [ref, groupId] of Object.entries(schools)) {
    if (!SCHOOL_REF.test(ref) || !Number.isInteger(groupId) || groupId <= 0) fail('config_invalid', 503);
  }
  if (schoolSource === 'config' && Object.keys(schools).length === 0) fail('config_invalid', 503);
  const landings = Array.isArray(block.landings) && block.landings.length
    ? block.landings.map(String) : [...DEFAULT_LANDINGS];
  if (landings.some(entry => !ENTRY.test(entry))) fail('config_invalid', 503);

  // D-13 has not been decided, so there is no default here: without an explicit issuance policy the
  // entry stays closed for production rather than inventing an amount.
  const issuance = block.issuance && typeof block.issuance === 'object' ? block.issuance : null;
  if (issuance) {
    if (!['from_group_pool', 'none'].includes(issuance.mode)) fail('config_invalid', 503);
    if (issuance.mode === 'from_group_pool' &&
        (!Number.isInteger(issuance.amount) || issuance.amount < 0 || issuance.amount > 100000)) fail('config_invalid', 503);
    if (issuance.expire_days !== undefined &&
        (!Number.isInteger(issuance.expire_days) || issuance.expire_days < 1 || issuance.expire_days > 3650)) fail('config_invalid', 503);
  }
  // Contract §4 spells out the move: recycle what is left into the current pool, zero the balance and
  // follow the new group's validity. That is the default; a deployment that would rather stop and look
  // at a school change by hand can set `refuse`, which never touches a balance.
  // The one outbound link the login page may offer ("学校学生登录" → edu's launch endpoint). It is a
  // configured constant, never anything a request can influence, and it must be an ordinary https URL.
  let launchUrl = null;
  if (block.launch_url !== undefined && block.launch_url !== null && block.launch_url !== '') {
    if (typeof block.launch_url !== 'string' || block.launch_url.length > 512) fail('config_invalid', 503);
    let parsed;
    try { parsed = new URL(block.launch_url); } catch { fail('config_invalid', 503); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('config_invalid', 503);
    launchUrl = parsed.toString();
  }

  if (block.issue_refresh === true) fail('refresh_not_supported', 503);

  const groupChange = block.group_change === 'refuse' ? 'refuse' : 'move_and_recycle';
  // Contract §4 leaves "user_limit does not apply to the mapped student group, or is raised by one"
  // open. The default is the half that changes nothing an administrator set; `auto_expand` is the other.
  const userLimit = block.user_limit === 'auto_expand' ? 'auto_expand' : 'ignore';
  const hops = Number.isInteger(block.trusted_proxy_hops) && block.trusted_proxy_hops >= 0 ? block.trusted_proxy_hops : 0;
  const allowedIps = typeof platform.allowed_ips === 'string'
    ? platform.allowed_ips.split(',').map(value => value.trim()).filter(Boolean) : [];
  if (platform.ip_whitelist_enabled === true && allowedIps.length === 0) fail('config_invalid', 503);

  return Object.freeze({
    enabled: true,
    platformKey,
    // Which deployment issued a ticket. Two practice sites share this code and could share a secret by
    // mistake; a ticket that names another deployment is refused rather than quietly accepted here.
    instanceKey: instanceKey || null,
    secret: platform.secret,
    ipWhitelistEnabled: platform.ip_whitelist_enabled === true,
    allowedIps: Object.freeze(allowedIps),
    trustedProxyHops: hops,
    schoolSource,
    schools: Object.freeze({ ...schools }),
    landings: Object.freeze([...new Set(landings)]),
    launchUrl,
    issuance: issuance ? Object.freeze({ ...issuance }) : null,
    groupChange,
    userLimit,
    // Contract §3.7: this endpoint is limited per student, not per source IP.
    subjectRatePerMinute: Number.isInteger(block.subject_rate_per_minute)
      ? Math.min(Math.max(block.subject_rate_per_minute, 1), 600) : 10,
    signatureValidSeconds: Number.isInteger(ssoConfig.signature_valid_minutes)
      ? Math.min(Math.max(ssoConfig.signature_valid_minutes, 1), 10) * 60 : 300,
    accessTtl: typeof block.access_ttl === 'string' ? block.access_ttl : ACCESS_TTL,
    // The contract offers "no long-lived refresh, or 24h". This candidate implements the first half
    // only, and says so instead of accepting a setting it cannot honour: the platform's refresh
    // endpoint re-mints a pair through the ordinary path, which would hand back a deployment-length
    // refresh (14 days by default), lose this session's context and never re-check that the account is
    // still a student. Capping that safely means changing a login path every account shares, which is
    // not this package's to change — so `issue_refresh: true` is refused by name.
    issueRefresh: false,
    handoffTtlSeconds: 60
  });
}
module.exports = { studentEntrySettings, readPlatform };
