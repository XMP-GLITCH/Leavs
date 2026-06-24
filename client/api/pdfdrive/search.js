export const config = { maxDuration: 25 }

import { scrape } from '../_lib/proxy.js'

const BASE = 'https://www.pdfdrive.com'

function stripTags(s) {
  return (s||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').replace(/&quot;/g,'"').trim()
}

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrape(`${BASE}/search?q=${encodeURIComponent(q)}&pageSize=20`, { referer: BASE + '/' })
  } catch (err) {
    return res.status(502).json({ error: `PDF Drive: ${err.message}` })
  }

  const books = []
  for (const [, href, inner] of html.matchAll(/<a\s[^>]*href="(\/[^"?#]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (books.length >= 20) break
    const imgM  = inner.match(/<img[^>]+src="([^"]+)"/)
    const cover = imgM?.[1]?.startsWith('http') ? imgM[1]
                : imgM?.[1] ? `${BASE}${imgM[1]}` : null
    const titleM = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
                || inner.match(/title="([^"]+)"/)
                || inner.match(/alt="([^"]+)"/)
    if (!titleM) continue
    const title = stripTags(titleM[1] || titleM[2] || '')
    if (!title || title.length < 3) continue
    const pageUrl = `${BASE}${href}`
    const pagesM  = inner.match(/(\d+)\s*Pages?/i)
    const sizeM   = inner.match(/(\d+(?:\.\d+)?\s*(?:MB|KB))/)
    const stat    = [pagesM?.[1] && `${pagesM[1]} pages`, sizeM?.[1]].filter(Boolean).join(' · ') || 'PDF Drive'
    books.push({ id: `pdf-${books.length}-${href.slice(1,20).replace(/\W/g,'-')}`, title, author: 'Unknown', cover, pageUrl, stat })
  }

  res.status(200).json({ books })
}
