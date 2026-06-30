import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import LeafProgress from '../components/common/LeafProgress'

const VOICES = [
  { id: 'en-US-JennyNeural',   name: 'Jenny',   accent: 'American',   gender: 'Female' },
  { id: 'en-US-GuyNeural',     name: 'Guy',     accent: 'American',   gender: 'Male'   },
  { id: 'en-GB-SoniaNeural',   name: 'Sonia',   accent: 'British',    gender: 'Female' },
  { id: 'en-GB-RyanNeural',    name: 'Ryan',    accent: 'British',    gender: 'Male'   },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', accent: 'Australian', gender: 'Female' },
  { id: 'en-AU-WilliamNeural', name: 'William', accent: 'Australian', gender: 'Male'   },
  { id: 'en-IE-EmilyNeural',   name: 'Emily',   accent: 'Irish',      gender: 'Female' },
]

function ChapterLeaf({ progress = 0, size = 16 }) {
  const uid = Math.random().toString(36).slice(2)
  const h   = size * 1.25
  const fillH = progress * (h * 0.9)
  return (
    <svg width={size} height={h} viewBox="0 0 16 20" fill="none" className="ch-lf">
      <defs>
        <clipPath id={`cl-${uid}`}>
          <path d="M8 1C8 1 15 4 15 11C15 16 12 19 8 19C4 19 1 16 1 11C1 4 8 1 8 1Z" />
        </clipPath>
      </defs>
      <path
        d="M8 1C8 1 15 4 15 11C15 16 12 19 8 19C4 19 1 16 1 11C1 4 8 1 8 1Z"
        fill="var(--parchment-deep)"
        stroke={progress > 0 ? 'var(--moss)' : 'var(--vein)'}
        strokeWidth="1"
      />
      {progress > 0 && (
        <rect
          x="0" y={20 - fillH} width="16" height={fillH}
          fill={progress >= 1 ? 'var(--moss)' : 'var(--moss-light)'}
          opacity="0.8"
          clipPath={`url(#cl-${uid})`}
        />
      )}
      <path d="M8 1L8 19" stroke="var(--vein)" strokeWidth="0.7" />
    </svg>
  )
}


