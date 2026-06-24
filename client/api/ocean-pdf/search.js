export const config = { maxDuration: 25 }

import { scrape } from '../_lib/proxy.js'

const BASE = 'https://oceanofpdf.com'

export default async function handler(req, res) {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'query required' })

  let html
  try {
    html = await scrape(`${BASE}/?s=${encodeURIComponent(q)}`, { referer: BASE + '/' })
  } catch (err) {
    return res.status(502).json({ error: `OceanPDF: ${err.message}` })
  }

  const books = []
  const blocks = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1])

  for (const block of blocks) {
    if (books.length >= 20) break
    const linkM = block.match(/<h[1-4][^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
                || block.match(/<a\s+href="([^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/)
    if (!linkM) continue
    const pageUrl = linkM[1]
    const title   = linkM[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#\d+;/g,'').trim()
    if (!title || !pageUrl.includes('oceanofpdf.com')) continue
    const imgM  = block.match(/<img[^>]+src="([^"]+\.(jpe?g|png|webp)[^"]*)"/)
    const cover = imgM?.[1] || null
    const authM = block.match(/(?:by|author)[:\s]+<[^>]+>(.*?)<\/|(?:by|author)[:\s]+([A-Z][^\n<]{2,40})/i)
    const author = (authM?.[1] || authM?.[2] || '').replace(/<[^>]+>/g,'').trim() || 'Unknown'
    books.push({ id: `opdf-${books.length}`, title, author, cover, pageUrl })
  }

  res.setHeader('Cache-Control', 'public, max-age=600')
  res.status(200).json({ books })
}
