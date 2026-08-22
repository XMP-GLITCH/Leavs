import { describe, it, expect, beforeEach } from 'vitest'
import { getSetting, setSetting, DEFAULTS } from './settings'

beforeEach(() => localStorage.clear())

describe('settings', () => {
  it('returns the declared default when nothing is stored', () => {
    expect(getSetting('fontSize')).toBe(DEFAULTS.fontSize)
    expect(getSetting('defaultMode')).toBe('read')
  })

  it('round-trips a value', () => {
    setSetting('fontSize', 22)
    expect(getSetting('fontSize')).toBe(22)
  })

  it('preserves a falsy stored value rather than falling back', () => {
    setSetting('playbackSpeed', 0)
    expect(getSetting('playbackSpeed')).toBe(0)
  })

  it('falls back to the default when storage holds corrupt JSON', () => {
    localStorage.setItem('leavs.fontSize', '{not json')
    expect(getSetting('fontSize')).toBe(DEFAULTS.fontSize)
  })

  it('namespaces keys under leavs.', () => {
    setSetting('profileName', 'Ada')
    expect(localStorage.getItem('leavs.profileName')).toBe('"Ada"')
  })

  it('announces a change so other components can follow it', () => {
    let seen = null
    const h = e => { seen = e.detail }
    window.addEventListener('leavs:pref', h)
    setSetting('fontSize', 20)
    window.removeEventListener('leavs:pref', h)
    expect(seen).toEqual({ key: 'fontSize', value: 20 })
  })
})
