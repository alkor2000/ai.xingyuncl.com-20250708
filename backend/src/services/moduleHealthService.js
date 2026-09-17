const http = require('http');
const https = require('https');

// Probe the administrator-configured address without forwarding platform credentials
// or following redirects. A response checks reachability, not authenticated features.
async function checkModuleHealth(module, { timeoutMs = 5000 } = {}) {
  if (module.module_category === 'system') return { status: 'online', reason: 'builtin' };
  let url;
  try {
    url = new URL(module.module_url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { return { status: 'unknown', reason: 'invalid_url' }; }

  const started = Date.now();
  return new Promise(resolve => {
    let request;
    let timer;
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request?.destroy();
      resolve({ ...result, duration_ms: Date.now() - started });
    };
    const probe = method => {
      try {
        const currentRequest = (url.protocol === 'https:' ? https : http).request(url, {
          method, headers: { 'User-Agent': 'AI-Platform-HealthCheck/1.0', Accept: '*/*' }
        }, response => {
          if (finished) { response.destroy(); return; }
          const status = response.statusCode;
          response.destroy();
          if (method === 'HEAD' && [405, 501].includes(status)) { probe('GET'); return; }
          finish({ status: status >= 200 && status < 400 ? 'online' : [401, 403].includes(status) ? 'degraded' : 'offline',
            reason: status >= 200 && status < 400 ? 'reachable' : [401, 403].includes(status) ? 'auth_required' : 'http_error',
            http_status: status });
        });
        request = currentRequest;
        currentRequest.on('error', () => {
          if (request === currentRequest) finish({ status: 'offline', reason: 'connection_error' });
        });
        currentRequest.end();
      } catch { finish({ status: 'offline', reason: 'connection_error' }); }
    };
    timer = setTimeout(() => finish({ status: 'offline', reason: 'timeout' }), timeoutMs);
    probe('HEAD');
  });
}

module.exports = { checkModuleHealth };
