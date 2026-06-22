import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useEffect } from 'react'
import { db } from '../db/db'
import { useSettings, setSetting } from '../utils/settings'

const SPEED_OPTS  = [0.75, 1.0, 1.25, 1.5, 2.0]
const FONT_OPTS   = [14, 16, 18, 20, 22, 24]
const SLEEP_OPTS  = [15, 30, 45, 60]

function fmt(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function PrefRow({ title, subtitle, children }) {
  return (
    <div className="pref-row">
      <div className="pref-txt">
        <h4>{title}</h4>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <div className={`toggle${on ? ' toggle--on' : ''}`} onClick={() => onChange(!on)} />
  )
}

export default function ProfileScreen() {
  const [s, set] = useSettings(
    'fontSize', 'playbackSpeed', 'defaultMode',
    'sleepTimerMinutes', 'notifGen', 'notifStreak', 'updates'
  )

  const vocabCount  = useLiveQuery(() => db.vocabulary.count(), []) ?? 0
  const bookCount   = useLiveQuery(() => db.books.count(), [])      ?? 0
  const hlCount     = useLiveQuery(() => db.highlights.count(), []) ?? 0
  const allVocab    = useLiveQuery(() => db.vocabulary.orderBy('createdAt').reverse().toArray(), []) ?? []

  const [storage, setStorage]       = useState({ used: 0, quota: 0 })
  const [showAllVocab, setShowAllVocab] = useState(false)
  // 'idle' | 'checking' | 'downloading' | 'installing' | 'uptodate'
  const [updatePhase, setUpdatePhase]       = useState('idle')
  const [updateProgress, setUpdateProgress] = useState(0)

  useEffect(() => {
    navigator.storage?.estimate().then(e =>
      setStorage({ used: e.usage || 0, quota: e.quota || 1 })
    )
  }, [])

  const usedPct = Math.min(100, Math.round((storage.used / storage.quota) * 100))

  function exportVocab() {
    const lines = allVocab.map(v => v.word).join('\n')
    const blob  = new Blob([lines], { type: 'text/plain' })
    const a     = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: 'leavs-vocabulary.txt',
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function deleteVocabWord(id) {
    await db.vocabulary.delete(id)
  }

  async function checkForUpdates() {
    if (!('serviceWorker' in navigator)) return
    setUpdatePhase('checking')
    setUpdateProgress(0)

    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) { setUpdatePhase('idle'); return }

      let found = false

      reg.addEventListener('updatefound', () => {
        found = true
        setUpdatePhase('downloading')
        setUpdateProgress(5)

        // Simulate download progress with small random ticks
        let prog = 5
        const ticker = setInterval(() => {
          prog = Math.min(prog + Math.random() * 18, 80)
          setUpdateProgress(Math.round(prog))
        }, 350)

        const sw = reg.installing
        if (!sw) { clearInterval(ticker); return }

        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' || sw.state === 'activating') {
            clearInterval(ticker)
            setUpdatePhase('installing')
            setUpdateProgress(90)
          }
          if (sw.state === 'activated') {
            setUpdateProgress(100)
            setTimeout(() => window.location.reload(), 600)
          }
        })
      }, { once: true })

      await reg.update()

      // After 4 s with no updatefound → already on latest version
      setTimeout(() => {
        if (!found) {
          setUpdatePhase('uptodate')
          setTimeout(() => { setUpdatePhase('idle'); setUpdateProgress(0) }, 2500)
        }
      }, 4000)
    } catch {
      setUpdatePhase('idle')
    }
  }

  const visibleVocab = showAllVocab ? allVocab : allVocab.slice(0, 5)

  return (
    <div className="screen">

      <div className="prof-hdr">
        <div className="prof-avatar">
          <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /></svg>
        </div>
        <div className="prof-name">
          <h2>Neville</h2>
          <p>{bookCount} book{bookCount !== 1 ? 's' : ''} · {hlCount} highlight{hlCount !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="prof-body">

        {/* Reading Preferences */}
        <div className="pref-section">
          <div className="pref-label">Reading Preferences</div>
          <div className="pref-card">

            <PrefRow title="Default mode" subtitle="When opening a book">
              <div className="seg-ctrl">
                {['read', 'listen'].map(m => (
                  <button key={m} className={`seg-btn${s.defaultMode === m ? ' seg-btn--on' : ''}`}
                    onClick={() => set('defaultMode', m)}>
                    {m === 'read' ? 'Read' : 'Listen'}
                  </button>
                ))}
              </div>
            </PrefRow>

            <PrefRow title="Playback speed" subtitle="Default for new chapters">
              <div className="seg-ctrl">
                {SPEED_OPTS.map(sp => (
                  <button key={sp} className={`seg-btn${s.playbackSpeed === sp ? ' seg-btn--on' : ''}`}
                    onClick={() => set('playbackSpeed', sp)}>
                    {sp}×
                  </button>
                ))}
              </div>
            </PrefRow>

            <PrefRow title="Font size" subtitle="Reader text size">
              <div className="seg-ctrl">
                {FONT_OPTS.map(sz => (
                  <button key={sz} className={`seg-btn${s.fontSize === sz ? ' seg-btn--on' : ''}`}
                    onClick={() => set('fontSize', sz)}>
                    {sz}
                  </button>
                ))}
              </div>
            </PrefRow>

          </div>
        </div>

        {/* Vocabulary */}
        <div className="pref-section">
          <div className="pref-label">
            Vocabulary · {vocabCount} word{vocabCount !== 1 ? 's' : ''} saved
          </div>
          <div className="pref-card">
            {allVocab.length === 0 ? (
              <div className="pref-row" style={{ justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                No words saved yet — tap any word while reading.
              </div>
            ) : (
              <>
                {visibleVocab.map(v => (
                  <div key={v.id} className="vocab-row">
                    <div className="vocab-word-sm">{v.word}</div>
                    <button className="vocab-del" onClick={() => deleteVocabWord(v.id)} aria-label="Delete">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                ))}
                {allVocab.length > 5 && (
                  <button className="show-more-btn" onClick={() => setShowAllVocab(v => !v)}>
                    {showAllVocab ? 'Show less' : `Show ${allVocab.length - 5} more`}
                  </button>
                )}
                <div className="pref-row" style={{ cursor: 'pointer' }} onClick={exportVocab}>
                  <div className="pref-ico pico-moss">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
                  </div>
                  <div className="pref-txt"><h4>Export vocabulary list</h4><p>Save as TXT</p></div>
                  <div className="pref-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Storage */}
        <div className="pref-section">
          <div className="pref-label">Storage</div>
          <div className="pref-card">
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmt(storage.used)} used</span>
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink)' }}>{fmt(storage.quota)} available</span>
              </div>
              <div className="storage-bar">
                <div className="storage-fill" style={{ width: `${usedPct}%`, background: 'linear-gradient(90deg, var(--moss), var(--vein))' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{usedPct}% of device storage used</div>
            </div>
          </div>
        </div>

        {/* App Settings */}
        <div className="pref-section">
          <div className="pref-label">App Settings</div>
          <div className="pref-card">

            <PrefRow title="Generation alerts" subtitle="When a chapter finishes generating">
              <Toggle on={s.notifGen} onChange={v => set('notifGen', v)} />
            </PrefRow>

            <PrefRow title="Streak reminders" subtitle="Daily reading nudge">
              <Toggle on={s.notifStreak} onChange={v => set('notifStreak', v)} />
            </PrefRow>

            <PrefRow title="Sleep timer default" subtitle="Auto-stop after">
              <div className="seg-ctrl">
                {SLEEP_OPTS.map(m => (
                  <button key={m} className={`seg-btn${s.sleepTimerMinutes === m ? ' seg-btn--on' : ''}`}
                    onClick={() => set('sleepTimerMinutes', m)}>
                    {m}m
                  </button>
                ))}
              </div>
            </PrefRow>

            <PrefRow title="App updates" subtitle="Prompt when a new version is ready">
              <Toggle on={s.updates} onChange={v => set('updates', v)} />
            </PrefRow>

          </div>
        </div>

        {/* About */}
        <div className="pref-section">
          <div className="pref-label">About</div>
          <div className="pref-card">
            <div className="about-row"><span>Version</span><strong>0.1.0</strong></div>
            <div className="about-row"><span>Built by</span><strong>Neville — Apex Tech</strong></div>

            <div className="pref-row"
              style={{ cursor: updatePhase === 'idle' ? 'pointer' : 'default' }}
              onClick={updatePhase === 'idle' ? checkForUpdates : undefined}>
              <div className="pref-ico pico-moss">
                {updatePhase === 'uptodate' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    style={{ animation: updatePhase !== 'idle' && updatePhase !== 'uptodate' ? 'spin 1s linear infinite' : 'none' }}>
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                )}
              </div>
              <div className="pref-txt">
                <h4>Check for updates</h4>
                <p style={{ color: updatePhase === 'uptodate' ? 'var(--vein-light)' : undefined }}>
                  {updatePhase === 'idle'        && 'Tap to check for a new version'}
                  {updatePhase === 'checking'    && 'Checking for updates…'}
                  {updatePhase === 'downloading' && `Downloading update — ${updateProgress}%`}
                  {updatePhase === 'installing'  && 'Installing… restarting shortly'}
                  {updatePhase === 'uptodate'    && 'App is up to date'}
                </p>
                {(updatePhase === 'downloading' || updatePhase === 'installing') && (
                  <div className="update-bar">
                    <div className="update-bar__fill" style={{ width: `${updateProgress}%` }} />
                  </div>
                )}
              </div>
            </div>

            {typeof window.__leavsInstall === 'function' && (
              <div className="pref-row" style={{ cursor: 'pointer' }} onClick={() => window.__leavsInstall?.()}>
                <div className="pref-ico pico-moss">
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                </div>
                <div className="pref-txt"><h4>Install app</h4><p>Add Leavs to your home screen</p></div>
                <div className="pref-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
