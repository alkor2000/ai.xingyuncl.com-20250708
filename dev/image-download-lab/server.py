#!/usr/bin/env python3
"""两个本机回环源，只服务本实验需要的文件：
  A（页面源）: 实验页 + 同源图片端点（200 png / 200 jpeg 类型 / 404 / 403 / 200 但返回 HTML，模拟 SPA 兜底）
  B（跨源）  : 跨源图片端点（带 CORS 头 / 不带 CORS 头 / 403 / 404），用不同端口即不同 origin
用法: server.py --role a --port 4411 --helpers <目录>   |   server.py --role b --port 4412
不监听回环以外地址；不代理任何外部 URL。"""
import argparse, http.server, json, os, ssl, sys, time, zlib, struct

def png_bytes(w=16, h=16, rgb=(30, 144, 255)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

PNG = png_bytes()
PAGE = """<!doctype html><meta charset="utf-8"><title>image download lab</title>
<body><h1 id="title">image download lab</h1><div id="out"></div>
<script>window.__messages = []; window.__results = [];</script>
<script src="/helper-%(helper)s.js"></script>
<script>
  // 每个场景一个真实按钮：Playwright 真点击，保留用户激活，再调用被测 downloadImage。
  const scenarios = %(scenarios)s;
  for (const s of scenarios) {
    const b = document.createElement('button'); b.id = 'btn-' + s.id; b.textContent = s.id;
    b.onclick = async (e) => {
      e.stopPropagation();
      const started = performance.now();
      try {
        const r = await ImageHelpers.downloadImage(s.url, s.filename, s.options || {});
        window.__results.push({ id: s.id, returned: r === undefined ? 'undefined' : r, ms: Math.round(performance.now() - started) });
      } catch (err) { window.__results.push({ id: s.id, threw: String(err && err.message || err) }); }
    };
    document.body.appendChild(b);
  }
  // 卡片级冒泡探针：body 上的点击计数，按钮 stopPropagation 后不应增加
  window.__bodyClicks = 0; document.body.addEventListener('click', () => { window.__bodyClicks++; });
</script></body>"""

class Handler(http.server.BaseHTTPRequestHandler):
    role = 'a'; helpers = '.'; cross = ''
    def log_message(self, *a): pass
    def _send(self, status, body=b'', ctype='application/octet-stream', extra=()):
        self.send_response(status); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in extra: self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        self._send(204, b'', 'text/plain', [('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Methods', 'GET'), ('Access-Control-Allow-Headers', '*')])
    def do_GET(self):
        p = self.path.split('?')[0]
        cors = [('Access-Control-Allow-Origin', '*')]
        if self.role == 'a':
            if p == '/' or p.startswith('/index'):
                helper = 'old'
                if 'helper=new' in self.path: helper = 'new'
                scen = json.dumps(self.server.scenarios)
                return self._send(200, (PAGE % {'helper': helper, 'scenarios': scen}).encode(), 'text/html; charset=utf-8')
            if p.startswith('/helper-'):
                f = os.path.join(self.helpers, p[1:])
                if os.path.isfile(f): return self._send(200, open(f, 'rb').read(), 'application/javascript')
                return self._send(404, b'no helper', 'text/plain')
            if p == '/img/ok.png': return self._send(200, PNG, 'image/png')
            if p == '/img/ok-jpeg-type.jpg': return self._send(200, PNG, 'image/jpeg')
            if p == '/img/missing.png': return self._send(404, b'not found', 'text/plain')
            if p == '/img/forbidden.png': return self._send(403, b'forbidden', 'text/plain')
            if p == '/img/html.png': return self._send(200, b'<!doctype html><title>spa</title>fallback', 'text/html')
            if p == '/img/no-type.png':
                # 没有 Content-Type 的 200：正文其实是 HTML（EEB-R2）
                body = b'<html>not an image</html>'
                self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
            if p == '/img/slow-body.png':
                # 响应头立刻到、正文 6 秒后才来（EEB-R1）：被测函数的超时必须把正文也管住
                self.send_response(200); self.send_header('Content-Type', 'image/png'); self.send_header('Content-Length', str(len(PNG))); self.end_headers()
                self.wfile.flush(); time.sleep(6)
                try: self.wfile.write(PNG)
                except Exception: pass
                return
            return self._send(404, b'', 'text/plain')
        # role b: cross-origin image host
        if p == '/img/cors.png': return self._send(200, PNG, 'image/png', cors)
        if p == '/img/nocors.png': return self._send(200, PNG, 'image/png')
        if p == '/img/forbidden-cors.png': return self._send(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml', cors)
        if p == '/img/forbidden-nocors.png': return self._send(403, b'<Error><Code>AccessDenied</Code></Error>', 'application/xml')
        if p == '/img/missing-cors.png': return self._send(404, b'<Error><Code>NoSuchKey</Code></Error>', 'application/xml', cors)
        return self._send(404, b'', 'text/plain')

def scenarios(base_a, base_b, mixed_http=''):
    extra = []
    if mixed_http:
        # 页面是 https、图片地址是 http（同一主机或别的主机）：浏览器把它当不安全下载/混合内容
        extra = [
            {'id': 'mixed-http-same-host', 'url': mixed_http + '/img/ok.png', 'filename': 'ai_21.jpg'},
            {'id': 'mixed-http-cross', 'url': mixed_http.replace('4411', '4412') + '/img/nocors.png', 'filename': 'ai_22.jpg'},
        ]
    return extra + [
        {'id': 'same-ok', 'url': base_a + '/img/ok.png', 'filename': 'ai_1.jpg'},
        {'id': 'same-jpeg-type', 'url': base_a + '/img/ok-jpeg-type.jpg', 'filename': 'ai_2.jpg'},
        {'id': 'same-relative', 'url': '/img/ok.png', 'filename': 'ai_3.jpg'},
        {'id': 'same-404', 'url': base_a + '/img/missing.png', 'filename': 'ai_4.jpg'},
        {'id': 'same-403', 'url': base_a + '/img/forbidden.png', 'filename': 'ai_5.jpg'},
        {'id': 'same-html-fallback', 'url': base_a + '/img/html.png', 'filename': 'ai_6.jpg'},
        {'id': 'cross-cors', 'url': base_b + '/img/cors.png', 'filename': 'ai_7.jpg'},
        {'id': 'cross-nocors', 'url': base_b + '/img/nocors.png', 'filename': 'ai_8.jpg'},
        {'id': 'cross-403-cors', 'url': base_b + '/img/forbidden-cors.png', 'filename': 'ai_9.jpg'},
        {'id': 'cross-403-nocors', 'url': base_b + '/img/forbidden-nocors.png', 'filename': 'ai_10.jpg'},
        {'id': 'cross-404-cors', 'url': base_b + '/img/missing-cors.png', 'filename': 'ai_11.jpg'},
        {'id': 'same-no-content-type', 'url': base_a + '/img/no-type.png', 'filename': 'ai_14.jpg'},
        {'id': 'same-slow-body', 'url': base_a + '/img/slow-body.png', 'filename': 'ai_15.jpg', 'options': {'timeoutMs': 1500}},
        {'id': 'missing-url', 'url': '', 'filename': 'ai_12.jpg'},
        {'id': 'null-url', 'url': None, 'filename': 'ai_13.jpg'},
    ]

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--role', required=True); ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--helpers', default='.'); ap.add_argument('--cross', default='http://127.0.0.1:4412'); ap.add_argument('--self', dest='self_base', default='')
    ap.add_argument('--tls', nargs=2, metavar=('CERT', 'KEY'), help='以 https 服务（自签证书，仅回环）'); ap.add_argument('--mixed-http', default='', help='https 页面要尝试的 http 图片源，如 http://127.0.0.1:4411')
    a = ap.parse_args()
    Handler.role = a.role; Handler.helpers = a.helpers
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    scheme = 'http'
    if a.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(a.tls[0], a.tls[1]); srv.socket = ctx.wrap_socket(srv.socket, server_side=True); scheme = 'https'
    srv.scenarios = scenarios(a.self_base or f'{scheme}://127.0.0.1:{a.port}', a.cross, a.mixed_http)
    print(f'lab origin {a.role} on {scheme}://127.0.0.1:{a.port}', flush=True)
    srv.serve_forever()
