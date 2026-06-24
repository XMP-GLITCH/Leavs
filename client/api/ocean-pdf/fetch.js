export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

const ALLOWED = new Set(['oceanofpdf.com', 'www.oceanofpdf.com', 'oceanpdf.com', 'www.oceanpdf.com'])

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'invalid url' }) }
  if (!ALLOWED.has(parsed.hostname)) return res.status(403).json({ error: 'host not allowed' })

  // ── Step 1: fetch book page through proxy ────────────────────────
  let html
  try {
    html = await scrape(url, { referer: 'https://oceanofpdf.com/' })
  } catch (err) {
    return res.status(502).json({ error: `Could not load page: ${err.message}` })
  }

  // ── Step 2: find PDF URL ─────────────────────────────────────────
  let pdfUrl = null

  const pdfHref = html.match(/href="(https?:\/\/[^"]+\.pdf(?:\?[^"]*)?)"/i)
  if (pdfHref) pdfUrl = pdfHref[1]

  if (!pdfUrl) {
    const dlBtn = html.match(
      /href="(https?:\/\/[^"]+)"[^>]*>(?:<[^>]+>)*\s*(?:Download|Get PDF|PDF Download|Download PDF)\s*(?:<\/[^>]+>)*/i
    )
    if (dlBtn) pdfUrl = dlBtn[1]
  }

  if (!pdfUrl) {
    const dlAttr = html.match(/<a[^>]+\bdownload\b[^>]+href="(https?:\/\/[^"]+)"/i)
                || html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]+\bdownload\b/i)
    if (dlAttr) pdfUrl = dlAttr[1]
  }

  if (!pdfUrl) return res.status(404).json({ error: 'No PDF link found on this page' })

  // ── Step 3: stream PDF ───────────────────────────────────────────
  try {
    const pdf = await fetch(pdfUrl, {
      headers: { ...BROWSER, Referer: url, 'Sec-Fetch-Site': 'cross-site' },
      redirect: 'follow',
    })
    if (!pdf.ok) throw new Error(`PDF server returned ${pdf.status}`)
    const buf = Buffer.from(await pdf.arrayBuffer())
    res.setHeader('Content-Type', pdf.headers.get('content-type') || 'application/pdf')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `PDF download failed: ${err.message}` })
  }
}
