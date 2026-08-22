import { describe, it, expect } from 'vitest'
import { setPlaying, isPlaying } from './playback'

describe('playback flag', () => {
  it('starts false so the first update check is never blocked', () => {
    expect(isPlaying()).toBe(false)
  })

  it('coerces whatever it is handed to a boolean', () => {
    setPlaying('yes');    expect(isPlaying()).toBe(true)
    setPlaying(0);        expect(isPlaying()).toBe(false)
    setPlaying(undefined); expect(isPlaying()).toBe(false)
    setPlaying(true);     expect(isPlaying()).toBe(true)
    setPlaying(false)
  })
})
