import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyTheme, THEMES } from './theme'

const setSystemDark = matches => {
  window.matchMedia = vi.fn(() => ({
    matches, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#2D4A2D">'
  setSystemDark(false)
})

const attr = () => document.documentElement.getAttribute('data-theme')
const themeColor = () => document.querySelector('meta[name="theme-color"]').getAttribute('content')

describe('applyTheme', () => {
  it('offers exactly the themes tokens.css defines, plus system', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark', 'sepia'])
  })

  // Light is the bare :root palette — setting an attribute for it would mean
  // maintaining a duplicate of every token.
  it('carries no attribute for light', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('sets the attribute for dark and sepia', () => {
    applyTheme('dark');  expect(attr()).toBe('dark')
    applyTheme('sepia'); expect(attr()).toBe('sepia')
  })

  it('resolves system against the OS preference', () => {
    setSystemDark(true)
    applyTheme('system')
    expect(attr()).toBe('dark')

    setSystemDark(false)
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('keeps the address-bar colour in step', () => {
    applyTheme('dark')
    expect(themeColor()).toBe('#0F1A0F')
    applyTheme('light')
    expect(themeColor()).toBe('#2D4A2D')
  })

  it('reads the stored preference when called with no argument', () => {
    localStorage.setItem('leavs.theme', '"sepia"')
    applyTheme()
    expect(attr()).toBe('sepia')
  })

  it('does not throw when matchMedia is unavailable', () => {
    window.matchMedia = undefined
    expect(() => applyTheme('system')).not.toThrow()
  })
})
