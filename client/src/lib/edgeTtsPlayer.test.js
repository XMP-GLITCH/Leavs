import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EdgeTtsPlayer, splitTtsChunks } from './edgeTtsPlayer'

const LIMIT = 1400

describe('splitTtsChunks', () => {
  it('returns a single chunk for short text', () => {
    expect(splitTtsChunks('Hello world.')).toEqual([{ text: 'Hello world.', charStart: 0 }])
  })

  it('never exceeds the synthesis limit', () => {
    for (const c of splitTtsChunks('word '.repeat(2000))) {
      expect(c.text.length).toBeLessThanOrEqual(LIMIT)
    }
  })

  // charStart is what maps audio position back to a place in the chapter, so
  // it has to index the chunk back out of the source exactly.
  it('gives every chunk a charStart that indexes it back into the source', () => {
    const text = 'Lorem ipsum dolor sit amet. '.repeat(300)
    for (const c of splitTtsChunks(text)) {
      expect(text.slice(c.charStart, c.charStart + c.text.length)).toBe(c.text)
    }
  })

  it('prefers a paragraph break over a mid-sentence word break', () => {
    const a = 'a'.repeat(1000)
    const b = 'b'.repeat(600)
    const chunks = splitTtsChunks(`${a}\n\n${b}`)
    expect(chunks[0].text.trimEnd()).toBe(a)
    expect(chunks[1].text).toBe(b)
  })

  it('drops whitespace-only and empty input', () => {
    expect(splitTtsChunks('   \n\n   ')).toHaveLength(0)
    expect(splitTtsChunks('')).toHaveLength(0)
  })

  it('still terminates on text containing no break opportunities', () => {
    const chunks = splitTtsChunks('x'.repeat(5000))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.reduce((n, c) => n + c.text.length, 0)).toBe(5000)
  })
})

describe('EdgeTtsPlayer chunk cache', () => {
  let fetched, revoked, audios, voices

  const settle = () => new Promise(r => setTimeout(r, 25))

  beforeEach(() => {
    fetched = []
    voices  = []
    revoked = []
    audios  = []

    globalThis.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body)
      fetched.push(body.text)
      voices.push(body.voice)
      return { ok: true, json: async () => ({ audio: btoa('fake-mp3'), wordBoundaries: [] }) }
    })

    let n = 0
    globalThis.URL.createObjectURL = () => `blob:${n++}`
    globalThis.URL.revokeObjectURL = u => revoked.push(u)

    globalThis.Audio = class extends EventTarget {
      constructor() { super(); this.currentTime = 0; this.duration = 10; this.src = ''; audios.push(this) }
      play()  { return Promise.resolve() }
      pause() {}
    }
  })

  // The regression. Revoking the blob URL used to leave the resolved promise
  // in the cache, so seeking back replayed a dead URL: onerror fired, playback
  // skipped FORWARD instead of back, and three of those killed the session.
  it('drops a finished chunk from the cache when it revokes its URL', async () => {
    const p = new EdgeTtsPlayer()
    p.load('A'.repeat(LIMIT) + ' ' + 'B'.repeat(600))
    expect(p._chunks).toHaveLength(2)

    p.play()
    await settle()
    expect(p._cache[0]).toBeDefined()

    const chunkAudio = audios.filter(a => a.src)[0]
    chunkAudio.onended()
    await settle()

    expect(revoked.length).toBeGreaterThan(0)
    expect(p._cache[0]).toBeUndefined()   // released together, not orphaned
    p.destroy()
  })

  it('refetches a released chunk when you seek back into it', async () => {
    const p = new EdgeTtsPlayer()
    p.load('A'.repeat(LIMIT) + ' ' + 'B'.repeat(600))

    p.play()
    await settle()

    audios.filter(a => a.src)[0].onended()
    await settle()

    const before = fetched.filter(t => t.startsWith('A')).length
    p.seek(0)
    await settle()

    expect(fetched.filter(t => t.startsWith('A')).length).toBeGreaterThan(before)
    p.destroy()
  })

  it('releases everything on destroy, leaving no live blob URLs', async () => {
    const p = new EdgeTtsPlayer()
    p.load('A'.repeat(LIMIT) + ' ' + 'B'.repeat(600))
    p.play()
    await settle()

    const created = fetched.length
    p.destroy()
    await settle()

    expect(created).toBeGreaterThan(0)
    expect(Object.keys(p._cache)).toHaveLength(0)
  })

  // setVoice clears the cache and then, if it was playing, immediately
  // re-prefetches — so the cache is NOT empty afterwards. What matters is that
  // the refill went out under the new voice.
  it('resynthesises under the new voice when the voice changes', async () => {
    const p = new EdgeTtsPlayer()
    p.load('A'.repeat(LIMIT) + ' ' + 'B'.repeat(600))
    p.play()
    await settle()
    expect(voices.every(v => v === 'en-US-JennyNeural')).toBe(true)

    p.setVoice('en-GB-RyanNeural')
    await settle()
    expect(voices).toContain('en-GB-RyanNeural')
    p.destroy()
  })

  it('leaves the cache empty when the voice changes while paused', async () => {
    const p = new EdgeTtsPlayer()
    p.load('A'.repeat(LIMIT) + ' ' + 'B'.repeat(600))
    p.play()
    await settle()
    p.pause()

    p.setVoice('en-GB-RyanNeural')
    expect(Object.keys(p._cache)).toHaveLength(0)
    p.destroy()
  })
})
