// Audio playback via an HTMLAudioElement fed by a Blob URL.
//
// Web Audio (decodeAudioData + AudioBufferSourceNode) is deliberately NOT used
// for playback: mobile browsers suspend AudioContexts when the screen locks or
// the app is backgrounded, and decoding expands the whole file to raw PCM in
// memory (~1.3 GB per hour of audio). An <audio> element keeps playing with
// the screen off, works with lock-screen Media Session controls, and decodes
// incrementally. Web Audio is used only to decode SMALL files for the
// waveform visualisation.
//
// Because playback survives a locked screen, position tracking has to as well
// — and requestAnimationFrame does not: it stops the moment the document is
// hidden. So this class runs two clocks. The native `timeupdate` event (~4Hz,
// fires while hidden) is the source of truth; rAF drives only the per-frame
// karaoke highlight, which nobody can see with the screen off anyway.

const WAVEFORM_DECODE_LIMIT = 6_000_000  // bytes — skip waveform decode above this

export class AudioPlayer {
  constructor() {
    this.audio         = new Audio()
    this.audio.preload = 'auto'
    this.buffer        = null   // decoded AudioBuffer for waveform only (small files)
    this.speed         = 1.0
    this.isPlaying     = false
    this._url          = null
    this._rafId        = null
    // Last known position. Kept fresh by the native `timeupdate` event, which
    // — unlike requestAnimationFrame — KEEPS FIRING WHILE THE DOCUMENT IS
    // HIDDEN. Anything that must stay true with the screen off (saved
    // progress, the sleep timer, listened-time accounting) reads this, never
    // the rAF loop.
    this.lastTime        = 0
    this._storedDuration = null

    // Two clocks, deliberately:
    //   onPosition   ~4Hz, fires while hidden — correctness
    //   onTimeUpdate per frame, visible only  — karaoke highlight
    this.onPosition   = null    // (currentTime, duration) => void
    this.onTimeUpdate = null    // (currentTime, duration) => void
    this.onEnded      = null    // () => void

    this.audio.addEventListener('timeupdate', () => {
      this.lastTime = this.audio.currentTime || 0
      this.onPosition?.(this.lastTime, this.duration)
    })

    this.audio.onended = () => {
      this.isPlaying = false
      this.lastTime  = this.duration
      this._stopRaf()
      this.onEnded?.()
    }
  }

  /**
   * @param storedDuration duration measured when the audio was generated.
   *   Generated chapters are a concatenation of MP3 chunks and carry no valid
   *   duration header, so the element's own guess can be badly wrong.
   */
  async load(arrayBuffer, mime = 'audio/mpeg', storedDuration = null) {
    this._stopRaf()
    this.audio.pause()
    this.isPlaying = false
    this.lastTime  = 0
    this._storedDuration =
      Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration : null
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null }

    this._url = URL.createObjectURL(new Blob([arrayBuffer], { type: mime || 'audio/mpeg' }))
    this.audio.src          = this._url
    this.audio.playbackRate = this.speed

    await new Promise((resolve, reject) => {
      const ok      = () => { cleanup(); resolve() }
      const fail    = () => { cleanup(); reject(new Error('This audio format is not supported on this device')) }
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', ok)
        this.audio.removeEventListener('error', fail)
      }
      this.audio.addEventListener('loadedmetadata', ok)
      this.audio.addEventListener('error', fail)
      this.audio.load()
    })

    // Decode a copy for the waveform only when the file is small — large files
    // would expand to hundreds of MB of PCM and crash mobile tabs.
    this.buffer = null
    if (arrayBuffer.byteLength < WAVEFORM_DECODE_LIMIT) {
      try {
        const ctx   = new AudioContext()
        this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
        ctx.close().catch(() => {})
      } catch { this.buffer = null }
    }
  }

  get currentTime() { return this.audio.currentTime || 0 }

  get duration() {
    // Prefer the duration measured at generation time. See load().
    if (this._storedDuration) return this._storedDuration
    const d = this.audio.duration
    return isFinite(d) ? d : 0
  }

  async play() {
    if (!this.audio.src || this.isPlaying) return
    this.audio.playbackRate = this.speed
    await this.audio.play()
    this.isPlaying = true
    this._startRaf()
  }

  pause() {
    if (!this.isPlaying) return
    this.audio.pause()
    this.isPlaying = false
    this.lastTime  = this.audio.currentTime || 0
    this._stopRaf()
    this.onTimeUpdate?.(this.currentTime, this.duration)
  }

  seek(seconds) {
    if (!this.audio.src) return
    const max = this.duration || seconds
    this.audio.currentTime = Math.max(0, Math.min(seconds, max))
    this.lastTime = this.audio.currentTime || 0
    if (!this.isPlaying) this.onTimeUpdate?.(this.currentTime, this.duration)
  }

  setSpeed(rate) {
    this.speed = rate
    this.audio.playbackRate = rate
  }

  _startRaf() {
    const tick = () => {
      this.onTimeUpdate?.(this.currentTime, this.duration)
      if (this.isPlaying) this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  _stopRaf() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null }
  }

  destroy() {
    // Stamp the final position BEFORE tearing the element down. React cleans
    // effects up in the order they were defined, so the reader's progress
    // flush runs after this one — reading currentTime off a dead element then
    // would save a 0 and restart the book on next open.
    this.lastTime = this.audio.currentTime || this.lastTime
    this._stopRaf()
    this.audio.pause()
    this.audio.removeAttribute('src')
    try { this.audio.load() } catch {}
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null }
    this.buffer = null
  }
}

// Compute normalised RMS amplitudes for waveform visualisation
export function computeWaveform(audioBuffer, bars = 40) {
  const ch    = audioBuffer.getChannelData(0)
  const block = Math.max(1, Math.floor(ch.length / bars))
  const raw   = Array.from({ length: bars }, (_, i) => {
    let sum = 0
    for (let j = 0; j < block; j++) sum += ch[i * block + j] ** 2
    return Math.sqrt(sum / block)
  })
  const max = Math.max(...raw, 1e-6)
  return raw.map(v => Math.max(0.08, v / max))
}

// Binary-search word boundaries for the active word at currentTime
export function findActiveWord(boundaries, currentTime) {
  if (!boundaries?.length) return -1
  let result = -1, lo = 0, hi = boundaries.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (boundaries[mid].start <= currentTime) { result = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return result
}

export function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}
