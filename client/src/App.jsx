import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isPlaying } from './utils/playback'
import { captureInstallPrompt } from './utils/install'
import { useTheme } from './utils/theme'
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

// ── Stale-install banner ────────────────────────────────────────────────────────
// Every Vercel deploy also gets a frozen, deployment-specific hostname
// (leavs-client-<hash>-<team>.vercel.app). A PWA installed from one of those is
// pinned to that immutable build forever — "Check for updates" can never find a
// newer version because that origin never changes. Detect it and tell the user
// exactly how to escape: reinstall from the canonical URL.
const CANONICAL_HOST = 'leavs-client.vercel.app'

function StaleInstallBanner() {
  const [dismissed, setDismissed] = useState(false)
  const host = window.location.hostname
  // Only Vercel hosts other than the canonical one are frozen. localhost, LAN
  // IPs, and a future custom domain won't match and are left alone.
  const onFrozenHost = host.endsWith('.vercel.app') && host !== CANONICAL_HOST
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true

  if (!onFrozenHost || dismissed) return null

  return (
    <div className="offline-banner" style={{ background: '#8A5A1A', gap: 10 }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      <span style={{ flex: 1, lineHeight: 1.35 }}>
        {standalone
          ? 'This install is pinned to an old build and can’t update. Reinstall from the main address:'
          : 'This is a preview build that won’t receive updates. Open the app at:'}
        {' '}
        <a
          href={`https://${CANONICAL_HOST}/`}
          style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}
        >
          {CANONICAL_HOST}
        </a>
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'currentColor', cursor: 'pointer', padding: 4, flexShrink: 0 }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}


export default function App() {
  useTheme()

  // autoUpdate mode: vite-plugin-pwa handles skipWaiting + reload automatically.
  // No manual controllerchange listener needed — adding one causes double-reloads.
  useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      // Check every 30 minutes (not on every tab focus), and never mid-playback:
      // autoUpdate reloads the page as soon as a new worker activates, which
      // would cut a listening session off in the middle of a sentence.
      setInterval(() => { if (!isPlaying()) r?.update() }, 30 * 60 * 1000)
    },
  })

  // ── Install prompt ────────────────────────────────────────────────────────
  // Captured here because the event fires early, at the root, once. Screens
  // subscribe via useCanInstall() — see utils/install.js for why this is not
  // a global.
  useEffect(() => {
    const handler = e => { e.preventDefault(); captureInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  return (
    <BrowserRouter>
      <div className="app-shell">
        <OfflineBanner />
        <StaleInstallBanner />
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
