export const config = { maxDuration: 30 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ALLOWED = new Set(['oceanofpdf.com', 'www.oceanofpdf.com', 'oceanpdf.com', 'www.oceanpdf.com'])

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'invalid url' }) }
  if (!ALLOWED.has(parsed.hostname)) return res.status(403).json({ error: 'host not allowed' })

  // ── Step 1: fetch book page ──────────────────────────────────────
  let html
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,*/*',
        'Referer': 'https://oceanofpdf.com/',
      },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } catch (err) {
    return res.status(502).json({ error: `Could not load book page: ${err.message}` })
  }

  // ── Step 2: find PDF URL ─────────────────────────────────────────
  let pdfUrl = null

  // Direct .pdf link anywhere on page
  const pdfHref = html.match(/href="(https?:\/\/[^"]+\.pdf(?:\?[^"]*)?)"/i)
  if (pdfHref) pdfUrl = pdfHref[1]

  // Download button / link text
  if (!pdfUrl) {
    const dlBtn = html.match(
      /href="(https?:\/\/[^"]+)"[^>]*>(?:<[^>]+>)*\s*(?:Download|Get PDF|PDF Download|Download PDF)\s*(?:<\/[^>]+>)*/i
    )
    if (dlBtn) pdfUrl = dlBtn[1]
  }

  // <a download href="...">
  if (!pdfUrl) {
    const dlAttr = html.match(/<a[^>]+\bdownload\b[^>]+href="(https?:\/\/[^"]+)"/i)
                || html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]+\bdownload\b/i)
    if (dlAttr) pdfUrl = dlAttr[1]
  }

  if (!pdfUrl) return res.status(404).json({ error: 'No PDF link found on this page' })

  // ── Step 3: stream PDF back to client ────────────────────────────
  try {
    const pdf = await fetch(pdfUrl, {
      headers: { 'User-Agent': UA, 'Referer': url },
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
