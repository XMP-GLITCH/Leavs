/**
 * Shared scraping helper.
 *
 * Set SCRAPER_API_KEY in Vercel → Settings → Environment Variables.
 * Free plan at scraperapi.com — 1 000 req/month, no credit card.
 *
 * Flow (fastest → most powerful):
 *   1. Direct fetch with browser headers (< 2s when it works)
 *   2. allorigins.win free CORS proxy (helps with geo/basic IP blocks)
 *   3. ScraperAPI residential proxy (bypasses Cloudflare, ~5–15s)
 */

const KEY = process.env.SCRAPER_API_KEY

export const BROWSER = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language':           'en-US,en;q=0.9',
  'Accept-Encoding':           'gzip, deflate, br',
  'Cache-Control':             'max-age=0',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Ch-Ua':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile':          '?0',
  'Sec-Ch-Ua-Platform':        '"Windows"',
  'Sec-Fetch-Dest':            'document',
  'Sec-Fetch-Mode':            'navigate',
  'Sec-Fetch-Site':            'none',
  'Sec-Fetch-User':            '?1',
}

function scraperUrl(target) {
  const p = new URLSearchParams({ api_key: KEY.trim(), url: target, device_type: 'desktop' })
  return `https://api.scraperapi.com?${p}`
}

export function isBlocked(status, html) {
  if (status === 401 || status === 403 || status === 429) return true
  if (!html || html.length < 200) return true
  const h = html.toLowerCase()
  return h.includes('just a moment')
      || h.includes('cf-challenge')
      || h.includes('_cf_chl_')
      || h.includes('attention required')
      || h.includes('access denied')
      || h.includes('checking your browser')
      || h.includes('enable javascript and cookies')
      || h.includes('ray id')            // Cloudflare error pages always show Ray ID
      || h.includes('ddos-guard')        // DDoS-Guard (used by some LibGen mirrors)
      || h.includes('please wait')
}

// ── Single URL direct fetch (fast path) ─────────────────────────────
async function directFetch(url, referer) {
  const r = await fetch(url, {
    headers: {
      ...BROWSER,
      ...(referer ? { Referer: referer, 'Sec-Fetch-Site': 'same-origin' } : {}),
    },
    signal: AbortSignal.timeout(4000),
  })
  const html = await r.text()
  if (isBlocked(r.status, html)) throw new Error(`Blocked (HTTP ${r.status})`)
  return html
}

// ── ScraperAPI call with explicit timeout ────────────────────────────
async function scraperFetch(url) {
  const r = await fetch(scraperUrl(url), { signal: AbortSignal.timeout(20000) })
  if (!r.ok) {
    if (r.status === 401) throw new Error('ScraperAPI key invalid or expired (HTTP 401) — check SCRAPER_API_KEY in Vercel env vars')
    throw new Error(`ScraperAPI HTTP ${r.status}`)
  }
  const html = await r.text()
  if (isBlocked(200, html)) throw new Error('ScraperAPI returned a Cloudflare block page')
  return html
}

// ── Free CORS proxy fallback ─────────────────────────────────────────
async function freeFetch(url) {
  const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(6000),
  })
  if (!r.ok) throw new Error(`allorigins HTTP ${r.status}`)
  const html = await r.text()
  if (isBlocked(200, html)) throw new Error('allorigins: blocked content')
  return html
}

/**
 * Fetch a single URL through the best available tier.
 */
export async function scrape(url, { extraHeaders = {}, referer = null } = {}) {
  // Tier 1: direct
  try { return await directFetch(url, referer) } catch { /* try next */ }

  // Tier 2: ScraperAPI (fast-fail on 401 so user sees the key error immediately)
  if (KEY) return scraperFetch(url)

  // Tier 3: free proxy
  try { return await freeFetch(url) } catch { /* ignore */ }

  throw new Error(
    'Blocked by anti-bot protection. Add SCRAPER_API_KEY in Vercel → Settings → Environment Variables (free at scraperapi.com).'
  )
}

/**
 * Try mirrors in parallel for the fast path, then ScraperAPI on the
 * first mirror only. Total budget: ~4s (parallel direct) + ~20s (ScraperAPI) = 24s.
 */
export async function scrapeWithMirrors(mirrors, queryPath, { referer } = {}) {
  // ── Fast path: all mirrors in parallel ──────────────────────────────
  const settled = await Promise.allSettled(
    mirrors.map(m => directFetch(m + queryPath, m + '/'))
  )
  const winner = settled.find(r => r.status === 'fulfilled')
  if (winner) return winner.value

  // ── ScraperAPI on first mirror (single call to stay under timeout) ───
  if (KEY) {
    try { return await scraperFetch(mirrors[0] + queryPath) }
    catch (e) {
      // If key is bad, surface that error immediately — no point trying free proxy
      if (e.message.includes('401')) throw e
    }
  }

  // ── Free proxy last resort ───────────────────────────────────────────
  try { return await freeFetch(mirrors[0] + queryPath) } catch { /* ignore */ }

  const directErrors = settled.map((r, i) =>
    `${mirrors[i].replace('https://', '')}: ${r.reason?.message ?? 'failed'}`
  )
  throw new Error(directErrors.join(' | '))
}
