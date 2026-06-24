export const config = { maxDuration: 30 }

const ALLOWED_HOSTS = [
  'www.gutenberg.org',
  'gutenberg.org',
  'gutenberg.pglaf.org',
  'aleph.gutenberg.org',
]

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url param required' })

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ error: 'invalid url' })
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'host not allowed' })
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Leavs/1.0 (reading app; contact arreyewube273@gmail.com)',
        'Accept': 'application/epub+zip, application/octet-stream, */*',
      },
    })

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` })
    }

    const contentType = upstream.headers.get('content-type') || 'application/epub+zip'
    const buffer = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', buffer.length)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.status(200).send(buffer)
  } catch (err) {
    console.error('[gutenberg proxy]', err)
    res.status(500).json({ error: err.message })
  }
}
