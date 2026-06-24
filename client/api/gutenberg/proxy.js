export const config = { maxDuration: 30 }

// Exact hostname allowlist
const ALLOWED_HOSTS = new Set([
  'www.gutenberg.org',
  'gutenberg.org',
  'gutenberg.pglaf.org',
  'aleph.gutenberg.org',
  // Open Library / Internet Archive
  'archive.org',
  'www.archive.org',
  // Standard Ebooks
  'standardebooks.org',
  'www.standardebooks.org',
])

// Also allow any *.archive.org subdomain (IA storage mirrors like ia800.us.archive.org)
function isAllowed(hostname) {
  return ALLOWED_HOSTS.has(hostname) || hostname.endsWith('.archive.org')
}

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

  if (!isAllowed(parsed.hostname)) {
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
