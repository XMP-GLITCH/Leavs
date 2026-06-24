export const config = { maxDuration: 25 }

import { scrape } from '../_lib/proxy.js'

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let html
  try { html = await scrape(url) } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim()

  res.status(200).json({
    length: html.length,
    // All href links on the page
    links: [...html.matchAll(/href="([^"]{4,})"/g)].map(m => m[1]).slice(0, 60),
    // Raw HTML snippets around key words
    download_ctx: [...html.matchAll(/.{100}download.{100}/gi)].map(m => m[0]).slice(0, 5),
    pdf_ctx:      [...html.matchAll(/.{100}\.pdf.{100}/gi)].map(m => m[0]).slice(0, 5),
    onclick_ctx:  [...html.matchAll(/.{60}onclick.{100}/gi)].map(m => m[0]).slice(0, 5),
    dataid_ctx:   [...html.matchAll(/.{60}data-id.{100}/gi)].map(m => m[0]).slice(0, 5),
    // First 2000 chars of visible text
    text: stripped.slice(0, 2000),
  })
}
