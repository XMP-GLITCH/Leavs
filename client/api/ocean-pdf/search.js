export const config = { maxDuration: 20 }

const BASE = 'https://oceanofpdf.com'

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
    const r = await fetch(`${BASE}/?s=${encodeURIComponent(q)}`, { headers })
    html = await r.text()
    if (isBlocked(r.status, html)) {
      return res.status(502).json({ error: `OceanPDF is blocked (${r.status}) — try another source` })
    }
  } catch (err) {
    return res.status(502).json({ error: `OceanPDF: ${err.message}` })
  }

  const books = []
  const blocks = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1])

  for (const block of blocks) {
    if (books.length >= 20) break

    const linkM = block.match(/<h[1-4][^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
                || block.match(/<a\s+href="([^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    if (!linkM) continue

    const pageUrl = linkM[1]
    const title   = linkM[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').trim()
    if (!title || !pageUrl.includes('oceanofpdf.com')) continue

    const imgM  = block.match(/<img[^>]+src="([^"]+\.(jpe?g|png|webp)[^"]*)"/)
    const cover = imgM?.[1] || null

    const authM = block.match(/(?:by|author)[:\s]+<[^>]+>(.*?)<\/|(?:by|author)[:\s]+([A-Z][^\n<]{2,40})/i)
    const author = (authM?.[1] || authM?.[2] || '').replace(/<[^>]+>/g,'').trim() || 'Unknown'

    books.push({ id: `opdf-${books.length}`, title, author, cover, pageUrl })
  }

  res.setHeader('Cache-Control', 'public, max-age=600')
  res.status(200).json({ books })
}
