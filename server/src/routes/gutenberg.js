import { Router } from 'express'

const router = Router()

const ALLOWED_HOSTS = ['www.gutenberg.org', 'gutenberg.org']

router.get('/proxy', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch {
    return res.status(400).json({ error: 'invalid url' })
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'URL host not allowed' })
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Leavs-App/1.0' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` })
    }
    const contentType = upstream.headers.get('Content-Type') || 'application/epub+zip'
    res.setHeader('Content-Type', contentType)
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.send(buffer)
  } catch (err) {
    console.error('[Gutenberg proxy]', err.message)
    res.status(500).json({ error: 'Proxy fetch failed', detail: err.message })
  }
})

export default router
