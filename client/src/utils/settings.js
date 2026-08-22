import { useState, useEffect, useRef } from 'react'

export const DEFAULTS = {
  fontSize:          18,
  playbackSpeed:     1.0,
  defaultMode:       'read',
  sleepTimerMinutes: 30,
  profileName:       'Reader',
  theme:             'system',
  readerFont:        'serif',
}

// Playfair Display is a DISPLAY face — high stroke contrast, drawn to be seen
// large. At 16-18px its thin strokes thin out and shimmer, which is the wrong
// tool for hours of body text. It stays for headings; the reader gets a choice,
// defaulting to a face actually designed for reading at size.
export const READER_FONTS = {
  serif:   "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  sans:    "'DM Sans', system-ui, -apple-system, sans-serif",
  display: "'Playfair Display', Georgia, serif",
}

const k = key => `leavs.${key}`

export function getSetting(key) {
  try {
    const v = localStorage.getItem(k(key))
    return v !== null ? JSON.parse(v) : DEFAULTS[key]
  } catch { return DEFAULTS[key] }
}

export function setSetting(key, value) {
  localStorage.setItem(k(key), JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('leavs:pref', { detail: { key, value } }))
}

export function useSettings(...keys) {
  // The listener below is registered once, so a plain closure would capture
  // the first render's key list forever. Read through a ref instead.
  const keyRef = useRef(keys)
  keyRef.current = keys
  const [state, setState] = useState(() =>
    Object.fromEntries(keys.map(key => [key, getSetting(key)]))
  )
  useEffect(() => {
    const handler = ({ detail: { key, value } }) => {
      if (keyRef.current.includes(key)) setState(prev => ({ ...prev, [key]: value }))
    }
    window.addEventListener('leavs:pref', handler)
    return () => window.removeEventListener('leavs:pref', handler)
  }, [])
  return [state, setSetting]
}
