import { useSyncExternalStore } from 'react'

// `beforeinstallprompt` fires once, early — usually before ProfileScreen has
// ever mounted. The event has to be captured at the app root and kept.
//
// It used to be stashed on `window.__leavsInstall` and read during Profile's
// render. Assigning to a global triggers no re-render, so the Install row
// appeared only if something else happened to re-render Profile: it worked by
// accident or not at all. This is the same idea with a subscription, so React
// actually hears about it.

let deferred = null
const listeners = new Set()
const emit = () => listeners.forEach(l => l())

export function captureInstallPrompt(e) {
  deferred = e
  emit()
}

const subscribe = cb => { listeners.add(cb); return () => listeners.delete(cb) }
const snapshot  = () => deferred !== null

export function useCanInstall() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

export async function promptInstall() {
  if (!deferred) return false
  deferred.prompt()
  const { outcome } = await deferred.userChoice
  // The event is single-use: once answered it cannot be shown again.
  deferred = null
  emit()
  return outcome === 'accepted'
}
