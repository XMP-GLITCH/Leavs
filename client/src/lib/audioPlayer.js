// Wraps Web Audio API for playback with speed control and time callbacks

export class AudioPlayer {
  constructor() {
    this.ctx         = null
    this.source      = null
    this.buffer      = null
    this.startTime   = 0      // ctx.currentTime when play() was last called
    this.pauseOffset = 0      // seconds into buffer when paused
    this.isPlaying   = false
    this.speed       = 1.0
    this._rafId      = null

    this.onTimeUpdate = null  // (currentTime, duration) => void
    this.onEnded      = null  // () => void
  }

  _ctx() {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext()
    return this.ctx
  }

  async load(arrayBuffer) {
    const ctx = this._ctx()
    // ArrayBuffer must be copied — decodeAudioData detaches it
    this.buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    this._stopSource()
    this.pauseOffset = 0
    this.isPlaying   = false
    this._stopRaf()
  }

  get currentTime() {
    if (!this.buffer) return 0
    if (this.isPlaying) {
      const elapsed = (this._ctx().currentTime - this.startTime) * this.speed
      return Math.min(this.pauseOffset + elapsed, this.buffer.duration)
    }
    return this.pauseOffset
  }

  get duration() { return this.buffer?.duration ?? 0 }

  play() {
    if (!this.buffer || this.isPlaying) return
    const ctx = this._ctx()
    if (ctx.state === 'suspended') ctx.resume()

    this.source                    = ctx.createBufferSource()
    this.source.buffer             = this.buffer
    this.source.playbackRate.value = this.speed
    this.source.connect(ctx.destination)
    this.source.onended = () => {
      if (!this.isPlaying) return  // manual stop — ignore
      this.isPlaying   = false
      this.pauseOffset = 0
      this._stopRaf()
      this.onEnded?.()
    }

    this.startTime = ctx.currentTime
    this.source.start(0, this.pauseOffset)
    this.isPlaying = true
    this._startRaf()
  }

  pause() {
    if (!this.isPlaying) return
    this.pauseOffset = this.currentTime
    this._stopSource()
    this.isPlaying = false
    this._stopRaf()
    this.onTimeUpdate?.(this.pauseOffset, this.duration)
  }

  seek(seconds) {
    const was = this.isPlaying
    if (was) this.pause()
    this.pauseOffset = Math.max(0, Math.min(seconds, this.duration))
    if (was) this.play()
    else this.onTimeUpdate?.(this.pauseOffset, this.duration)
  }

  setSpeed(rate) {
    const offset = this.currentTime
    const was    = this.isPlaying
    if (was) this.pause()
    this.speed       = rate
    this.pauseOffset = offset
    if (was) this.play()
  }

  _stopSource() {
    if (this.source) {
      try { this.source.stop() } catch {}
      this.source.disconnect()
      this.source = null
    }
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
    this._stopSource()
    this._stopRaf()
    this.ctx?.close()
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
