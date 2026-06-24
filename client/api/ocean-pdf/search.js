export const config = { maxDuration: 20 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    const r = await fetch(`https://oceanofpdf.com/?s=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://oceanofpdf.com/',
      },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
    if (html.includes('Just a moment') || html.includes('cf-challenge')) {
      throw new Error('OceanPDF is Cloudflare-blocked — try another source')
    }
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  const books = []
  // WordPress sites wrap posts in <article> or <div class="post">
  const blocks = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1])

  for (const block of blocks) {
    if (books.length >= 20) break

    // Title + page URL
    const linkM = block.match(/<h[1-4][^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
                || block.match(/<a\s+href="([^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    if (!linkM) continue

    const pageUrl = linkM[1]
    const title   = linkM[2].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').trim()
    if (!title || !pageUrl.includes('oceanofpdf.com')) continue

    // Cover image
    const imgM  = block.match(/<img[^>]+src="([^"]+\.(jpe?g|png|webp)[^"]*)"/)
    const cover = imgM?.[1] || null

    // Author (look for "by Author" or meta lines)
    const authM = block.match(/(?:by|author)[:\s]+<[^>]+>(.*?)<\/|(?:by|author)[:\s]+([A-Z][^\n<]{2,40})/i)
    const author = (authM?.[1] || authM?.[2] || '').replace(/<[^>]+>/g,'').trim() || 'Unknown'

    books.push({ id: `opdf-${books.length}`, title, author, cover, pageUrl })
  }

  res.setHeader('Cache-Control', 'public, max-age=600')
  res.status(200).json({ books })
}
