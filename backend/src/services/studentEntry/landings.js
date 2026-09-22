'use strict';

// The landing whitelist the C05 contract points at: the portal capability keys plus `dashboard`.
//
// The keys themselves live in the frontend adapter (frontend/src/utils/portalCapabilityEntry.js) and
// the backend cannot import that module, so they are mirrored here and a unit test compares the two
// lists — a capability added on one side and not the other fails that test rather than silently
// widening or narrowing what edu may ask for.
const CAPABILITY_KEYS = Object.freeze([
  'ai-practice.chat', 'ai-practice.image', 'ai-practice.video', 'ai-practice.agent',
  'ai-practice.knowledge', 'ai-practice.html', 'ai-practice.mindmap', 'ai-practice.storage'
]);
const DEFAULT_LANDINGS = Object.freeze(['dashboard', ...CAPABILITY_KEYS]);

// The contract's prose says the whitelist is the capability keys, while its example body carries the
// short form `"entry": "chat"`. Rather than pick one reading silently, the provider accepts both and
// normalises the short form to the full key; the difference is written down for edu.
function normaliseEntry(entry, allowed) {
  if (typeof entry !== 'string' || !entry) return null;
  if (allowed.includes(entry)) return entry;
  const qualified = `ai-practice.${entry}`;
  return allowed.includes(qualified) ? qualified : null;
}
module.exports = { CAPABILITY_KEYS, DEFAULT_LANDINGS, normaliseEntry };
