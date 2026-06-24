export const config = { maxDuration: 30 }

function browserHeaders(referer) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    ...(referer ? { 'Referer': referer, 'Sec-Fetch-Site': 'cross-site' } : {}),
  }
}

// Try each download source in order until one works
const DL_SOURCES = [
  md5 => `https://library.lol/main/${md5}`,
  md5 => `https://libgen.lc/get.php?md5=${md5}`,
  md5 => `https://libgen.gs/get.php?md5=${md5}`,
]

async function findDirectLink(pageUrl, referer) {
  const r = await fetch(pageUrl, { headers: browserHeaders(referer), redirect: 'follow' })
  if (!r.ok) return null
  const html = await r.text()
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
    const file = await fetch(directUrl, { headers: browserHeaders('https://library.lol/'), redirect: 'follow' })
    if (!file.ok) throw new Error(`HTTP ${file.status}`)
    const buf = Buffer.from(await file.arrayBuffer())
    res.setHeader('Content-Type', file.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Content-Length', buf.length)
    res.status(200).send(buf)
  } catch (err) {
    res.status(502).json({ error: `Download failed: ${err.message}` })
  }
}
