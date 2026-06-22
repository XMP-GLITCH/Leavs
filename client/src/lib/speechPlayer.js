// SpeechPlayer — wraps the browser's SpeechSynthesis API.
// Same event contract as AudioPlayer so ReaderScreen can swap them seamlessly.
// Uses cancel+restart for pause/seek — more reliable than pause() on iOS Safari.

const CPS_BASE = 12  // estimated chars-per-second at rate 1.0 (≈150 WPM × 5 chars)

export class SpeechPlayer {
  constructor() {
    this._text        = ''
    this._fromChar    = 0     // where the current utterance starts in _text
    this._rate        = 1.0
    this._voiceURI    = null
    this._utter       = null
    this._raf         = null
    this._startAt     = 0
    this._charAtStart = 0

    this.isPlaying      = false
    this.onWordBoundary = null   // (absCharIdx: number) => void
    this.onTimeUpdate   = null   // (charPos: number, total: number) => void
    this.onEnded        = null   // () => void
  }

  load(text, voiceURI = null) {
    this._cancel()
    this._text        = text || ''
    this._fromChar    = 0
    this._voiceURI    = voiceURI
    this.isPlaying    = false
    this._charAtStart = 0
  }

  play() {
    if (this.isPlaying || !this._text) return
    const slice = this._text.slice(this._fromChar)
    if (!slice.trim()) { this.onEnded?.(); return }

    const utter   = new SpeechSynthesisUtterance(slice)
    utter.rate    = this._rate
    utter.lang    = 'en-US'
    if (this._voiceURI) {
      const v = speechSynthesis.getVoices().find(v => v.voiceURI === this._voiceURI)
      if (v) utter.voice = v
    }

    utter.onboundary = e => {
      if (e.name !== 'word') return
      const abs         = this._fromChar + e.charIndex
      this._charAtStart = abs
      this._startAt     = Date.now()
      this.onWordBoundary?.(abs)
      this.onTimeUpdate?.(abs, this._text.length)
    }

    utter.onend = () => {
      if (!this.isPlaying) return
      this.isPlaying = false
      this._fromChar = this._text.length
      this._stopRaf()
      this.onEnded?.()
    }

    utter.onerror = e => {
      if (e.error === 'interrupted' || e.error === 'canceled') return
      this.isPlaying = false
      this._stopRaf()
    }

    this._utter       = utter
    this.isPlaying    = true
    this._startAt     = Date.now()
    this._charAtStart = this._fromChar
    speechSynthesis.speak(utter)
    this._startRaf()
  }

  pause() {
    if (!this.isPlaying) return
    this._fromChar = this._estimated()
    this._cancel()
    this.isPlaying = false
    this._stopRaf()
  }

  seek(charPos) {
    const was  = this.isPlaying
    this._cancel()
    this.isPlaying = false
    this._stopRaf()
    this._fromChar    = Math.max(0, Math.min(Math.round(charPos), this._text.length))
    this._charAtStart = this._fromChar
    this.onTimeUpdate?.(this._fromChar, this._text.length)
    if (was) this.play()
  }

  setRate(rate) {
    this._rate = rate
    if (this.isPlaying) { const p = this._estimated(); this.pause(); this._fromChar = p; this.play() }
  }

  setVoice(voiceURI) {
    this._voiceURI = voiceURI
    if (this.isPlaying) { const p = this._estimated(); this.pause(); this._fromChar = p; this.play() }
  }

  destroy() {
    this._cancel()
    this._stopRaf()
  }

  // ── internals ─────────────────────────────────────────────────────────────

  _estimated() {
    const elapsed = (Date.now() - this._startAt) / 1000
    return Math.min(this._charAtStart + elapsed * CPS_BASE * this._rate, this._text.length)
  }

  _cancel() {
    speechSynthesis.cancel()
    this._utter = null
  }

  _startRaf() {
    const tick = () => {
      this.onTimeUpdate?.(this._estimated(), this._text.length)
      if (this.isPlaying) this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  _stopRaf() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
  }
}

// Return available voices, waiting for them to load if necessary (iOS defers this)
export function getVoices() {
  return new Promise(resolve => {
    const list = speechSynthesis.getVoices()
    if (list.length) { resolve(list); return }
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices())
  })
}
