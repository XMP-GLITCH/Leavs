import { Router } from 'express'

const router = Router()

const VOICES = [
  { id: 'en-US-JennyNeural',   name: 'Jenny',   accent: 'American',   gender: 'Female' },
  { id: 'en-US-GuyNeural',     name: 'Guy',     accent: 'American',   gender: 'Male'   },
  { id: 'en-GB-SoniaNeural',   name: 'Sonia',   accent: 'British',    gender: 'Female' },
  { id: 'en-GB-RyanNeural',    name: 'Ryan',    accent: 'British',    gender: 'Male'   },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', accent: 'Australian', gender: 'Female' },
  { id: 'en-AU-WilliamNeural', name: 'William', accent: 'Australian', gender: 'Male'   },
  { id: 'en-IE-EmilyNeural',   name: 'Emily',   accent: 'Irish',      gender: 'Female' },
]

router.get('/voices', (_req, res) => res.json({ voices: VOICES }))

router.post('/generate', async (req, res) => {
  const { text, voice = 'en-US-JennyNeural', chapterId, bookId } = req.body

  if (!text)                             return res.status(400).json({ error: 'text is required' })
  if (!bookId || chapterId === undefined) return res.status(400).json({ error: 'bookId and chapterId are required' })

  try {
    const { default: EdgeTTS } = await import('edge-tts-universal')

    const tts = new EdgeTTS(text, voice)
    const { audio, subtitle } = await tts.synthesize()

    // audio is a Blob — convert to base64 for JSON transport
    const arrayBuffer = await audio.arrayBuffer()
    const audioBase64  = Buffer.from(arrayBuffer).toString('base64')

    // subtitle: WordBoundary[] — offset/duration in 100-nanosecond units → convert to seconds
    const wordBoundaries = (subtitle || [])
      .filter(wb => wb.text)
      .map(wb => ({
        word:     wb.text,
        start:    wb.offset   / 1e7,
        duration: wb.duration / 1e7,
      }))

    res.json({ audio: audioBase64, wordBoundaries, chapterId, bookId })
  } catch (err) {
    console.error('[TTS]', err)
    res.status(500).json({ error: 'TTS generation failed', detail: err.message })
  }
})

export default router
