export const config = { maxDuration: 20 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function stripTags(s) { return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim() }

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    const r = await fetch(
      `https://www.pdfdrive.com/search?q=${encodeURIComponent(q)}&pageSize=20`,
      { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': 'https://www.pdfdrive.com/' } }
    )
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } catch (err) {
    return res.status(502).json({ error: `PDF Drive: ${err.message}` })
  }

  const books = []

  // PDF Drive result cards: <div class="file-left"> + <div class="file-right">
  for (const [, card] of html.matchAll(/<div[^>]+class="[^"]*file-[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*file-[^"]*"|<\/ul>)/gi)) {
    if (books.length >= 20) break

    const hrefM = card.match(/href="(\/[^"]+\.html)"/)
    if (!hrefM) continue
    const pageUrl = `https://www.pdfdrive.com${hrefM[1]}`

    const imgM  = card.match(/<img[^>]+src="([^"]+)"/)
    const cover = imgM?.[1]?.startsWith('http') ? imgM[1] : imgM?.[1] ? `https://www.pdfdrive.com${imgM[1]}` : null

    const titleM = card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || card.match(/title="([^"]+)"/)
    if (!titleM) continue
    const title = stripTags(titleM[1])
    if (!title) continue

    const authorM = card.match(/class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\//i)
    const author  = authorM ? stripTags(authorM[1]) : 'Unknown'

    const detailM = card.match(/class="[^"]*detail[^"]*"[^>]*>([\s\S]*?)<\//i)
    const stat    = detailM ? stripTags(detailM[1]) : 'PDF Drive'

    books.push({ id: `pdf-${books.length}-${encodeURIComponent(title).slice(0,20)}`, title, author, cover, pageUrl, stat })
  }

  res.status(200).json({ books })
}
