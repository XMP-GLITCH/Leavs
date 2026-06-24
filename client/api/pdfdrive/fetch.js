export const config = { maxDuration: 30 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'invalid url' }) }
  if (!['www.pdfdrive.com', 'pdfdrive.com'].includes(parsed.hostname)) {
    return res.status(403).json({ error: 'host not allowed' })
  }

  // ── Fetch book page to get the download trigger URL ──────────────
  let html
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.pdfdrive.com/' } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } catch (err) {
    return res.status(502).json({ error: `Could not load page: ${err.message}` })
  }

  // PDF Drive uses a button with data-id + data-preview to build the download URL:
  // GET /download/?id={data-id}&h={hash}&u=cache
  const dataIdM   = html.match(/data-id="(\d+)"/)
  const sessionM  = html.match(/data-session="([^"]+)"/) || html.match(/data-preview="([^"]+)"/)

  let pdfUrl = null

  if (dataIdM) {
    // Try the known PDF Drive download URL pattern
    const id   = dataIdM[1]
    const sess = sessionM?.[1] || ''
    pdfUrl = `https://www.pdfdrive.com/download.pdf?id=${id}&h=${sess}&u=cache&ext=pdf`
  }

  // Fallback: look for a direct .pdf href
  if (!pdfUrl) {
    const m = html.match(/href="(https?:\/\/[^"]+\.pdf[^"]*)"/i)
    if (m) pdfUrl = m[1]
  }

  if (!pdfUrl) return res.status(404).json({ error: 'No download link found on this page' })

  // ── Stream the PDF ────────────────────────────────────────────────
  try {
    const file = await fetch(pdfUrl, {
      headers: { 'User-Agent': UA, 'Referer': url },
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
