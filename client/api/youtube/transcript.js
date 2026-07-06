export const config = { maxDuration: 20 }

function extractVideoId(input) {
  const s = (input || '').trim()
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split(/[?&#]/)[0]
    const v = url.searchParams.get('v')
    if (v) return v
  } catch {}
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { url: rawUrl } = req.query
  if (!rawUrl) return res.status(400).json({ error: 'url required' })

  const videoId = extractVideoId(rawUrl)
  if (!videoId) return res.status(400).json({ error: 'Could not extract video ID from URL' })

  try {
    const { YoutubeTranscript } = await import('youtube-transcript')

    // Fetch transcript segments
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId))  // fallback to any lang

    if (!segments?.length) {
      return res.status(422).json({ error: 'No transcript available for this video. It may have captions disabled.' })
    }

    // Fetch video title + channel from oEmbed (no API key needed)
    let title = 'YouTube Video'
    let channel = 'Unknown'
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`)
      if (oe.ok) {
        const data = await oe.json()
        title   = data.title        || title
        channel = data.author_name  || channel
      }
    } catch {}

    // Join transcript into readable text — preserve sentence flow with spaces
    const text = segments.map(s => s.text.replace(/\n/g, ' ').trim()).join(' ')

    res.json({ videoId, title, channel, text, segmentCount: segments.length })
  } catch (err) {
    console.error('[youtube/transcript]', err)
    const msg = err.message?.includes('disabled') || err.message?.includes('Transcript')
      ? 'No transcript available for this video. Captions may be disabled.'
      : err.message
    res.status(500).json({ error: msg })
  }
}
