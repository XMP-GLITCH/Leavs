export const config = { maxDuration: 45 }

import { scrapeWithMirrors } from '../_lib/proxy.js'

// Ordered lightest → heaviest Cloudflare protection
const MIRRORS = [
  'https://libgen.rs',
  'https://libgen.li',
  'https://libgen.st',
  'https://libgen.lc',
  'https://libgen.is',
]

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').trim()
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrapeWithMirrors(
      MIRRORS,
      // phrase=0 → each word searched separately (AND), more results
      `/search.php?req=${encodeURIComponent(q)}&res=25&view=simple&phrase=0&column=def`
    )
  } catch (err) {
    return res.status(502).json({ error: `Library Genesis: ${err.message}` })
  }

  if (!html.includes('md5=') && !html.includes('/book/index.php')) {
    const lc = html.toLowerCase()
    const cfBlocked = lc.includes('just a moment') || lc.includes('cf-challenge')
                   || lc.includes('_cf_chl_') || lc.includes('checking your browser')
                   || lc.includes('ddos-guard')
    if (cfBlocked) {
      console.error('[libgen] CF block page, first 600 chars:', html.slice(0, 600))
      return res.status(502).json({ error: 'Library Genesis is blocking our request. Try again later.' })
    }
    return res.status(200).json({ books: [] })
  }

  const books = []
  for (const [, row] of html.matchAll(/<tr[^>]*valign=["']?top["']?[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (books.length >= 20) break
    const md5M = row.match(/md5=([a-f0-9]{32})/i)
    if (!md5M) continue
    const md5 = md5M[1].toLowerCase()

    // Title link: id="href" or id='href'
    const titleM = row.match(/<a[^>]+id=["']href["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title) continue

    const tds    = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, c]) => stripTags(c))
    const author = tds[1] || 'Unknown'
    const year   = tds[4] || ''
    const size   = tds[7] || ''
    const ext    = (tds[8] || '').toLowerCase()

    books.push({
      id:   `lg-${md5}`,
      title,
      author,
      cover: null,
      md5,
      ext,
      stat: [year, ext.toUpperCase(), size].filter(Boolean).join(' · '),
    })
  }

  if (books.length === 0) {
    console.error('[libgen] Parsed 0 books. HTML snippet:', html.slice(0, 800))
  }

  res.status(200).json({ books })
}
