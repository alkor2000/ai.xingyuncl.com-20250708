/** Unverified SSO presentation text. Never use this value to match or authorize an account. */
function normalizeSSODisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) return null;
  return Array.from(name).slice(0, 100).join('');
}
module.exports = { normalizeSSODisplayName };
