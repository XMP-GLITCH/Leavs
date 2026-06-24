export const config = { maxDuration: 45 }

import { scrapeWithMirrors } from '../_lib/proxy.js'

// Ordered lightest → heaviest Cloudflare protection
const MIRRORS = [
  'https://annas-archive.se',
  'https://annas-archive.gs',
  'https://annas-archive.li',
  'https://annas-archive.org',
]

function stripTags(s) {
  return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim()
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrapeWithMirrors(
      MIRRORS,
      `/search?q=${encodeURIComponent(q)}&lang=en&content=book_any&filetype=pdf,epub&sort=`
    )
  } catch (err) {
    return res.status(502).json({ error: `Anna's Archive: ${err.message}` })
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
