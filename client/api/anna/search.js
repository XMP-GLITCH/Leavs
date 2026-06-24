export const config = { maxDuration: 25 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const DOMAINS = [
  'https://annas-archive.org',
  'https://annas-archive.se',
  'https://annas-archive.gs',
  'https://annas-archive.li',
]

function isCloudflareChallenge(html) {
  return html.includes('Just a moment') || html.includes('cf-challenge') || html.includes('_cf_chl_')
}

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim() }

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html = null
  let lastError = 'All mirrors failed'

  for (const domain of DOMAINS) {
    try {
      const r = await fetch(
        `${domain}/search?q=${encodeURIComponent(q)}&lang=en&content=book_any&filetype=pdf,epub&sort=`,
        {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': domain + '/',
          },
        }
      )
      if (!r.ok) { lastError = `HTTP ${r.status} from ${domain}`; continue }
      const text = await r.text()
      if (isCloudflareChallenge(text)) { lastError = `${domain} is Cloudflare-blocked`; continue }
      html = text
      break
    } catch (e) { lastError = e.message; continue }
  }

  if (!html) {
    return res.status(502).json({ error: `Anna's Archive: ${lastError} — try Library Genesis instead` })
  }

  const books = []

  // Each result is an <a> tag linking to /md5/HASH
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

    const infoM = card.match(/(\d+(?:\.\d+)?\s*(?:MB|KB|GB)[^<]*)/)
    const stat  = infoM ? infoM[1].trim() : "Anna's Archive"

    books.push({ id: `anna-${md5}`, title, author, cover, md5, stat })
  }

  res.status(200).json({ books })
}
