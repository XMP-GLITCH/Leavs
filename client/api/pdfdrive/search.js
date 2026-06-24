export const config = { maxDuration: 20 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function isCloudflareChallenge(html) {
  return html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('_cf_chl_')
}

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim() }

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    const r = await fetch(
      `https://www.pdfdrive.com/search?q=${encodeURIComponent(q)}&pageSize=20`,
      {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.pdfdrive.com/',
        },
      }
    )
    if (!r.ok) return res.status(502).json({ error: `PDF Drive: HTTP ${r.status}` })
    html = await r.text()
    if (isCloudflareChallenge(html)) {
      return res.status(502).json({ error: 'PDF Drive is Cloudflare-blocked — try another source' })
    }
  } catch (err) {
    return res.status(502).json({ error: `PDF Drive: ${err.message}` })
  }

  const books = []

  // Each book card is an <li> containing an <a href="/book-name-d12345.html">
  // Try both the li-based layout and the div-based layout
  const cardPattern = /<(?:li|div)[^>]*class="[^"]*(?:file-[^"]*|book[^"]*|result[^"]*)"[^>]*>([\s\S]*?)(?=<\/(?:li|div)>)/gi
  const hrefPattern = /href="(\/[^"]+\.html)"/
  const imgPattern  = /<img[^>]+src="([^"]+)"/
  const titlePattern = /<h2[^>]*>([\s\S]*?)<\/h2>|title="([^"]+)"|alt="([^"]+)"/i
  const pagePattern  = /(\d+)\s*(?:Pages?|Pg)/i
  const sizePattern  = /(\d+(?:\.\d+)?\s*(?:MB|KB))/i

  // Fallback: extract all book-like anchor tags with .html hrefs
  const anchors = [...html.matchAll(/<a\s[^>]*href="(\/[^"?#]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi)]

  for (const [, href, inner] of anchors) {
    if (books.length >= 20) break
    if (!href || href.split('/').length < 2) continue

    const imgM   = inner.match(imgPattern)
    const cover  = imgM?.[1]?.startsWith('http') ? imgM[1]
                 : imgM?.[1] ? `https://www.pdfdrive.com${imgM[1]}` : null

    const titleM = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
                || inner.match(/title="([^"]+)"/)
                || inner.match(/alt="([^"]+)"/)
    if (!titleM) continue
    const title = stripTags(titleM[1] || titleM[2] || '')
    if (!title || title.length < 3) continue

    // Skip nav/UI links (short slugs, home, search, etc.)
    if (['/', '/search', '/category'].some(p => href === p)) continue

    const pageUrl = `https://www.pdfdrive.com${href}`
    const pagesM  = inner.match(pagePattern)
    const sizeM   = inner.match(sizePattern)
    const stat    = [pagesM?.[1] && `${pagesM[1]} pages`, sizeM?.[1]].filter(Boolean).join(' · ') || 'PDF Drive'

    books.push({
      id:      `pdf-${books.length}-${href.slice(1, 20).replace(/\W/g,'-')}`,
      title,
      author:  'Unknown',
      cover,
      pageUrl,
      stat,
    })
  }

  res.status(200).json({ books })
}
