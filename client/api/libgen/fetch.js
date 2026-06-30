export const config = { maxDuration: 30 }

import { scrape, BROWSER } from '../_lib/proxy.js'

// Each function takes an MD5 and returns a page URL that contains a direct download link
const DL_SOURCES = [
  md5 => `https://library.lol/main/${md5}`,
  md5 => `https://libgen.li/ads.php?md5=${md5}`,
  md5 => `https://libgen.lc/get.php?md5=${md5}`,
  md5 => `https://libgen.gs/get.php?md5=${md5}`,
  md5 => `https://libgen.st/get.php?md5=${md5}`,
]

function findDirectLink(html) {
  // library.lol: <a href="https://download.library.lol/...">GET</a>
  // Allow optional inner tags (<b>, <span>, etc.) wrapping the GET text
  const get = html.match(/href="(https?:\/\/[^"]+)"[^>]*>(?:<[^>]+>)*[^<]*\bGET\b/i)
  if (get) return get[1]

  // libgen mirrors: GET / Download button
  const dl = html.match(/href="(https?:\/\/[^"]+)"[^>]*>(?:<[^>]+>)*[^<]*\b(?:Download|GET)\b/i)
           || html.match(/<a[^>]+href="(https?:\/\/[^"]+\.(?:pdf|epub|djvu|fb2)[^"]*)"/i)
  if (dl) return dl[1]

  // Relative /get.php or /download links on the same mirror page
  const rel = html.match(/href="(\/(?:get|download)[^"]+)"/i)
  if (rel) return rel[1]

  return null
}

export default async function handler(req, res) {
  const { md5 } = req.query
  if (!md5 || !/^[a-f0-9]{32}$/i.test(md5)) return res.status(400).json({ error: 'invalid md5' })

  let directUrl = null
  let baseOrigin = null

  for (const src of DL_SOURCES) {
    const pageUrl = src(md5)
    try {
      const html = await scrape(pageUrl, { referer: 'https://libgen.rs/' })
      const link = findDirectLink(html)
      if (!link) continue
      // Resolve relative links against the page origin
      const o = new URL(pageUrl)
      directUrl = link.startsWith('http') ? link : `${o.origin}${link}`
      baseOrigin = o.origin
      break
    } catch { continue }
  }

  if (!directUrl) {
    return res.status(404).json({
      error: 'No download link found. The file may have moved — try searching again or switching sources.'
    })
  }

  try {
    const file = await fetch(directUrl, {
      headers: {
        ...BROWSER,
        Referer:          baseOrigin + '/',
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'follow',
    })
    if (!file.ok) throw new Error(`HTTP ${file.status}`)
    const buf = Buffer.from(await file.arrayBuffer())
    res.setHeader('Content-Type',   file.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `Download failed: ${err.message}` })
  }
}
