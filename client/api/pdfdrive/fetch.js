export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

const ALLOWED = new Set(['www.pdfdrive.com', 'pdfdrive.com'])

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'invalid url' }) }
  if (!ALLOWED.has(parsed.hostname)) return res.status(403).json({ error: 'host not allowed' })

  // ── Step 1: fetch book page through proxy ────────────────────────
  let html
  try {
    html = await scrape(url, { referer: 'https://www.pdfdrive.com/' })
  } catch (err) {
    return res.status(502).json({ error: `Could not load page: ${err.message}` })
  }

  // ── Step 2: find download URL ────────────────────────────────────
  // PDF Drive uses data-id + data-preview/data-session to build download URL
  const dataIdM  = html.match(/data-id="(\d+)"/)
  const sessionM = html.match(/data-session="([^"]+)"/) || html.match(/data-preview="([^"]+)"/)
  let pdfUrl = null

  if (dataIdM) {
    const id   = dataIdM[1]
    const sess = sessionM?.[1] || ''
    pdfUrl = `https://www.pdfdrive.com/download.pdf?id=${id}&h=${sess}&u=cache&ext=pdf`
  }

  if (!pdfUrl) {
    const m = html.match(/href="(https?:\/\/[^"]+\.pdf[^"]*)"/i)
    if (m) pdfUrl = m[1]
  }

  if (!pdfUrl) return res.status(404).json({ error: 'No download link found on this page' })

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
