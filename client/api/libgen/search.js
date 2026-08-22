export const config = { maxDuration: 45 }

import { scrapeWithMirrors } from '../_lib/proxy.js'

// Live mirrors, ordered by how reliable they have been.
//
// The old list (libgen.rs/.is/.st/.gs) is entirely dead — every one of those
// domains fails to resolve now, which is half of why search returned nothing.
// The other half: those mirrors used /search.php, and the surviving libgen.li
// family serves /index.php and a completely different results table.
const MIRRORS = [
  'https://libgen.li',
  'https://libgen.la',
  'https://libgen.bz',
  'https://libgen.lc',
]

const stripTags = s =>
  (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Parse a libgen.li results page.
 *
 * The table is nine columns: title cell, authors, publisher, year, language,
 * pages, size, extension, mirrors. Exported so it can be tested against saved
 * markup — this is the piece that silently rots when a mirror is redesigned.
 */
export function parseResults(rawHtml, limit = 20) {
  // Strip tooltip title="..." attributes FIRST. They contain <br> and prose,
  // so every [^>] attribute scan below would otherwise break out of the
  // attribute and capture raw markup into the book title.
  const html = rawHtml.replace(/\stitle="[^"]*"/g, '')

  const books = []
  const seen = new Set()

  for (const [row] of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)) {
    if (books.length >= limit) break

    // md5 appears either as get.php?md5=<hash> (Libgen badge) or as
    // /md5/<hash> (the Anna's Archive badge). Accept both.
    const md5m = row.match(/md5[=/]([a-f0-9]{32})/i)
    if (!md5m) continue
    const md5 = md5m[1].toLowerCase()
    if (seen.has(md5)) continue

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1])
    if (cells.length < 9) continue

    // The title cell holds several anchors: series, date, title, ISBN. The
    // title is the longest of the edition.php ones — the others are an italic
    // date and a coloured ISBN.
    const editions = [...cells[0].matchAll(/<a[^>]+href="edition\.php[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
      .map(m => stripTags(m[1]))
      // Drop the ISBN anchor (libgen renders it in a green font) and the italic
      // date one — otherwise a row whose ISBN is longer than its title ends up
      // titled '0553897837; 9780553897838'.
      .filter(t => t && !/^[0-9 ;xX.,-]+$/.test(t))
    const title = editions.sort((a, b) => b.length - a.length)[0] || stripTags(cells[0]).slice(0, 120)
    if (!title) continue

    const author = stripTags(cells[1]) || 'Unknown'
    const year   = stripTags(cells[3])
    const lang   = stripTags(cells[4])
    const size   = stripTags(cells[6])
    const ext    = stripTags(cells[7]).toLowerCase()

    seen.add(md5)
    books.push({
      id: `lg-${md5}`,
      title,
      author,
      cover: null,
      md5,
      ext,
      stat: [year, ext.toUpperCase(), size, lang].filter(Boolean).join(' · '),
    })
  }

  return books
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrapeWithMirrors(MIRRORS, `/index.php?req=${encodeURIComponent(q)}`)
  } catch (err) {
    return res.status(502).json({ error: `Library Genesis: ${err.message}` })
  }

  const looksLikeResults = /md5[=/][a-f0-9]{32}/i.test(html)
  if (!looksLikeResults) {
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

  const books = parseResults(html)

  if (books.length === 0) {
    console.error('[libgen] Parsed 0 books despite md5 markers. HTML snippet:', html.slice(0, 800))
    // The page DID contain result markers, so this is our parser failing on
    // changed markup — not a genuine empty search. Saying so is the difference
    // between a five-minute fix and a mirror being quietly dead for weeks.
    return res.status(200).json({
      books: [],
      degraded: 'Library Genesis responded, but its results could not be read. A mirror has most likely changed its markup — this is not the same as finding nothing.',
    })
  }

  res.status(200).json({ books })
}
