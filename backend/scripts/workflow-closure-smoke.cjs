// Local HTTP regression: notification ownership/read state, Agent execution/history,
// and external module health. Uses temporary records and no AI provider calls.
// Run from backend: node scripts/workflow-closure-smoke.cjs
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config();
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const config = require('../src/config');
const db = require('../src/database/connection');
const User = require('../src/models/User');
const Module = require('../src/models/Module');
const Notifications = require('../src/services/forum/ForumNotificationService');
const localHosts = ['127.0.0.1', 'localhost', '::1'];
const users = []; let moduleId; let server; let upstream; let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`PASS ${label}`); };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function main() {
  assert.ok(localHosts.includes(config.database.host), 'Smoke test requires a local database');
  assert.notEqual(process.env.NODE_ENV, 'production');
  await db.initialize();
  server = http.createServer(require('../src/app'));
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, route, token, body) => {
    const res = await fetch(base + '/api' + route, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const stamp = crypto.randomBytes(5).toString('hex');
  const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
  for (const role of ['user', 'super_admin']) {
    users.push(await User.create({ username: `closure_${stamp}_${role}`, email: `closure_${stamp}_${role}@example.invalid`,
      password, role, group_id: null, credits_quota: 1000 }));
  }
  const tokens = [];
  for (const user of users) {
    const res = await api('POST', '/auth/login', null, { account: user.username, password });
    assert.equal(res.status, 200, 'Temporary user login'); tokens.push(res.data.accessToken);
  }
  const [owner, admin] = tokens;
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push(await Notifications.create({ user_id: users[0].id, sender_id: users[1].id,
    type: i % 2 ? 'reply' : 'system', content: `Smoke ${i}` }));
  check(ids.every(Boolean), 'Create notification fixtures');
  let r = await api('GET', '/forum/notifications?page=2', owner);
  check(r.data.items.length === 1 && r.data.pagination.total === 21 && r.data.unreadCount === 21, 'Notification pagination and unread count');
  r = await api('PUT', `/forum/notifications/${ids[0]}/read`, admin);
  const unread = async () => (await api('GET', '/forum/notifications/unread-count', owner)).data.unread_count;
  check(await unread() === 21, 'Another user cannot mark owner notification');
  check((await api('PUT', '/forum/notifications/invalid/read', owner)).status === 400, 'Reject invalid notification ID');
  check((await api('PUT', `/forum/notifications/${ids[0]}/read`)).status === 401, 'Read action requires login');
  await api('PUT', `/forum/notifications/${ids[0]}/read`, owner);
  await api('PUT', `/forum/notifications/${ids[0]}/read`, owner);
  check(await unread() === 20, 'Mark one read is persistent and idempotent');
  r = await api('GET', '/forum/notifications?type=reply', owner);
  check(r.data.items.length === 10 && r.data.items.every(n => n.type === 'reply'), 'Filter notification type');
  await api('PUT', '/forum/notifications/read-all', owner);
  check(await unread() === 0, 'Mark all read persists');
  r = await api('POST', '/agent/workflows', owner, { name: `Smoke ${stamp}`, flow_data: {
    nodes: [{ id: 'start', type: 'start', data: {} }, { id: 'end', type: 'end', data: {} }],
    edges: [{ id: 'edge', source: 'start', target: 'end' }] } });
  check(r.status === 201, 'Create local start/end workflow');
  const workflowId = r.data.id;
  r = await api('POST', `/agent/workflows/${workflowId}/execute`, owner, { input_data: { query: 'hello' } });
  check(r.success && r.data.executionId && JSON.stringify(r.data.output).includes('hello'), 'Execute and return result');
  const executionId = r.data.executionId;
  r = await api('GET', `/agent/executions?workflow_id=${workflowId}&status=success`, owner);
  check(r.data.pagination.total === 1 && r.data.data[0].started_at, 'History filters and started_at contract');
  r = await api('GET', `/agent/executions/${executionId}`, owner);
  check(r.data.input_data.query === 'hello' && r.data.status === 'success', 'Execution detail persists input and result');
  check((await api('GET', `/agent/executions/${executionId}`, admin)).status === 403, 'Execution detail ownership');
  let upstreamStatus = 503; let sawCredential = false;
  upstream = http.createServer((req, res) => { sawCredential ||= Boolean(req.headers.authorization || req.headers.cookie); res.writeHead(upstreamStatus); res.end(); });
  await listen(upstream);
  moduleId = await Module.create({ name: `closure_${stamp}`, display_name: 'Smoke health', description: 'Temporary smoke fixture',
    module_url: `http://127.0.0.1:${upstream.address().port}`, is_active: 0 });
  r = await api('POST', `/admin/modules/${moduleId}/check-health`, admin);
  check(r.data.status === 'offline' && r.data.http_status === 503, 'HTTP 503 is not reported as online');
  upstreamStatus = 401;
  r = await api('POST', `/admin/modules/${moduleId}/check-health`, admin);
  check(r.data.status === 'degraded' && r.data.reason === 'auth_required', 'Protected external module requires authentication');
  upstreamStatus = 204;
  r = await api('POST', `/admin/modules/${moduleId}/check-health`, admin);
  check(r.data.status === 'online' && r.data.checked_at && !sawCredential, 'Reachable external module without forwarding credentials');
  check((await api('POST', `/admin/modules/${moduleId}/check-health`, owner)).status === 403, 'Health checks require super admin');
  check((await api('DELETE', `/agent/executions/${executionId}`, admin)).status === 404, 'Another user cannot delete execution');
  check((await api('DELETE', `/agent/executions/${executionId}`, owner)).success, 'Owner can delete execution');
  check((await api('GET', `/agent/executions/${executionId}`, owner)).status === 404, 'Deleted execution no longer accessible');
}
async function cleanup() {
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (moduleId) await db.query('DELETE FROM system_modules WHERE id = ?', [moduleId]);
  for (const user of users) {
    await db.query('DELETE FROM agent_workflows WHERE user_id = ?', [user.id]);
    await db.query('DELETE FROM forum_notifications WHERE user_id = ? OR sender_id = ?', [user.id, user.id]);
    await db.query("DELETE FROM users WHERE id = ? AND username LIKE 'closure_%'", [user.id]);
  }
  await db.close();
}
main().then(async () => { await cleanup(); console.log(`${checks} HTTP checks passed; temporary records removed`); process.exit(0); })
  .catch(async error => { console.error(error.message); try { await cleanup(); } catch (e) { console.error('Cleanup failed:', e.message); } process.exit(1); });
