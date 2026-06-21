import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'

const router = Router()
const execFileAsync = promisify(execFile)

router.post('/meta', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      url,
    ])
    const meta = JSON.parse(stdout)

    res.json({
      title:      meta.title,
      uploader:   meta.uploader,
      channel:    meta.channel,
      channelId:  meta.channel_id,
      playlistId: meta.playlist_id,
      duration:   meta.duration,
      thumbnail:  meta.thumbnail,
      url,
    })
  } catch (err) {
    console.error('[YouTube meta]', err.message)
    res.status(500).json({
      error: 'Failed to fetch video metadata',
      hint: 'Make sure yt-dlp is installed and on PATH (pip install yt-dlp)',
    })
  }
})

router.post('/download', async (req, res) => {
  const { url, outputPath = '/tmp/%(id)s.%(ext)s' } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    await execFileAsync('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath,
      '--no-playlist',
      url,
    ])
    res.json({ message: 'Audio extracted', outputPath })
  } catch (err) {
    console.error('[YouTube download]', err.message)
    res.status(500).json({ error: 'Audio extraction failed', detail: err.message })
  }
})

export default router
