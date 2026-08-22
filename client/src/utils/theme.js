import { useEffect } from 'react'
import { getSetting } from './settings'

// tokens.css has carried complete [data-theme="dark"] and [data-theme="sepia"]
// palettes since the first commit. Nothing ever set the attribute, so neither
// theme was reachable. This is the missing half.

export const THEMES = ['system', 'light', 'dark', 'sepia']

const prefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

function resolve(theme) {
  return theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme
}

export function applyTheme(theme = getSetting('theme')) {
  const resolved = resolve(theme)
  const root = document.documentElement
  // Light is the bare :root palette, so it carries no attribute.
  if (resolved === 'light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', resolved)

  // Keep the address bar in step with the page.
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#0F1A0F' : '#2D4A2D')
}

export function useTheme() {
  useEffect(() => {
    applyTheme()

    const onPref = ({ detail }) => { if (detail?.key === 'theme') applyTheme(detail.value) }
    window.addEventListener('leavs:pref', onPref)

    // Keep following the OS for as long as the preference says 'system'.
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onSystem = () => { if (getSetting('theme') === 'system') applyTheme('system') }
    mq?.addEventListener?.('change', onSystem)

    return () => {
      window.removeEventListener('leavs:pref', onPref)
      mq?.removeEventListener?.('change', onSystem)
    }
  }, [])
}
