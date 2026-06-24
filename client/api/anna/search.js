export const config = { maxDuration: 25 }

const DOMAINS = [
  'https://annas-archive.org',
  'https://annas-archive.se',
  'https://annas-archive.gs',
  'https://annas-archive.li',
]

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

async function tryDomain(domain, q) {
  // Prefetch homepage to collect CF cookies
  let cookies = ''
  try {
    const home = await fetch(domain + '/', { headers: browserHeaders(null) })
    const sc = home.headers.get('set-cookie')
    if (sc) cookies = sc.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
  } catch { /* ignore */ }

  const url = `${domain}/search?q=${encodeURIComponent(q)}&lang=en&content=book_any&filetype=pdf,epub&sort=`
  const headers = { ...browserHeaders(domain + '/'), ...(cookies ? { Cookie: cookies } : {}) }
  const r = await fetch(url, { headers })
  const html = await r.text()
  if (isBlocked(r.status, html)) throw new Error(`blocked (${r.status})`)
  return html
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html = null
  const errors = []

  for (const domain of DOMAINS) {
    try {
      html = await tryDomain(domain, q)
      break
    } catch (e) { errors.push(`${domain}: ${e.message}`); continue }
  }

  if (!html) {
    return res.status(502).json({
      error: `Anna's Archive unavailable — all mirrors blocked. Try Library Genesis instead.\n${errors.join(', ')}`
    })
  }

  const books = []
  for (const [, href, card] of html.matchAll(/href="(\/md5\/[a-f0-9]{32})"[^>]*>([\s\S]*?)(?=<\/a>)/gi)) {
    if (books.length >= 20) break
    const md5M = href.match(/([a-f0-9]{32})/i)
    if (!md5M) continue
    const md5 = md5M[1].toLowerCase()
    const imgM  = card.match(/src="([^"]+)"/)
    const cover = imgM?.[1]?.startsWith('http') ? imgM[1] : null
    const titleM = card.match(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//)
                || card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title) continue
    const lines = [...card.matchAll(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//g)]
    const author = lines[1] ? stripTags(lines[1][1]) : 'Unknown'
    const infoM  = card.match(/(\d+(?:\.\d+)?\s*(?:MB|KB|GB)[^<]*)/)
    const stat   = infoM ? infoM[1].trim() : "Anna's Archive"
    books.push({ id: `anna-${md5}`, title, author, cover, md5, stat })
  }

  res.status(200).json({ books })
}