export default function BookDetailScreen() {
  const { id }  = useParams()
  const navigate = useNavigate()
  const bookId   = Number(id)

  const book     = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('index'),
    [bookId],
  )
  const progress = useLiveQuery(() => db.progress.get(bookId), [bookId])

  const audioReadyCount = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId)
          .filter(c => c.audioStatus === 'ready').count(),
    [bookId],
  ) ?? 0

  const [genState, setGenState] = useState(null) // { current, total } | null

  async function generateAllAudio() {
    const chs = await db.chapters.where('bookId').equals(bookId).sortBy('index')
    setGenState({ current: 0, total: chs.length })
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i]
      setGenState({ current: i + 1, total: chs.length })
      await db.chapters.update(ch.id, { audioStatus: 'generating' })
      try {
        const r = await fetch('/api/tts/chunk', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: ch.text.slice(0, 5000), voice: book?.voice || 'en-US-JennyNeural' }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const { audio, wordBoundaries } = await r.json()
        const bytes   = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
        const chunk   = { bookId, chapterId: ch.id, data: bytes.buffer, wordBoundaries: wordBoundaries || [] }
        const existing = await db.audioChunks.where('chapterId').equals(ch.id).first()
        if (existing) await db.audioChunks.update(existing.id, chunk)
        else          await db.audioChunks.add(chunk)
        await db.chapters.update(ch.id, { audioStatus: 'ready' })
      } catch {
        await db.chapters.update(ch.id, { audioStatus: 'none' })
      }
      await new Promise(res => setTimeout(res, 400))
    }
    setGenState(null)
  }

  if (!book) return null

  const pct         = Math.round((book.progress || 0) * 100)
  const resumeChIdx = progress?.chapterId ?? 0
  const currentCh   = chapters?.find(c => c.index === resumeChIdx)

  const coverStyle  = book.cover ? undefined : { background: book.coverStyle || 'linear-gradient(140deg, #C96A28, #6B3010)' }

  async function handleSetMode(mode) {
    await db.books.update(bookId, { mode })
  }

  async function handleVoiceChange(voiceURI) {
    await db.books.update(bookId, { voice: voiceURI })
  }

  return (
    <div className="screen" style={{ paddingBottom: 'var(--space-8)' }}>

      {/* Hero */}
      <div className="det-hero">
        <button className="det-back icon-btn" onClick={() => navigate('/library')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="det-cover" style={coverStyle} onClick={() => navigate(`/book/${id}/cover`)} title="Change cover">
          {book.cover
            ? <img src={book.cover} alt={book.title} />
            : <>{book.title}<br /><br />{book.author}</>
          }
          <div className="det-cover-edit">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="white" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
        </div>
        <div className="det-title-blk">
          <h2>{book.title}</h2>
          <p>{book.author}{chapters?.length ? ` · ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}` : ''}</p>
        </div>
      </div>

      <div className="det-body">

        {/* Mode toggle */}
        <div className="mode-toggle">
          <button
            className={`mtbtn${book.mode !== 'read' ? ' on' : ''}`}
            onClick={() => handleSetMode('listen')}
          >
            <svg viewBox="0 0 14 14"><path d="M2 2l10 5-10 5V2z" /></svg>
            Listen
          </button>
          <button
            className={`mtbtn${book.mode === 'read' ? ' on' : ''}`}
            onClick={() => handleSetMode('read')}
          >
            <svg viewBox="0 0 14 14">
              <rect x="1" y="2" width="12" height="1.5" rx=".75" />
              <rect x="1" y="6" width="10" height="1.5" rx=".75" />
              <rect x="1" y="10" width="11" height="1.5" rx=".75" />
            </svg>
            Read
          </button>
        </div>

        {/* Progress */}
        <div className="prog-block">
          <LeafProgress progress={book.progress || 0} size={28} />
          <div>
            <div className="pval">{pct}%</div>
            {currentCh && <div className="psub">Ch. {resumeChIdx + 1} of {chapters?.length}</div>}
          </div>
          {book.lastOpenedAt && (
            <div className="plast">
              <span>Last opened</span>
              <strong>
                {new Date(book.lastOpenedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </strong>
            </div>
          )}
        </div>

        {/* Narration voice — only shown in listen mode */}
        {book.mode === 'listen' && (
          <div className="gen-cta" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <div className="gen-cta-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>
                  Narration voice
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Microsoft Edge neural voices · no API key required
                </div>
              </div>
            </div>
            <select
              className="voice-select"
              style={{ width: '100%', marginLeft: 0 }}
              value={book.voice || 'en-US-JennyNeural'}
              onChange={e => handleVoiceChange(e.target.value)}
            >
              {VOICES.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.accent} · {v.gender}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Read-along audio generation */}
        {chapters?.length > 0 && (
          <div className="gen-cta" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <div className="gen-cta-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>
                  Read-along audio
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {genState
                    ? `Chapter ${genState.current} of ${genState.total}…`
                    : audioReadyCount > 0
                    ? `${audioReadyCount} of ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''} ready · plays offline in Listen & Read modes`
                    : 'Pre-generate AI narration for offline listening'}
                </div>
                {genState && (
                  <div className="tts-gen-bar">
                    <div className="tts-gen-bar__fill" style={{ width: `${Math.round((genState.current / genState.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
            <button
              className="gen-cta-btn"
              style={{ width: '100%', textAlign: 'center', opacity: genState ? 0.6 : 1 }}
              disabled={genState != null}
              onClick={generateAllAudio}
            >
              {genState
                ? `Generating ${genState.current}/${genState.total}…`
                : audioReadyCount > 0
                ? `Regenerate (${audioReadyCount}/${chapters.length} ready)`
                : `Generate audio · ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/* Chapter list */}
        <div className="section-label" style={{ padding: '0 0 8px' }}>
          <h3>Chapters</h3>
        </div>
        <div className="ch-list">
          {chapters?.map(ch => {
            const isNow = ch.index === resumeChIdx && (book.progress || 0) > 0
            return (
              <div
                key={ch.id}
                className={`ch-item${isNow ? ' ch-now' : ''}`}
                onClick={() => navigate(`/book/${id}/read?chapter=${ch.index}`)}
              >
                <span className="ch-num">{String(ch.index + 1).padStart(2, '0')}</span>
                <div className="ch-info">
                  <h4>{ch.title || `Chapter ${ch.index + 1}`}</h4>
                  {isNow && <p style={{ color: 'var(--moss-light)', fontWeight: 600 }}>Now reading</p>}
                </div>
                <ChapterLeaf progress={isNow ? (book.progress || 0) : 0} />
              </div>
            )
          })}
          {chapters?.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 'var(--space-4) 0' }}>
              No chapters parsed yet.
            </p>
          )}
        </div>

        <div style={{ marginTop: 'var(--space-6)' }}>
          <button
            className="btn btn--primary btn--large"
            onClick={() => navigate(`/book/${id}/read?chapter=${resumeChIdx}`)}
          >
            {book.mode === 'listen'
              ? (book.progress || 0) > 0 ? 'Continue listening' : 'Start listening'
              : (book.progress || 0) > 0 ? 'Continue reading'   : 'Start reading'
            }
          </button>
        </div>

      </div>
    </div>
  )
}
