const http = require('http');
const { checkModuleHealth } = require('../../../services/moduleHealthService');
let server;
let origin;
beforeEach(async () => {
  server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
const check = (path = '/', options) => checkModuleHealth({ module_category: 'external', module_url: origin + path }, options);
it.each([[204, 'online', 'reachable'], [401, 'degraded', 'auth_required'], [403, 'degraded', 'auth_required'], [404, 'offline', 'http_error'], [503, 'offline', 'http_error']])('classifies HTTP %s', async (code, status, reason) => {
  server.on('request', (req, res) => { expect(req.headers.authorization).toBeUndefined(); res.writeHead(code); res.end(); });
  await expect(check()).resolves.toMatchObject({ status, reason, http_status: code });
});
it('falls back to GET for servers without HEAD and does not read an unbounded body', async () => {
  const methods = [];
  server.on('request', (req, res) => {
    methods.push(req.method);
    if (req.method === 'HEAD') { res.writeHead(405); res.end(); }
    else { res.writeHead(200); res.write('streaming body'); }
  });
  await expect(check()).resolves.toMatchObject({ status: 'online', http_status: 200 });
  expect(methods).toEqual(['HEAD', 'GET']);
});
it('does not follow redirects', async () => {
  const paths = [];
  server.on('request', (req, res) => { paths.push(req.url); res.writeHead(302, { Location: '/private' }); res.end(); });
  await expect(check()).resolves.toMatchObject({ status: 'online', http_status: 302 });
  expect(paths).toEqual(['/']);
});
it('bounds a server that never responds', async () => {
  server.on('request', () => {});
  await expect(check('/', { timeoutMs: 30 })).resolves.toMatchObject({ status: 'offline', reason: 'timeout' });
});
it('reports connection failures', async () => {
  server.on('request', req => req.socket.destroy());
  await expect(check()).resolves.toMatchObject({ status: 'offline', reason: 'connection_error' });
});
it.each(['file:///etc/passwd', 'http://user:secret@127.0.0.1', 'invalid'])('rejects invalid targets: %s', async module_url => {
  await expect(checkModuleHealth({ module_url })).resolves.toEqual({ status: 'unknown', reason: 'invalid_url' });
});
