export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

const DL_SOURCES = [
  md5 => `https://library.lol/main/${md5}`,
  md5 => `https://libgen.lc/get.php?md5=${md5}`,
  md5 => `https://libgen.gs/get.php?md5=${md5}`,
]

async function findDirectLink(pageUrl, referer) {
  const html = await scrape(pageUrl, { referer })
  const m = html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*(?:GET|Download)\s*</i)
         || html.match(/href="(https?:\/\/[^"]+\.(?:pdf|epub|djvu|fb2)[^"]*)"/i)
  return m?.[1] || null
}

export default async function handler(req, res) {
  const { md5 } = req.query
  if (!md5 || !/^[a-f0-9]{32}$/i.test(md5)) return res.status(400).json({ error: 'invalid md5' })

  let directUrl = null
  for (const src of DL_SOURCES) {
    try {
      directUrl = await findDirectLink(src(md5), 'https://libgen.is/')
      if (directUrl) break
    } catch { continue }
  }

  if (!directUrl) return res.status(404).json({ error: 'Could not find a download link' })

  try {
    const file = await fetch(directUrl, {
      headers: { ...BROWSER, Referer: 'https://library.lol/', 'Sec-Fetch-Site': 'cross-site' },
      redirect: 'follow',
    })
    if (!file.ok) throw new Error(`HTTP ${file.status}`)
    const buf = Buffer.from(await file.arrayBuffer())
    res.setHeader('Content-Type', file.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `Download failed: ${err.message}` })
  }
}
