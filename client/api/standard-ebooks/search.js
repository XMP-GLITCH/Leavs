export const config = { maxDuration: 20 }

// Fetch Standard Ebooks OPDS catalog and filter by query.
// SE has ~800 books so the full catalog (~400 KB) is fast to fetch and search.
export default async function handler(req, res) {
  const q = (req.query.q || '').toLowerCase().trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let xml
  try {
    const feed = await fetch('https://standardebooks.org/opds/all', {
      headers: {
        'User-Agent': 'Leavs/1.0 (reading app; contact arreyewube273@gmail.com)',
        'Accept': 'application/atom+xml, application/xml, */*',
      },
    })
    if (!feed.ok) return res.status(502).json({ error: `Standard Ebooks returned ${feed.status}` })
    xml = await feed.text()
  } catch (err) {
    return res.status(502).json({ error: `Could not reach Standard Ebooks: ${err.message}` })
  }

  function attr(str, name) {
    const m = str.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
    return m?.[1] || null
  }
  function tag(str, name) {
    const m = str.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
    return m?.[1]?.trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
      || null
  }

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1])

  const words = q.split(/\s+/).filter(Boolean)

  const books = entries
    .map(entry => {
      const title  = tag(entry, 'title')
      const author = tag(entry, 'name')
      if (!title) return null

      let epubUrl  = null
      let coverUrl = null

      for (const [, attrs] of entry.matchAll(/<link([^>]*)\/?>|<link([^>]*)>/g)) {
        const a    = attrs || ''
        const type = attr(a, 'type') || ''
        const rel  = attr(a, 'rel')  || ''
        const href = attr(a, 'href') || ''
        if (!href) continue
        if (type.includes('epub')) epubUrl  = href
        if (rel.includes('opds-spec.org/image') && !rel.includes('thumbnail')) coverUrl = href
      }

      if (!epubUrl) return null
      const summary = tag(entry, 'summary') || tag(entry, 'content') || null
      return { title, author: author || 'Unknown', epubUrl, coverUrl, description: summary }
    })
    .filter(b => {
      if (!b) return false
      const text = `${b.title} ${b.author}`.toLowerCase()
      return words.every(w => text.includes(w))
    })
    .slice(0, 20)

  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.status(200).json({ books })
}
