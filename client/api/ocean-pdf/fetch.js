export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

const ALLOWED = new Set(['oceanofpdf.com', 'www.oceanofpdf.com', 'oceanpdf.com', 'www.oceanpdf.com'])

function findDownloadUrl(html, pageUrl) {
  // 1. Direct .pdf href
  const pdf = html.match(/href="(https?:\/\/[^"]+\.pdf(?:[?#][^"]*)?)"/i)
  if (pdf) return pdf[1]

  // 2. Download / Get PDF button href
  const btn = html.match(/href="([^"]+)"[^>]*>(?:<[^>]+>)*\s*(?:Download|Get PDF|PDF Download|Download PDF|Download Book)\s*/i)
           || html.match(/class="[^"]*(?:download|dl-btn|pdf-btn)[^"]*"[^>]*href="([^"]+)"/i)
  if (btn) {
    const h = btn[1]
    try { return new URL(h, pageUrl).href } catch { return null }
  }

  // 3. <a download> attribute
  const dlAttr = html.match(/<a[^>]+\bdownload\b[^>]*href="([^"]+)"/i)
              || html.match(/<a[^>]+href="([^"]+)"[^>]+\bdownload\b/i)
  if (dlAttr) {
    try { return new URL(dlAttr[1], pageUrl).href } catch { return null }
  }

  // 4. Google Drive, Dropbox, MediaFire, archive.org links
  const external = html.match(/href="(https?:\/\/(?:drive\.google\.com|www\.dropbox\.com|www\.mediafire\.com|archive\.org\/download)[^"]+)"/i)
  if (external) return external[1]

  // 5. Any link with "download" in the path
  const dlPath = html.match(/href="(https?:\/\/[^"]*\/download[^"]*)"/)
  if (dlPath) return dlPath[1]

  return null
}

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'invalid url' }) }
  if (!ALLOWED.has(parsed.hostname)) return res.status(403).json({ error: 'host not allowed' })

  // ── Step 1: fetch book page ──────────────────────────────────────
  let html
  try {
    html = await scrape(url, { referer: 'https://oceanofpdf.com/' })
  } catch (err) {
    return res.status(502).json({ error: `Could not load page: ${err.message}` })
  }

  // ── Step 2: find download URL ────────────────────────────────────
  const dlUrl = findDownloadUrl(html, url)
  if (!dlUrl) return res.status(404).json({ error: 'No download link found on this page' })

  // ── Step 3: stream file ──────────────────────────────────────────
  try {
    const file = await fetch(dlUrl, {
      headers: { ...BROWSER, Referer: url, 'Sec-Fetch-Site': 'cross-site' },
      redirect: 'follow',
    })
    if (!file.ok) throw new Error(`HTTP ${file.status}`)
    const buf = Buffer.from(await file.arrayBuffer())
    res.setHeader('Content-Type', file.headers.get('content-type') || 'application/pdf')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `Download failed: ${err.message}` })
  }
}
