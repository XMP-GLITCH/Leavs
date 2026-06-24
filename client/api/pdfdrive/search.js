export const config = { maxDuration: 20 }

function browserHeaders(referer) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    ...(referer ? { 'Referer': referer } : {}),
  }
}

function isBlocked(status, html) {
  return status === 403 || status === 429
    || html.includes('Just a moment')
    || html.includes('cf-challenge')
    || html.includes('_cf_chl_')
}

function stripTags(s) {
  return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim()
}

const BASE = 'https://www.pdfdrive.com'

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  // Prefetch homepage for cookies
  let cookies = ''
  try {
    const home = await fetch(BASE + '/', { headers: browserHeaders(null) })
    const sc = home.headers.get('set-cookie')
    if (sc) cookies = sc.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
  } catch { /* ignore */ }

  let html
  try {
    const headers = { ...browserHeaders(BASE + '/'), ...(cookies ? { Cookie: cookies } : {}) }
    const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&pageSize=20`, { headers })
    html = await r.text()
    if (isBlocked(r.status, html)) {
      return res.status(502).json({ error: `PDF Drive is blocked (${r.status}) — try another source` })
    }
  } catch (err) {
    return res.status(502).json({ error: `PDF Drive: ${err.message}` })
  }

  const books = []
  // Extract all anchor tags with .html hrefs that look like book pages
  for (const [, href, inner] of html.matchAll(/<a\s[^>]*href="(\/[^"?#]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (books.length >= 20) break

    const imgM  = inner.match(/<img[^>]+src="([^"]+)"/)
    const cover = imgM?.[1]?.startsWith('http') ? imgM[1]
                : imgM?.[1] ? `${BASE}${imgM[1]}` : null

    const titleM = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
                || inner.match(/title="([^"]+)"/)
                || inner.match(/alt="([^"]+)"/)
    if (!titleM) continue
    const title = stripTags(titleM[1] || titleM[2] || '')
    if (!title || title.length < 3) continue

    const pageUrl = `${BASE}${href}`
    const pagesM  = inner.match(/(\d+)\s*Pages?/i)
    const sizeM   = inner.match(/(\d+(?:\.\d+)?\s*(?:MB|KB))/)
    const stat    = [pagesM?.[1] && `${pagesM[1]} pages`, sizeM?.[1]].filter(Boolean).join(' · ') || 'PDF Drive'

    books.push({
      id:      `pdf-${books.length}-${href.slice(1, 20).replace(/\W/g, '-')}`,
      title, author: 'Unknown', cover, pageUrl, stat,
    })
  }

  res.status(200).json({ books })
}
