/**
 * Shared scraping helper.
 *
 * Set SCRAPER_API_KEY in your Vercel Environment Variables to route all
 * scraping through ScraperAPI's residential IPs, bypassing Cloudflare.
 * Free plan at scraperapi.com — 1000 req/month, no credit card required.
 *
 * Without the key we fall back to:
 *   1. Direct fetch with full browser headers + cookie prefetch
 *   2. allorigins.win free CORS proxy (helps with basic blocks, not CF JS challenges)
 */

const KEY = process.env.SCRAPER_API_KEY

export const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
}

function scraperUrl(target) {
  const p = new URLSearchParams({ api_key: KEY, url: target, device_type: 'desktop', keep_headers: 'true' })
  return `https://api.scraperapi.com?${p}`
}

export function isBlocked(status, html) {
  return status === 403 || status === 429
    || html.includes('Just a moment')
    || html.includes('cf-challenge')
    || html.includes('_cf_chl_')
    || html.includes('Attention Required!')
    || html.includes('Access denied')
}

/**
 * Fetch a URL's HTML, going through ScraperAPI when the key is present.
 * Falls back to direct fetch + allorigins.win proxy when no key.
 */
export async function scrape(url, { extraHeaders = {}, referer = null } = {}) {
  if (KEY) {
    const r = await fetch(scraperUrl(url))
    if (!r.ok) throw new Error(`ScraperAPI HTTP ${r.status}`)
    const html = await r.text()
    if (isBlocked(200, html)) throw new Error('ScraperAPI: still blocked after proxy')
    return html
  }

  // ── Tier 1: direct fetch with browser headers + cookie prefetch ──────
  try {
    let cookies = ''
    if (referer) {
      try {
        const home = await fetch(referer, { headers: BROWSER })
        const sc   = home.headers.get('set-cookie')
        if (sc) cookies = sc.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
      } catch { /* ignore */ }
    }
    const headers = {
      ...BROWSER,
      ...(referer  ? { Referer: referer, 'Sec-Fetch-Site': 'same-origin' } : {}),
      ...(cookies  ? { Cookie: cookies  } : {}),
      ...extraHeaders,
    }
    const r    = await fetch(url, { headers })
    const html = await r.text()
    if (!isBlocked(r.status, html)) return html
    // blocked — fall through to free proxy
  } catch { /* network error — fall through */ }

  // ── Tier 2: free CORS proxy (bypasses basic IP/geo blocks, not CF JS) ──
  try {
    const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': BROWSER['User-Agent'] },
    })
    if (r.ok) {
      const html = await r.text()
      if (!isBlocked(200, html) && html.length > 200) return html
    }
  } catch { /* ignore */ }

  throw new Error(
    'Blocked by Cloudflare. Add SCRAPER_API_KEY in Vercel → Settings → Environment Variables (free at scraperapi.com).'
  )
}

/**
 * Try an ordered list of mirror URLs, returning the first that succeeds.
 * Always tries every mirror (with ScraperAPI or without) before giving up.
 */
export async function scrapeWithMirrors(mirrors, queryPath, { referer } = {}) {
  const errors = []
  for (const mirror of mirrors) {
    try {
      // scrape() routes through ScraperAPI when KEY is set, direct otherwise
      const html = await scrape(mirror + queryPath, { referer: referer ?? (mirror + '/') })
      return html
    } catch (e) {
      errors.push(`${mirror.replace('https://', '')}: ${e.message}`)
    }
  }
  throw new Error(errors.join(' | '))
}
