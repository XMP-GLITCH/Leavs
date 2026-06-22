import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import LibraryScreen from './screens/LibraryScreen'
import BookDetailScreen from './screens/BookDetailScreen'
import ReaderScreen from './screens/ReaderScreen'
import CoverPickerScreen from './screens/CoverPickerScreen'
import DiscoverScreen from './screens/DiscoverScreen'
import StatsScreen from './screens/StatsScreen'
import ProfileScreen from './screens/ProfileScreen'
import BottomNav from './components/common/BottomNav'

// ── Offline banner ────────────────────────────────────────────────────────────
function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return (
    <div className="offline-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
      </svg>
      <span>You're offline — reading still works</span>
    </div>
  )
}


export default function App() {
  // ── PWA update logic ───────────────────────────────────────────────────────
  // skipWaiting:true means new SWs activate immediately — no "waiting" state,
  // so needRefresh never fires. Instead we listen for controllerchange and reload.
  useRegisterSW()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // When a new SW takes control, reload so the page gets the new JS bundle.
    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Poll for updates: 3 s after load, then every 10 min, and on tab focus.
    async function checkForUpdate() {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        await reg?.update()
      } catch {}
    }
    const t  = setTimeout(checkForUpdate, 3000)
    const iv = setInterval(checkForUpdate, 10 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      clearTimeout(t); clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  // ── Install prompt ────────────────────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    const handler = e => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Expose install handler globally so ProfileScreen can trigger it
  useEffect(() => {
    window.__leavsInstall = installPrompt
      ? async () => {
          installPrompt.prompt()
          const { outcome } = await installPrompt.userChoice
          if (outcome === 'accepted') setInstallPrompt(null)
        }
      : null
  }, [installPrompt])

  return (
    <BrowserRouter>
      <div className="app-shell">
        <OfflineBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/book/:id" element={<BookDetailScreen />} />
          <Route path="/book/:id/read" element={<ReaderScreen />} />
          <Route path="/book/:id/cover" element={<CoverPickerScreen />} />
          <Route path="/discover" element={<DiscoverScreen />} />
          <Route path="/stats" element={<StatsScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
        </Routes>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
