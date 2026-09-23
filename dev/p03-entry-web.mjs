// Vite development server for the isolated P03 entry acceptance: the real frontend (frontend/vite.config.js) with
// /api and /uploads proxied to the isolated practice server named on stdin. Loopback only; exits when stdin closes.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontend = createRequire(path.join(root, 'frontend/package.json'))
const { createServer } = await import(path.join(path.dirname(frontend.resolve('vite/package.json')), 'dist/node/index.js'))
let raw = ''
for await (const chunk of process.stdin) { raw += chunk; if (raw.includes('\n')) break }
const spec = JSON.parse(raw.slice(0, raw.indexOf('\n')))
if (!Number.isInteger(spec.port) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(spec.api)) { process.stderr.write('web_config\n'); process.exit(1) }
const proxy = { target: spec.api, changeOrigin: true, secure: false }
const vite = await createServer({
  root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'), logLevel: 'error',
  server: { host: '127.0.0.1', port: spec.port, strictPort: true, open: false, proxy: { '/api': proxy, '/uploads': proxy } }
})
await vite.listen()
process.stdout.write(JSON.stringify({ ready: true, url: `http://127.0.0.1:${vite.config.server.port}` }) + '\n')
async function stop() { await vite.close().catch(() => {}); process.exit(0) }
process.stdin.on('end', stop); process.stdin.on('close', stop)
process.on('SIGTERM', stop); process.on('SIGINT', stop)
