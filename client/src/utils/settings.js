import { useState, useEffect } from 'react'

export const DEFAULTS = {
  fontSize:          18,
  playbackSpeed:     1.0,
  defaultMode:       'read',
  sleepTimerMinutes: 30,
  notifGen:          true,
  notifStreak:       false,
  updates:           true,
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
  const [state, setState] = useState(() =>
    Object.fromEntries(keys.map(key => [key, getSetting(key)]))
  )
  useEffect(() => {
    const handler = ({ detail: { key, value } }) => {
      if (keys.includes(key)) setState(prev => ({ ...prev, [key]: value }))
    }
    window.addEventListener('leavs:pref', handler)
    return () => window.removeEventListener('leavs:pref', handler)
  }, [])
  return [state, setSetting]
}
