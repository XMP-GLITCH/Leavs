export const config = { maxDuration: 20 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const MIRRORS = ['https://libgen.is', 'https://libgen.st', 'https://libgen.rs']

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#\d+;/g,'').trim() }

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html = null
  for (const mirror of MIRRORS) {
    try {
      const r = await fetch(
        `${mirror}/search.php?req=${encodeURIComponent(q)}&res=25&view=simple&phrase=1&column=def`,
        { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }
      )
      if (r.ok) { html = await r.text(); break }
    } catch { continue }
  }
  if (!html) return res.status(502).json({ error: 'All LibGen mirrors failed' })

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
