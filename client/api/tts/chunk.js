export const config = { maxDuration: 60 }

const VALID_VOICES = new Set([
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-AU-NatashaNeural',
  'en-AU-WilliamNeural',
  'en-IE-EmilyNeural',
])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, voice = 'en-US-JennyNeural' } = req.body || {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  const safeVoice = VALID_VOICES.has(voice) ? voice : 'en-US-JennyNeural'

  try {
    const { EdgeTTS } = await import('edge-tts-universal')

    const tts                  = new EdgeTTS(text, safeVoice)
    const { audio, subtitle }  = await tts.synthesize()

    const buf        = Buffer.from(await audio.arrayBuffer())
    const audioB64   = buf.toString('base64')

    // subtitle: array of word boundary events from Microsoft Edge TTS
    // Each entry has: text (word), offset (100ns audio time), duration (100ns), textOffset (char index)
    const wordBoundaries = (subtitle ?? [])
      .filter(s => s?.text)
      .map(s => ({
        word:      s.text,
        start:     (s.offset   ?? 0) / 1e7,   // seconds into the audio
        duration:  (s.duration ?? 0) / 1e7,
        textOffset: s.textOffset ?? s.charOffset ?? null,  // char index in chunk text (may be null)
      }))

    res.json({ audio: audioB64, wordBoundaries })
  } catch (err) {
    console.error('[TTS chunk]', err)
    res.status(500).json({ error: err.message })
  }
}
