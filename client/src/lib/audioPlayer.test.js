import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AudioPlayer, computeWaveform, findActiveWord, fmtTime } from './audioPlayer'

// A stand-in for HTMLAudioElement. jsdom has no media pipeline, and we need
// precise control over WHICH clock advances — that is the whole point here.
class FakeAudio extends EventTarget {
  constructor() {
    super()
    this.currentTime = 0
    this.duration    = NaN
    this.playbackRate = 1
    this.src = ''
    this.paused = true
  }
  // Let the code assign .onended / .onerror as properties, as it does.
  dispatchEvent(ev) {
    super.dispatchEvent(ev)
    const h = this['on' + ev.type]
    if (typeof h === 'function') h(ev)
    return true
  }
  load() {
    queueMicrotask(() => {
      if (Number.isNaN(this.duration)) this.duration = 100
      this.dispatchEvent(new Event('loadedmetadata'))
    })
  }
  play()  { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  removeAttribute(a) { if (a === 'src') { this.src = ''; this.currentTime = 0 } }

  /** Advance the media clock the way a real element does — fires while hidden. */
  tick(t) { this.currentTime = t; this.dispatchEvent(new Event('timeupdate')) }
}

describe('AudioPlayer', () => {
  let player, audio

  beforeEach(() => {
    globalThis.Audio = FakeAudio
    globalThis.URL.createObjectURL = () => 'blob:fake'
    globalThis.URL.revokeObjectURL = () => {}
    player = new AudioPlayer()
    audio  = player.audio
  })
  afterEach(() => { try { player.destroy() } catch { /* already destroyed */ } })

  const load = (dur) => player.load(new ArrayBuffer(8), 'audio/mpeg', dur)

  describe('duration', () => {
    it('prefers the duration measured at generation time', async () => {
      await load(42)
      audio.duration = 999            // a concatenated MP3 reports nonsense
      expect(player.duration).toBe(42)
    })

    it('uses the element when nothing was stored', async () => {
      await load()
      audio.duration = 123
      expect(player.duration).toBe(123)
    })

    it('ignores a zero, negative or NaN stored duration', async () => {
      for (const bad of [0, -5, NaN, null, undefined]) {
        await player.load(new ArrayBuffer(8), 'audio/mpeg', bad)
        audio.duration = 123
        expect(player.duration).toBe(123)
      }
    })
  })

  describe('position tracking with the screen off', () => {
    // THE regression test. rAF stops when the document is hidden; the media
    // element keeps playing and keeps firing timeupdate. Position must ride
    // the second clock, or a locked phone loses the whole session.
    it('tracks position from timeupdate alone, with no animation frames', async () => {
      await load(600)
      const seen = []
      player.onPosition = t => seen.push(t)
      player.onTimeUpdate = () => {
        throw new Error('position must not depend on the rAF clock')
      }

      audio.tick(10)
      audio.tick(240)
      audio.tick(2400)

      expect(player.lastTime).toBe(2400)
      expect(seen).toEqual([10, 240, 2400])
    })

    it('stamps the final position before destroy tears the element down', async () => {
      await load(600)
      audio.tick(321)
      player.destroy()
      expect(player.lastTime).toBe(321)   // survives for the progress flush
      expect(player.currentTime).toBe(0)  // the element itself is gone
    })

    it('keeps lastTime current across pause and seek', async () => {
      await load(600)
      await player.play()
      audio.currentTime = 55
      player.pause()
      expect(player.lastTime).toBe(55)
      player.seek(120)
      expect(player.lastTime).toBe(120)
    })

    it('resets position between loads so a new chapter starts at zero', async () => {
      await load(600)
      audio.tick(300)
      await load(60)
      expect(player.lastTime).toBe(0)
      expect(player.duration).toBe(60)
    })
  })

  describe('seek', () => {
    it('clamps within the track', async () => {
      await load(100)
      player.seek(500); expect(player.currentTime).toBe(100)
      player.seek(-5);  expect(player.currentTime).toBe(0)
      player.seek(50);  expect(player.currentTime).toBe(50)
    })

    it('does nothing when no source is loaded', () => {
      expect(() => player.seek(10)).not.toThrow()
    })
  })
})

describe('findActiveWord', () => {
  const b = [{ start: 0 }, { start: 1 }, { start: 2.5 }, { start: 9 }]

  it('returns -1 before the first boundary and for empty input', () => {
    expect(findActiveWord(b, -1)).toBe(-1)
    expect(findActiveWord([], 5)).toBe(-1)
    expect(findActiveWord(null, 5)).toBe(-1)
    expect(findActiveWord(undefined, 5)).toBe(-1)
  })

  it('finds the last boundary at or before the time', () => {
    expect(findActiveWord(b, 0)).toBe(0)
    expect(findActiveWord(b, 2.4)).toBe(1)
    expect(findActiveWord(b, 2.5)).toBe(2)
    expect(findActiveWord(b, 1000)).toBe(3)
  })

  it('agrees with a linear scan everywhere (binary search sanity)', () => {
    for (let t = -1; t < 12; t += 0.25) {
      let expected = -1
      b.forEach((x, i) => { if (x.start <= t) expected = i })
      expect(findActiveWord(b, t)).toBe(expected)
    }
  })
})

describe('fmtTime', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(9)).toBe('0:09')
    expect(fmtTime(61)).toBe('1:01')
    expect(fmtTime(3599)).toBe('59:59')
  })

  it('never renders NaN for a missing or infinite duration', () => {
    for (const bad of [NaN, Infinity, undefined, null]) {
      expect(fmtTime(bad)).toBe('0:00')
    }
  })
})

describe('computeWaveform', () => {
  const bufOf = data => ({ getChannelData: () => data })

  it('returns one value per bar, peaking at 1', () => {
    const data = Float32Array.from({ length: 400 }, (_, i) => Math.sin(i / 5))
    const w = computeWaveform(bufOf(data), 40)
    expect(w).toHaveLength(40)
    expect(Math.max(...w)).toBeCloseTo(1, 5)
  })

  it('floors quiet bars so they stay visible', () => {
    const data = Float32Array.from({ length: 400 }, (_, i) => (i < 10 ? 1 : 0))
    expect(Math.min(...computeWaveform(bufOf(data), 40))).toBeGreaterThanOrEqual(0.08)
  })

  it('produces no NaN for pure silence', () => {
    const w = computeWaveform(bufOf(new Float32Array(400)), 40)
    expect(w.every(Number.isFinite)).toBe(true)
  })
})
