import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useEffect } from 'react'
import { db } from '../db/db'
import LeafProgress from '../components/common/LeafProgress'

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

  const [voices, setVoices] = useState([])

  const book     = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('index'),
    [bookId],
  )
  const progress = useLiveQuery(() => db.progress.get(bookId), [bookId])

  // Load device TTS voices (iOS defers population until after first call)
  useEffect(() => {
    const load = () => {
      const all = speechSynthesis.getVoices()
      setVoices(all.filter(v => v.lang.startsWith('en')))
    }
    load()
    speechSynthesis.onvoiceschanged = load
    return () => { speechSynthesis.onvoiceschanged = null }
  }, [])

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
                  {voices.length > 0 ? 'Using your device\'s built-in voice' : 'Device default voice'}
                </div>
              </div>
            </div>
            {voices.length > 0 && (
              <select
                className="voice-select"
                style={{ width: '100%', marginLeft: 0 }}
                value={book.voice || ''}
                onChange={e => handleVoiceChange(e.target.value)}
              >
                <option value="">System default</option>
                {voices.map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </select>
            )}
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
