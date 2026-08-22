// The libgen CDN is heavily throttled — hundreds of KB over tens of seconds —
// so this needs every second the platform will give it.
export const config = { maxDuration: 300 }

import { Readable } from 'node:stream'
import { scrape, BROWSER } from '../_lib/proxy.js'

// Mirrors that are actually alive. libgen.rs/.is/.st/.gs and library.lol all
// stopped resolving; they were the entire old list.
const MIRRORS = [
  'https://libgen.li',
  'https://libgen.la',
  'https://libgen.bz',
  'https://libgen.lc',
]

// The download URL is scraped from — or redirected to by — a third party, so
// it is attacker-controlled the moment a mirror is compromised or spoofed.
// Without this, whoever controls a mirror decides what this deployment fetches
// and streams back: an open proxy. gutenberg/proxy.js has always done this.
//
// booksdl.* matters as much as the mirrors themselves: libgen.li/get.php
// answers 307 and the actual bytes come from cdn<N>.booksdl.lc, so omitting it
// would let the allowlist block every legitimate download.
const ALLOWED_DL_DOMAINS = [
  'libgen.li', 'libgen.la', 'libgen.bz', 'libgen.lc',
  'booksdl.lc', 'booksdl.org',
  'library.lol',
  'annas-archive.se', 'annas-archive.gs', 'annas-archive.li', 'annas-archive.org',
]

export function isAllowedDownload(urlStr) {
  let u
  try { u = new URL(urlStr) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  // Exact domain or a subdomain of it (cdn3.booksdl.lc, download.library.lol…).
  // The leading dot is what stops "evil-libgen.li" matching "libgen.li".
  return ALLOWED_DL_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d))
}

function findDirectLink(html) {
  // The GET button. Allow inner tags (<b>, <span>) wrapping the text.
  const get = html.match(/href="([^"]+)"[^>]*>(?:<[^>]+>)*[^<]*\bGET\b/i)
  if (get) return get[1]

  const dl = html.match(/href="([^"]+)"[^>]*>(?:<[^>]+>)*[^<]*\b(?:Download|GET)\b/i)
           || html.match(/<a[^>]+href="([^"]+\.(?:pdf|epub|djvu|fb2|mobi|azw3|cbz)[^"]*)"/i)
  if (dl) return dl[1]

  // libgen.li's keyed link is relative WITHOUT a leading slash
  // (get.php?md5=…&key=…) — the old pattern required one and so never matched.
  const rel = html.match(/href="((?:\/)?(?:get|download)[^"]*)"/i)
  if (rel) return rel[1]

  return null
}

// Follow redirects by hand, re-checking the allowlist at every hop.
// redirect:'follow' would validate only the first URL then go wherever sent.
const MAX_HOPS = 6

// Bound how long we wait for RESPONSE HEADERS, but never the body. A single
// AbortSignal.timeout would also kill a download in flight, and this CDN
// legitimately takes minutes for a large book.
const HEADER_TIMEOUT_MS = 20000

async function fetchHeaders(url, opts) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HEADER_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    // Cleared once headers are in, so the body may stream for as long as it needs.
    clearTimeout(timer)
  }
}

async function fetchAllowlisted(startUrl, referer) {
  let url = startUrl
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isAllowedDownload(url)) throw new Error(`download host not allowed: ${new URL(url).hostname}`)
    const res = await fetchHeaders(url, {
      headers: { ...BROWSER, Referer: referer, 'Sec-Fetch-Site': 'same-origin' },
      redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`redirect with no location (HTTP ${res.status})`)
      url = new URL(loc, url).href
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // A download page instead of a file means the direct route needs the key.
    const type = res.headers.get('content-type') || ''
    if (type.includes('text/html')) throw new Error('got a page, not a file')
    return res
  }
  throw new Error(`too many redirects (>${MAX_HOPS})`)
}

export default async function handler(req, res) {
  const { md5 } = req.query
  if (!md5 || !/^[a-f0-9]{32}$/i.test(md5)) return res.status(400).json({ error: 'invalid md5' })

  const errors = []

  // ── Fast path: get.php redirects straight to the CDN, no scraping at all ──
  for (const mirror of MIRRORS) {
    try {
      const file = await fetchAllowlisted(`${mirror}/get.php?md5=${md5}`, `${mirror}/`)
      return await stream(file, res)
    } catch (e) { errors.push(`${mirror}: ${e.message}`) }
  }

  // ── Fallback: the ads.php page carries a keyed GET link ──────────────────
  for (const mirror of MIRRORS) {
    const pageUrl = `${mirror}/ads.php?md5=${md5}`
    try {
      const html = await scrape(pageUrl, { referer: `${mirror}/` })
      const link = findDirectLink(html)
      if (!link) { errors.push(`${mirror}: no link on page`); continue }
      const resolved = new URL(link, pageUrl).href
      if (!isAllowedDownload(resolved)) {
        console.error(`[libgen/fetch] rejected off-allowlist link from ${mirror}: ${resolved}`)
        errors.push(`${mirror}: link off allowlist`)
        continue
      }
      const file = await fetchAllowlisted(resolved, `${mirror}/`)
      return await stream(file, res)
    } catch (e) { errors.push(`${mirror}: ${e.message}`) }
  }

  console.error('[libgen/fetch] all sources failed:', errors.join(' | '))
  return res.status(404).json({
    error: 'No download link found. The file may have moved — try searching again or switching sources.',
  })
}

// Pipe rather than buffer. arrayBuffer() held the entire book in memory and
// produced nothing at all until the last byte arrived — on a CDN this slow it
// simply ran out the clock. Streaming also lets the client's progress bar move.
function stream(file, res) {
  res.status(200)
  res.setHeader('Content-Type', file.headers.get('content-type') || 'application/octet-stream')
  const len = file.headers.get('content-length')
  if (len) res.setHeader('Content-Length', len)
  return new Promise((resolve, reject) => {
    const body = Readable.fromWeb(file.body)
    body.on('error', reject)
    res.on('finish', resolve)
    body.pipe(res)
  })
}
