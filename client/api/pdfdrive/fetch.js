export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

const BASE = 'https://www.pdfdrive.com'
const ALLOWED = new Set(['www.pdfdrive.com', 'pdfdrive.com'])

function findPdfUrl(html, pageUrl) {
  // 1. Direct /download.pdf?id= href already in page
  const direct = html.match(/href="(\/download(?:\.pdf)?\?[^"]+)"/)
  if (direct) return BASE + direct[1]

  // 2. data-id attribute (various element types)
  const idM   = html.match(/data-id="(\d{4,})"/)
  const hashM = html.match(/data-(?:preview|session|hash|key)="([a-zA-Z0-9_-]{4,})"/)
  if (idM) {
    return `${BASE}/download.pdf?id=${idM[1]}&h=${hashM?.[1] ?? ''}&u=cache&ext=pdf`
  }

  // 3. Book ID encoded in the URL slug: /title-dNNNNNNN.html
  const slugId = pageUrl.match(/[- ]d(\d{5,})\.html$/i)
  if (slugId) {
    return `${BASE}/download.pdf?id=${slugId[1]}&h=&u=cache&ext=pdf`
  }

  // 4. Any .pdf link on the page
  const pdfHref = html.match(/href="(https?:\/\/[^"]+\.pdf(?:[?#][^"]*)?)"/i)
  if (pdfHref) return pdfHref[1]

  // 5. /drive/?id= pattern
  const driveHref = html.match(/href="(\/drive\/\?[^"]+)"/)
  if (driveHref) return BASE + driveHref[1]

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
    html = await scrape(url, { referer: BASE + '/' })
  } catch (err) {
    return res.status(502).json({ error: `Could not load page: ${err.message}` })
  }

  // ── Step 2: resolve download URL ─────────────────────────────────
  const pdfUrl = findPdfUrl(html, url)
  if (!pdfUrl) return res.status(404).json({ error: 'No download link found — PDF Drive may require login' })

  // ── Step 3: stream the PDF ───────────────────────────────────────
  try {
    const file = await fetch(pdfUrl, {
      headers: { ...BROWSER, Referer: url, 'Sec-Fetch-Site': 'same-origin' },
      redirect: 'follow',
    })
    if (!file.ok) throw new Error(`HTTP ${file.status}`)
    const buf = Buffer.from(await file.arrayBuffer())
    res.setHeader('Content-Type', file.headers.get('content-type') || 'application/pdf')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `PDF download failed: ${err.message}` })
  }
}
