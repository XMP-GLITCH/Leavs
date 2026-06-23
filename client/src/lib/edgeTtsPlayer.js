// EdgeTtsPlayer — chunk-based audiobook reader using Microsoft Edge neural voices.
// Splits chapter text into paragraphs, fetches each from /api/tts/chunk, and plays
// them in sequence using Web Audio API. Fires karaoke word-boundary events.

const CHUNK_LIMIT  = 1400  // max chars per API request (keeps response well under 4 MB)
const PREFETCH_N   = 3     // how many chunks to prefetch ahead

export class EdgeTtsPlayer {
  constructor() {
    this._text      = ''
    this._voice     = 'en-US-JennyNeural'
    this._rate      = 1.0
    this._chunks      = []       // { text, charStart }[]
    this._cache       = {}       // chunk index → Promise<{ buffer: AudioBuffer, absWords }>
    this._ctx         = null
    this._src         = null     // current AudioBufferSourceNode
    this._curChunk    = 0
    this._charPos     = 0
    this._startedAt   = 0        // AudioContext.currentTime when current chunk started
    this._raf         = null
    this._errCount    = 0        // consecutive fetch failures

    this.isPlaying      = false
    this.onWordBoundary = null   // (absCharIdx: number) => void
    this.onTimeUpdate   = null   // (charPos: number, total: number) => void
    this.onEnded        = null   // () => void
    this.onError        = null   // (message: string) => void
  }

  load(text, voice = null) {
    this._stop()
    this._text     = text || ''
    this._voice    = voice || 'en-US-JennyNeural'
    this._chunks   = _splitChunks(this._text)
    this._cache    = {}
    this._curChunk = 0
    this._charPos  = 0
    this.isPlaying = false
  }

  async play() {
    if (this.isPlaying || !this._text) return
    await this._getCtx().resume()
    this.isPlaying = true
    this._prefetch(this._curChunk)
    this._playFrom(this._curChunk)
  }

  pause() {
    if (!this.isPlaying) return
    try { this._src?.stop() } catch {}
    this._src = null
    this._stopRaf()
    this.isPlaying = false
  }

  seek(charPos) {
    const was = this.isPlaying
    this.pause()
    const ci = this._chunkAt(charPos)
    this._curChunk = ci
    this._charPos  = charPos
    this.onTimeUpdate?.(charPos, this._text.length)
    if (was) this.play()
  }

  setRate(rate) {
    const was = this.isPlaying
    if (was) {
      const pos = this._charPos
      this.pause()
      this._charPos  = pos
      this._curChunk = this._chunkAt(pos)
    }
    this._rate = rate
    if (this._src) this._src.playbackRate.value = rate
    if (was) this.play()
  }

  setVoice(voice) {
    const was = this.isPlaying
    const pos = this._charPos
    if (was) this.pause()
    this._voice    = voice
    this._cache    = {}   // invalidate cached audio — new voice needed
    this._curChunk = this._chunkAt(pos)
    this._charPos  = pos
    if (was) this.play()
  }

  destroy() {
    this._stop()
    this._ctx?.close().catch(() => {})
    this._ctx = null
  }

  // ── internals ──────────────────────────────────────────────────────────────

  _getCtx() {
    if (!this._ctx) this._ctx = new AudioContext()
    return this._ctx
  }

  _chunkAt(charPos) {
    let ci = 0
    for (let i = 0; i < this._chunks.length; i++) {
      if (this._chunks[i].charStart <= charPos) ci = i
      else break
    }
    return ci
  }

  _prefetch(fromChunk) {
    for (let i = fromChunk; i < Math.min(fromChunk + PREFETCH_N, this._chunks.length); i++) {
      if (!this._cache[i]) this._cache[i] = this._fetchChunk(i)
    }
  }

