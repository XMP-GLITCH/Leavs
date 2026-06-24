export const config = { maxDuration: 25 }

const MIRRORS = [
  'https://libgen.is',
  'https://libgen.st',
  'https://libgen.rs',
  'https://libgen.li',
  'https://libgen.lc',
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
  return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#\d+;/g,'').trim()
}

async function tryMirror(mirror, q) {
  // Step 1 — hit the homepage to collect any CF cookies
  let cookies = ''
  try {
    const home = await fetch(mirror + '/', { headers: browserHeaders(null) })
    const sc = home.headers.get('set-cookie')
    if (sc) cookies = sc.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
  } catch { /* ignore */ }

  // Step 2 — search
  const url = `${mirror}/search.php?req=${encodeURIComponent(q)}&res=25&view=simple&phrase=1&column=def`
  const headers = { ...browserHeaders(mirror + '/'), ...(cookies ? { Cookie: cookies } : {}) }
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

  for (const mirror of MIRRORS) {
    try {
      html = await tryMirror(mirror, q)
      break
    } catch (e) { errors.push(`${mirror}: ${e.message}`); continue }
  }

  if (!html) {
    return res.status(502).json({
      error: `Library Genesis unavailable — all mirrors blocked.\n${errors.join(', ')}`
    })
  }

  const books = []
  for (const [, row] of html.matchAll(/<tr[^>]*valign="top"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (books.length >= 20) break
    const md5M = row.match(/md5=([a-f0-9]{32})/i)
    if (!md5M) continue
    const md5 = md5M[1].toLowerCase()
    const titleM = row.match(/<a[^>]+id="href"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title) continue
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([,c]) => stripTags(c))
    const author = tds[1] || 'Unknown'
    const year   = tds[4] || ''
    const size   = tds[7] || ''
    const ext    = (tds[8] || '').toLowerCase()
    books.push({ id: `lg-${md5}`, title, author, cover: null, md5, ext,
      stat: [year, ext.toUpperCase(), size].filter(Boolean).join(' · ') })
  }

  res.status(200).json({ books })
}
