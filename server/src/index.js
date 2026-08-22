// Local dev API server.
//
// Mounts the SAME serverless handler files Vercel deploys (client/api/**/*.js)
// at their file-based routes, so localhost and production always expose
// identical endpoints. The handlers use only Express-compatible req/res APIs
// (req.query, req.body, res.status().json(), res.setHeader, stream.pipe).

import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import { readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

config()

// Some handler dependencies (e.g. edge-tts WebSockets) can emit errors outside
// any promise chain — without these, one bad event kills the whole server and
// every in-flight request dies with ECONNRESET.
process.on('uncaughtException',  err => console.error('[uncaught]', err))
process.on('unhandledRejection', err => console.error('[unhandled]', err))

const app  = express()
const PORT = process.env.PORT || 3001
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '10mb' }))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_DIR   = path.resolve(__dirname, '../../client/api')

function collectHandlers(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue  // _lib helpers, not routes
    // Tests are not routes. Importing one here executes describe() outside a
    // test runner and takes the whole dev server down with it — and on Vercel
    // any .js under api/ is deployed as a PUBLIC endpoint. Keep tests out of
    // this directory; this is the backstop.
    if (/\.(test|spec)\.js$/.test(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectHandlers(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

for (const file of collectHandlers(API_DIR)) {
  const route = '/api/' + path.relative(API_DIR, file).replace(/\\/g, '/').replace(/\.js$/, '')
  const mod   = await import(pathToFileURL(file).href)
  if (typeof mod.default !== 'function') continue
  app.all(route, (req, res) => {
    Promise.resolve(mod.default(req, res)).catch(err => {
      console.error(`[${route}]`, err)
      if (!res.headersSent) res.status(500).json({ error: err.message })
    })
  })
  console.log(`mounted ${route}`)
}

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', service: 'leavs-server', ts: Date.now() }),
)

app.listen(PORT, () =>
  console.log(`Leavs server listening on http://localhost:${PORT}`),
)
