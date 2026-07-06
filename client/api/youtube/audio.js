export const config = { maxDuration: 300 }

const MAX_DURATION_S = 10800  // 3 hours

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

  const { url: rawUrl, info: infoOnly } = req.query
  if (!rawUrl) return res.status(400).json({ error: 'url required' })

  const videoId = extractVideoId(rawUrl)
  if (!videoId) return res.status(400).json({ error: 'Could not extract video ID from URL' })

  try {
    const ytdl       = (await import('@distube/ytdl-core')).default
    const videoInfo  = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`)
    const { title, author, lengthSeconds } = videoInfo.videoDetails
    const durationS  = Number(lengthSeconds)

    // ── Info-only mode (used by the client to show a preview before downloading) ──
    if (infoOnly === '1') {
      return res.json({ videoId, title, channel: author, durationSeconds: durationS })
    }

    if (durationS > MAX_DURATION_S) {
      return res.status(413).json({
        error: `Video is ${Math.round(durationS / 3600)} hours — too long. Import a single chapter/clip instead.`,
      })
    }

    const format = ytdl.chooseFormat(videoInfo.formats, {
      quality: 'lowestaudio',
      filter:  'audioonly',
    })
    if (!format) throw new Error('No audio-only stream available for this video')

    const mime = (format.mimeType || 'audio/webm').split(';')[0]
    res.setHeader('Content-Type', mime)
    res.setHeader('X-Video-Title',    encodeURIComponent(title))
    res.setHeader('X-Video-Channel',  encodeURIComponent(author))
    res.setHeader('X-Video-Duration', String(durationS))
    if (format.contentLength) res.setHeader('Content-Length', format.contentLength)

    const stream = ytdl.downloadFromInfo(videoInfo, { format })
    stream.on('error', err => console.error('[youtube/audio] stream error:', err))
    stream.pipe(res)
  } catch (err) {
    console.error('[youtube/audio]', err)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
}
