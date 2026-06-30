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
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/&quot;/g, '"').trim()
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrapeWithMirrors(
      MIRRORS,
      // ext= (not filetype=), no trailing empty sort param
      `/search?q=${encodeURIComponent(q)}&lang=en&content=book_any&ext=epub,pdf&sort=mostRelevant`
    )
  } catch (err) {
    return res.status(502).json({ error: `Anna's Archive: ${err.message}` })
  }

  if (!html.includes('/md5/')) {
    const lc = html.toLowerCase()
    const cfBlocked = lc.includes('just a moment') || lc.includes('cf-challenge')
                   || lc.includes('_cf_chl_') || lc.includes('checking your browser')
                   || lc.includes('ddos-guard')
    if (cfBlocked) {
      console.error("[anna] CF block page, first 600 chars:", html.slice(0, 600))
      return res.status(502).json({ error: "Anna's Archive is blocking our request. Try again later." })
    }
    return res.status(200).json({ books: [] })
  }

  const books = []
  const seenMd5 = new Set()

  // Use position-based extraction to avoid nested-</a> truncation bug
  const md5Re = /href="\/md5\/([a-f0-9]{32})"/gi
  let m
  while ((m = md5Re.exec(html)) !== null) {
    if (books.length >= 20) break
    const [, md5] = m
    if (seenMd5.has(md5)) continue
    seenMd5.add(md5)

    // Walk back to the opening <a of this card
    const cardStart = html.lastIndexOf('<a ', m.index)
    if (cardStart < 0) continue
    // Take 3000 chars forward — enough for any card
    const card = html.slice(cardStart, m.index + 3000)

    // Cover image (only absolute URLs)
    const imgM  = card.match(/src="(https?:\/\/[^"]+)"/)
    const cover = imgM?.[1] ?? null

    // Title: first line-clamp element, <h3>, or any div with text
    const titleM = card.match(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//)
                || card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
                || card.match(/<div[^>]*>([\s\S]{5,120}?)<\/div>/)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title || title.length < 2) continue

    // Author: second line-clamp element
    const lines  = [...card.matchAll(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//g)]
    const author = lines[1] ? stripTags(lines[1][1]) : 'Unknown'

    // File size
    const infoM = card.match(/(\d+(?:\.\d+)?\s*(?:MB|KB|GB)[^<]*)/)
    const stat  = infoM ? infoM[1].trim() : "Anna's Archive"

    books.push({ id: `anna-${md5}`, title, author, cover, md5, stat })
  }

  if (books.length === 0) {
    console.error("[anna] Parsed 0 books. HTML snippet:", html.slice(0, 800))
  }

  res.status(200).json({ books })
}
