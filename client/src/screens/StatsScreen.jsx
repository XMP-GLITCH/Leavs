import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../db/db'
import LeafProgress from '../components/common/LeafProgress'

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function StreakDay({ label, done, isToday }) {
  const cls = isToday ? 'sdot2 sdot2--today' : done ? 'sdot2 sdot2--done' : 'sdot2'
  return (
    <div className="sday">
      <div className={cls}>
        {done && !isToday && (
          <svg viewBox="0 0 12 12" stroke="var(--moss)" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
        {isToday && (
          <svg viewBox="0 0 12 12" stroke="var(--moss)" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 3v3l2 2" />
          </svg>
        )}
      </div>
      <span style={isToday ? { color: '#fff', fontWeight: 600 } : undefined}>{label}</span>
    </div>
  )
}

export default function StatsScreen() {
  const hlCount    = useLiveQuery(() => db.highlights.count(), []) ?? 0
  const vocabCount = useLiveQuery(() => db.vocabulary.count(), []) ?? 0
  const allBooks   = useLiveQuery(() => db.books.toArray(), [])    ?? []

  const bkCount       = allBooks.length
  const finishedBooks = useMemo(
    () => allBooks.filter(b => (b.progress || 0) >= 0.99),
    [allBooks],
  )

  // Compute which of the past 7 days had any reading activity (via lastOpenedAt)
  const { dayLabels, streakDays, streakCount } = useMemo(() => {
    const today = new Date()
    const days  = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (6 - i))
      return d
    })
    const labels = days.map(d => DAY_INITIALS[d.getDay()])
    const active = days.map(d => {
      const dayStr = d.toDateString()
      return allBooks.some(b => b.lastOpenedAt && new Date(b.lastOpenedAt).toDateString() === dayStr)
    })
    // Current streak: consecutive active days counting back from today
    let streak = 0
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]) streak++
      else break
    }
    return { dayLabels: labels, streakDays: active, streakCount: streak }
  }, [allBooks])

  const totalListenSecs = useMemo(
    () => allBooks.reduce((sum, b) => sum + (b.listenedSeconds || 0), 0),
    [allBooks],
  )
  const totalReadSecs = useMemo(
    () => allBooks.reduce((sum, b) => sum + (b.readSeconds || 0), 0),
    [allBooks],
  )

  function fmtListenTime(secs) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m`
    return secs > 0 ? `${secs}s` : '—'
  }

  const STATS = [
    {
      label: 'Time listening',
      value: fmtListenTime(totalListenSecs),
      Icon: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>,
    },
    {
      label: 'Time reading',
      value: fmtListenTime(totalReadSecs),
      Icon: () => <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
    },
    {
      label: 'Books finished',
      value: String(finishedBooks.length),
      Icon: () => <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
    },
    {
      label: 'Highlights made',
      value: String(hlCount),
      Icon: () => <svg viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>,
    },
  ]

  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="screen">
      <div className="stats-hdr">
        <h2>Your Progress</h2>
        <p>{monthLabel} · {bkCount} book{bkCount !== 1 ? 's' : ''} in library</p>
        <div className="streak-row">
          {dayLabels.map((label, i) => (
            <StreakDay
              key={i}
              label={label}
              done={streakDays[i]}
              isToday={i === 6}
            />
          ))}
        </div>
        <div className="streak-tag">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--vein-light)" strokeWidth="1.8">
            <path d="M12 2C8.5 7 7 10 7 13a5 5 0 0 0 10 0c0-3-1.5-6-5-11z" />
            <path d="M12 22v-4M9 19.5c1 .5 3 .5 3 .5s2 0 3-.5" />
          </svg>
          <span>{streakCount > 0 ? `${streakCount}-day streak` : 'Start your streak today'}</span>
        </div>
      </div>

      <div className="stats-grid">
        {STATS.map(({ label, value, Icon }) => (
          <div key={label} className="sc">
            <div className="si2"><Icon /></div>
            <div className="sv">{value}</div>
            <div className="sl">{label}</div>
          </div>
        ))}
      </div>

      {(() => {
        const total      = totalListenSecs + totalReadSecs
        const listenPct  = total > 0 ? Math.round((totalListenSecs / total) * 100) : 0
        const readPct    = 100 - listenPct
        return (
          <div className="lvr">
            <div className="lvr-t">How you consume</div>
            <div className="lvr-bar">
              <div className="lvr-fill" style={{ width: `${listenPct}%` }} />
            </div>
            <div className="lvr-leg">
              <span><span className="ldot" style={{ background: 'var(--moss)' }} />Listening · {listenPct}%</span>
              <span><span className="ldot" style={{ background: 'var(--vein)' }} />Reading · {readPct}%</span>
            </div>
          </div>
        )
      })()}

      {finishedBooks.length > 0 && (
        <div className="recent-sec">
          <div className="section-label" style={{ padding: '0 0 10px' }}>
            <h3>Recently Finished</h3>
          </div>
          {finishedBooks.map(book => (
            <div key={book.id} className="recent-item">
              <div className="ri-cover" style={{ background: 'var(--parchment-deep)' }}>
                {book.cover && <img src={book.cover} alt={book.title} />}
              </div>
              <div className="ri-info">
                <h4>{book.title}</h4>
                <p>{book.author}</p>
              </div>
              <LeafProgress progress={1} size={20} />
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  )
}
