const CHUNK_LIMIT = 1400
const PREFETCH_N  = 3

export class EdgeTtsPlayer {
  constructor() {
    this._text     = ''
    this._voice    = 'en-US-JennyNeural'
    this._rate     = 1.0
    this._chunks   = []
    this._cache    = {}        // index → Promise<{ blobUrl, absWords }>
    this._audio    = null      // current HTMLAudioElement
    this._curChunk = 0
    this._charPos  = 0
    this._raf      = null
    this._errCount = 0

    this.isPlaying      = false
    this.onWordBoundary = null
    this.onTimeUpdate   = null
    this.onEnded        = null
    this.onError        = null
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

  play() {
    if (this.isPlaying || !this._text) return
    this.isPlaying = true
    this._prefetch(this._curChunk)
    this._playFrom(this._curChunk)
  }

  pause() {
    if (!this.isPlaying) return
    this._audio?.pause()
    this._stopRaf()
    this.isPlaying = false
  }

  seek(charPos) {
    const ci  = this._chunkAt(charPos)
    const was = this.isPlaying

    // Fast path: seek within currently-playing chunk (no re-fetch)
    if (ci === this._curChunk && this._audio && was) {
      const { charStart, text: chunkText } = this._chunks[ci]
      const localRatio = Math.max(0, (charPos - charStart) / (chunkText.length || 1))
      const dur = this._audio.duration
      if (dur && isFinite(dur)) {
        this._audio.currentTime = localRatio * dur
        this._charPos = charPos
        this.onTimeUpdate?.(charPos, this._text.length)
        return
      }
    }

    // Full chunk switch
    this._audio?.pause()
    this._audio = null
    this._stopRaf()
    this.isPlaying = false
    this._curChunk = ci
    this._charPos  = charPos
    this.onTimeUpdate?.(charPos, this._text.length)
    if (was) {
      this.isPlaying = true
      this._prefetch(ci)
      this._playFrom(ci)
    }
  }

  setRate(rate) {
    this._rate = rate
    if (this._audio) this._audio.playbackRate = rate
  }

  setVoice(voice) {
    const was = this.isPlaying
    const pos = this._charPos
    if (was) this.pause()
    this._voice    = voice
    this._cache    = {}
    this._curChunk = this._chunkAt(pos)
    this._charPos  = pos
    if (was) this.play()
  }

  destroy() {
    this._stop()
  }

  // ── internals ──────────────────────────────────────────────────────────────

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
      console.error('[EdgeTTS] chunk failed', err)
      this._errCount++
      if (this._errCount >= 3) {
        this.isPlaying = false
        this._stopRaf()
        this.onError?.(`Audio error: ${err.message}`)
        return
      }
      this._curChunk = ci + 1
      this._charPos  = this._chunks[ci + 1]?.charStart ?? this._text.length
      this._playFrom(ci + 1)
      return
    }

    if (!this.isPlaying) return

    const { blobUrl, absWords } = result
    const { charStart, text: chunkText } = this._chunks[ci]

    const audio        = new Audio()
    audio.src          = blobUrl
    audio.playbackRate = this._rate
    this._audio        = audio
    this._curChunk     = ci

    audio.onended = () => {
      URL.revokeObjectURL(blobUrl)
      this._audio = null
      this._stopRaf()
      if (!this.isPlaying) return
      this._curChunk++
      this._charPos = this._chunks[this._curChunk]?.charStart ?? this._text.length
      this._playFrom(this._curChunk)
    }

    audio.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      this._audio = null
      this._stopRaf()
      this._errCount++
      if (!this.isPlaying) return
      if (this._errCount >= 3) {
        this.isPlaying = false
        this.onError?.('Audio playback failed')
        return
      }
      this._curChunk++
      this._charPos = this._chunks[this._curChunk]?.charStart ?? this._text.length
      this._playFrom(this._curChunk)
    }

    try {
      await audio.play()
    } catch {
      // Autoplay blocked — user must tap play again
      this.isPlaying = false
      return
    }

    this._startRaf(absWords, charStart, chunkText, audio)
  }

  _startRaf(absWords, chunkStart, chunkText, audio) {
    this._stopRaf()
    let lastWi = -1

    const tick = () => {
      if (!this.isPlaying || this._audio !== audio) return

      const t = audio.currentTime

      // Karaoke word highlight
      let wi = -1
      for (let i = 0; i < absWords.length; i++) {
        if (absWords[i].start <= t) wi = i
        else break
      }
      if (wi >= 0 && wi !== lastWi) {
        lastWi = wi
        this.onWordBoundary?.(absWords[wi].charIdx)
      }

      // Progress bar position
      const dur     = audio.duration || 1
      const ratio   = Math.min(1, t / dur)
      const charPos = chunkStart + Math.round(ratio * chunkText.length)
      this._charPos = charPos
      this.onTimeUpdate?.(charPos, this._text.length)

      this._raf = requestAnimationFrame(tick)
    }

    this._raf = requestAnimationFrame(tick)
  }

  _stopRaf() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
  }

  _stop() {
    this._audio?.pause()
    this._audio = null
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

    const bin    = atob(b64)
    const bytes  = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))

    return { blobUrl, absWords: _mapToChars(wordBoundaries, text, charStart) }
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
    let split = text.lastIndexOf('\n\n', end)
    if (split <= pos) split = text.lastIndexOf(' ', end)
    if (split <= pos) split = end
    else split += (text[split] === '\n' ? 2 : 1)
    chunks.push({ text: text.slice(pos, split), charStart: pos })
    pos = split
  }
  return chunks.filter(c => c.text.trim())
}

function _mapToChars(boundaries, chunkText, chunkStart) {
  let searchPos = 0
  return (boundaries ?? []).map(b => {
    let charIdx
    if (b.textOffset != null) {
      charIdx = b.textOffset + chunkStart
    } else {
      const idx = chunkText.indexOf(b.word, searchPos)
      charIdx   = (idx >= 0 ? idx : searchPos) + chunkStart
      if (idx >= 0) searchPos = idx + b.word.length
    }
    return { word: b.word, start: b.start, charIdx }
  })
}
