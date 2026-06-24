export const config = { maxDuration: 20 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim() }

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    const r = await fetch(
      `https://annas-archive.org/search?q=${encodeURIComponent(q)}&lang=en&content=book_any&filetype=pdf,epub&sort=`,
      { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } }
    )
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } catch (err) {
    return res.status(502).json({ error: `Anna's Archive: ${err.message}` })
  }

  const books = []

  // Each result is an <a> tag linking to /md5/HASH
  for (const [, href, card] of html.matchAll(/href="(\/md5\/[a-f0-9]{32})"[^>]*>([\s\S]*?)(?=<\/a>)/gi)) {
    if (books.length >= 20) break

    const md5M = href.match(/([a-f0-9]{32})/i)
    if (!md5M) continue
    const md5 = md5M[1].toLowerCase()

    // Cover image
    const imgM  = card.match(/src="([^"]+)"/)
    const cover = imgM?.[1]?.startsWith('http') ? imgM[1] : null

    // Title — usually in a div or h3 with truncated text
    const titleM = card.match(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//)
                || card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title) continue

    // Author — second line-clamp div or italic
    const lines = [...card.matchAll(/class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\//g)]
    const author = lines[1] ? stripTags(lines[1][1]) : 'Unknown'

    // Format / size info
    const infoM = card.match(/(\d+(?:\.\d+)?\s*(?:MB|KB|GB)[^<]*)/)
    const stat   = infoM ? infoM[1].trim() : "Anna's Archive"

    books.push({ id: `anna-${md5}`, title, author, cover, md5, stat })
  }

  res.status(200).json({ books })
}