  async _playFrom(ci) {
    if (!this.isPlaying || ci >= this._chunks.length) {
      if (ci >= this._chunks.length) {
        this.isPlaying = false
        this._stopRaf()
        this.onEnded?.()
      }
      return
    }

    this._prefetch(ci + 1)

    let result
    try {
      result = await this._cache[ci]
      this._errCount = 0
    } catch (err) {
      console.error('[EdgeTTS] chunk load failed', err)
      this._errCount++
      if (this._errCount >= 3) {
        this.isPlaying = false
        this._stopRaf()
        this.onError?.(`Audio failed to load: ${err.message}`)
        return
      }
      this._curChunk = ci + 1
      this._charPos  = this._chunks[ci + 1]?.charStart ?? this._text.length
      this._playFrom(ci + 1)
      return
    }

    if (!this.isPlaying) return   // paused while loading

    const { buffer, absWords } = result
    const ctx        = this._getCtx()
    const chunkStart = this._chunks[ci].charStart
    const chunkText  = this._chunks[ci].text

    const src              = ctx.createBufferSource()
    src.buffer             = buffer
    src.playbackRate.value = this._rate
    src.connect(ctx.destination)
    this._src        = src
    this._startedAt  = ctx.currentTime
    this._curChunk   = ci

    src.onended = () => {
      if (!this.isPlaying) return
      this._src = null
      this._curChunk++
      this._charPos = this._chunks[this._curChunk]?.charStart ?? this._text.length
      this._playFrom(this._curChunk)
    }

    src.start()
    this._startRaf(absWords, chunkStart, chunkText, buffer.duration)
  }

  _startRaf(absWords, chunkStart, chunkText, bufDuration) {
    this._stopRaf()

    let lastWordIdx = -1

    const tick = () => {
      if (!this.isPlaying || !this._src) return

      const ctx          = this._getCtx()
      const wallElapsed  = ctx.currentTime - this._startedAt
      const audioElapsed = wallElapsed * this._rate   // how far through audio we are

      // Karaoke: find current word
      let wi = -1
      for (let i = 0; i < absWords.length; i++) {
        if (absWords[i].start <= audioElapsed) wi = i
        else break
      }
      if (wi >= 0 && wi !== lastWordIdx) {
        lastWordIdx = wi
        this.onWordBoundary?.(absWords[wi].charIdx)
      }

      // Progress: estimate char position within chunk
      const ratio    = Math.min(1, bufDuration > 0 ? audioElapsed / bufDuration : 0)
      const charPos  = chunkStart + Math.round(ratio * chunkText.length)
      this._charPos  = charPos
      this.onTimeUpdate?.(charPos, this._text.length)

      this._raf = requestAnimationFrame(tick)
    }

    this._raf = requestAnimationFrame(tick)
  }

  _stopRaf() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
  }

  _stop() {
    try { this._src?.stop() } catch {}
    this._src = null
    this._stopRaf()
    this.isPlaying = false
  }

  async _fetchChunk(ci) {
    const { text, charStart } = this._chunks[ci]

    const res = await fetch('/api/tts/chunk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, voice: this._voice }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }

    const { audio: b64, wordBoundaries } = await res.json()

    // Decode base64 MP3 → ArrayBuffer
    const bin    = atob(b64)
    const bytes  = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    const ctx    = this._getCtx()
    const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0))

    // Map word boundaries to absolute char indices
    const absWords = _mapToChars(wordBoundaries, text, charStart)
    return { buffer, absWords }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────

function _splitChunks(text) {
  const chunks = []
  let pos = 0
  while (pos < text.length) {
    const end = pos + CHUNK_LIMIT
    if (end >= text.length) {
      chunks.push({ text: text.slice(pos), charStart: pos })
      break
    }
    // Split at last paragraph break before the limit
    let split = text.lastIndexOf('\n\n', end)
    if (split <= pos) split = text.lastIndexOf(' ', end)
    if (split <= pos) split = end
    else split += (text[split] === '\n' ? 2 : 1)
    chunks.push({ text: text.slice(pos, split), charStart: pos })
    pos = split
  }
  return chunks.filter(c => c.text.trim())
}

// Map word boundaries (with audio timing) to absolute char indices in chapter.text.
// Edge TTS may include textOffset; if not, we match each word in order.
function _mapToChars(boundaries, chunkText, chunkStart) {
  let searchPos = 0
  return (boundaries ?? []).map(b => {
    let charIdx
    if (b.textOffset != null) {
      charIdx = b.textOffset + chunkStart
    } else {
      // Walk through text finding each word in order (handles repeated words correctly)
      const idx = chunkText.indexOf(b.word, searchPos)
      charIdx   = (idx >= 0 ? idx : searchPos) + chunkStart
      if (idx >= 0) searchPos = idx + b.word.length
    }
    return { word: b.word, start: b.start, charIdx }
  })
}
