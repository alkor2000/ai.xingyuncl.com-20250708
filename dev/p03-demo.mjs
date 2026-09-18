// Synthetic, loopback-only demonstration. Does NOT authenticate real teachers or touch a database.
// Run: node dev/p03-demo.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = createRequire(path.join(root, 'backend/package.json'))
const frontend = createRequire(path.join(root, 'frontend/package.json'))
const express = backend('express')
const { fixture } = backend('./src/__tests__/helpers/p03Fixture')
const { createRouter } = backend('./src/routes/artifactHandoffDev')
const { createRouter: createExportRouter } = backend('./src/routes/artifactExports')
const { ArtifactExportService } = backend('./src/services/artifactExportService')
const { createServer } = await import(path.join(path.dirname(frontend.resolve('vite/package.json')), 'dist/node/index.js'))
const demoDirectory = path.join(root, 'storage/private/p03-demo')
if (process.argv.includes('--fresh')) {
  // Only the fixed synthetic demo state; never touches the authenticated app's p03-dev spool.
  await fs.unlink(path.join(demoDirectory, 'private/state.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
}
const f = await fixture(demoDirectory)
const app = express()
app.use('/api/artifact-exports', createExportRouter({ service: new ArtifactExportService(f.source), authenticate: (req, res, next) => {
  req.user = { id: 101 }; next() // Same synthetic fixture; this process only listens on loopback.
} }))
const env = { NODE_ENV: 'development', P03_DEV_ENABLED: 'true', P03_DEV_USER_IDS: '101' }
app.use('/api/dev/p03', createRouter({ service: f.service, env, authenticate: (req, res, next) => {
  req.user = { id: 101 }; next() // Fixed SYNTHETIC tester, only in this loopback demo process.
} }))
const api = await new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server))
})
const vite = await createServer({
  root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.js'),
  define: { 'import.meta.env.VITE_P03_DEV_ENABLED': JSON.stringify(process.argv.includes('--export-only') ? 'false' : 'true') },
  server: { host: '127.0.0.1', port: Number(process.env.P03_DEMO_PORT || 3004), strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}` } } }
})
await vite.listen()
console.log(`P03 synthetic demo: http://localhost:${vite.config.server.port}/dev/p03.html (synthetic data; no real receiver)`)
async function stop() { await vite.close(); api.closeAllConnections(); api.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
