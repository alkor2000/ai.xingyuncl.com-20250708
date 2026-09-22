'use strict';

// Default-off assembly for the C05 student entry. Unset costs nothing: no Redis use, no credential
// read, no route behaviour beyond a fixed refusal. "On" means the deployment has BOTH switched the
// env flag on AND filled in the `c05` block of the platform it already configured for edu — anything
// missing or inconsistent is a named refusal, never an assumed default.
const { C05Error, fail } = require('./errors');
const { studentEntrySettings } = require('./config');
const { createHandoffStore } = require('./handoff');
const { createStudentEntry } = require('./exchange');

const SWITCH = 'C05_STUDENT_ENTRY_ENABLED';

function resolveSwitch(env = process.env) {
  const value = env[SWITCH];
  if (value === undefined || value === '' || value === 'false') return 'disabled';
  if (value === 'true') return 'enabled';
  fail('config_invalid', 503);
}

// Built per request rather than at boot: the platform block lives in system_settings, so an operator
// changing it does not need a restart, and a broken change refuses instead of serving stale rules.
async function loadRuntime({ env = process.env, deps = {} } = {}) {
  if (resolveSwitch(env) === 'disabled') return { enabled: false, reason: 'student_entry_disabled' };
  const SystemConfig = deps.SystemConfig || require('../../models/SystemConfig');
  const redis = deps.redis || require('../../database/redis');
  const db = deps.db || require('../../database/connection');
  const models = deps.models || { User: require('../../models/User') };
  const logger = deps.logger || (() => { try { return require('../../utils/logger'); } catch { return null; } })();

  let ssoConfig = null;
  try { ssoConfig = await SystemConfig.getSetting('sso_config'); }
  catch { fail('storage_unavailable', 503, true); }
  const settings = studentEntrySettings(ssoConfig, { platformKey: env.C05_PLATFORM_KEY || 'edu' });
  if (!settings.enabled) return { enabled: false, reason: settings.reason };
  // The atomic one-time handoff is the whole point of the flow; without Redis there is no entry.
  if (!redis || redis.isConnected !== true) fail('storage_unavailable', 503, true);

  const store = createHandoffStore({ redis, now: deps.now });
  const service = createStudentEntry({ settings, store, db, models, now: deps.now, logger });
  return {
    enabled: true, settings, service, store,
    readiness: Object.freeze({
      platform_key: settings.platformKey,
      schools_mapped: Object.keys(settings.schools).length,
      landings: settings.landings,
      launch_url_configured: Boolean(settings.launchUrl),
      issuance_policy: settings.issuance ? settings.issuance.mode : 'absent',
      group_change: settings.groupChange,
      ip_whitelist: settings.ipWhitelistEnabled,
      trusted_proxy_hops: settings.trustedProxyHops,
      issues_refresh_token: settings.issueRefresh,
      handoff_ttl_seconds: settings.handoffTtlSeconds
    })
  };
}
module.exports = { loadRuntime, resolveSwitch, SWITCH, C05Error };
