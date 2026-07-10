// Audio playback via an HTMLAudioElement fed by a Blob URL.
//
// Web Audio (decodeAudioData + AudioBufferSourceNode) is deliberately NOT used
// for playback: mobile browsers suspend AudioContexts when the screen locks or
// the app is backgrounded, and decoding expands the whole file to raw PCM in
// memory (~1.3 GB per hour of audio). An <audio> element keeps playing with
// the screen off, works with lock-screen Media Session controls, and decodes
// incrementally. Web Audio is used only to decode SMALL files for the
// waveform visualisation.

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

    this.onTimeUpdate = null    // (currentTime, duration) => void
    this.onEnded      = null    // () => void

    this.audio.onended = () => {
      this.isPlaying = false
      this._stopRaf()
      this.onEnded?.()
    }
  }

  async load(arrayBuffer, mime = 'audio/mpeg') {
    this._stopRaf()
    this.audio.pause()
    this.isPlaying = false
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
    this._stopRaf()
    this.onTimeUpdate?.(this.currentTime, this.duration)
  }

  seek(seconds) {
    if (!this.audio.src) return
    const max = this.duration || seconds
    this.audio.currentTime = Math.max(0, Math.min(seconds, max))
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
