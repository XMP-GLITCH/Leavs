import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { generateBookAudio } from '../lib/generateAudio'
import LeafProgress from '../components/common/LeafProgress'

const VOICES = [
  { id: 'en-US-JennyNeural',   name: 'Jenny (US)'      },
  { id: 'en-US-GuyNeural',     name: 'Guy (US)'        },
  { id: 'en-GB-SoniaNeural',   name: 'Sonia (UK)'      },
  { id: 'en-GB-RyanNeural',    name: 'Ryan (UK)'       },
  { id: 'en-AU-NatashaNeural', name: 'Natasha (AU)'    },
  { id: 'en-AU-WilliamNeural', name: 'William (AU)'    },
  { id: 'en-IE-EmilyNeural',   name: 'Emily (Ireland)' },
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

function AudioStatusDot({ status }) {
  if (!status || status === 'none') return null
  if (status === 'generating') return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--vein)', borderTopColor: 'var(--moss)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
  )
  if (status === 'ready') return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--moss)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="white"><path d="M2 5l2.5 2.5 5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
    </div>
  )
  if (status === 'error') return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(212,114,96,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="8" height="8" viewBox="0 0 10 10" stroke="#D47260" fill="none" strokeWidth="1.8"><path d="M2 2l6 6M8 2l-6 6" /></svg>
    </div>
  )
  return null
}

export default function BookDetailScreen() {
  const { id }  = useParams()
  const navigate = useNavigate()
  const bookId   = Number(id)

  const [isGenerating, setIsGenerating] = useState(false)
  const [genMsg,       setGenMsg]       = useState('')
  const [selectedVoice, setSelectedVoice] = useState('en-US-JennyNeural')

  const book     = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('index'),
    [bookId],
  )
  const progress = useLiveQuery(() => db.progress.get(bookId), [bookId])

  if (!book) return null

  const pct         = Math.round((book.progress || 0) * 100)
  const resumeChIdx = progress?.chapterId ?? 0
  const currentCh   = chapters?.find(c => c.index === resumeChIdx)

  const hasAnyAudio = chapters?.some(c => c.audioStatus && c.audioStatus !== 'none')
  const coverStyle  = book.cover ? undefined : { background: book.coverStyle || 'linear-gradient(140deg, #C96A28, #6B3010)' }

  async function handleSetMode(mode) {
    await db.books.update(bookId, { mode })
  }

  async function handleGenerateAudio() {
    if (isGenerating) return
    setIsGenerating(true)
    setGenMsg('Starting…')
    try {
      await generateBookAudio(bookId, selectedVoice, msg => setGenMsg(msg))
    } catch (err) {
      setGenMsg(`Error: ${err.message}`)
    } finally {
      setIsGenerating(false)
      setGenMsg('')
    }
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

        {/* Audio generation */}
        {!hasAnyAudio && !isGenerating && (
          <div className="gen-cta">
            <div className="gen-cta-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>
                Generate audio narration
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                AI voice for all {chapters?.length ?? 0} chapters
              </div>
            </div>
            <select
              className="voice-select"
              value={selectedVoice}
              onChange={e => setSelectedVoice(e.target.value)}
            >
              {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button className="gen-cta-btn" onClick={handleGenerateAudio}>
              Generate
            </button>
          </div>
        )}

        {/* Generation progress */}
        {isGenerating && (
          <div className="gen-blk">
            <div className="gen-lbl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--vein)', borderTopColor: 'var(--moss)', animation: 'spin 0.8s linear infinite' }} />
              {genMsg}
            </div>
            {chapters?.filter(c => c.audioStatus !== 'none').slice(0, 5).map(ch => (
              <div className="gen-row" key={ch.id}>
                <div className={`gen-ico ${ch.audioStatus === 'ready' ? 'g-done' : ch.audioStatus === 'generating' ? 'g-act' : 'g-pend'}`}>
                  {ch.audioStatus === 'ready' && (
                    <svg viewBox="0 0 12 12" stroke="white" fill="none" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                  )}
                </div>
                <div className="gen-txt">
                  <h4>Ch. {ch.index + 1} · {ch.title || `Chapter ${ch.index + 1}`}</h4>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Audio ready — status list */}
        {hasAnyAudio && !isGenerating && (
          <div className="gen-blk">
            <div className="gen-lbl">Audio generation</div>
            {chapters?.slice(0, 4).map(ch => (
              <div className="gen-row" key={ch.id}>
                <div className={`gen-ico ${ch.audioStatus === 'ready' ? 'g-done' : 'g-pend'}`}>
                  {ch.audioStatus === 'ready' && (
                    <svg viewBox="0 0 12 12" stroke="white" fill="none" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                  )}
                </div>
                <div className="gen-txt">
                  <h4>Ch. {ch.index + 1} · {ch.title || `Chapter ${ch.index + 1}`}</h4>
                </div>
              </div>
            ))}
            {chapters?.some(c => !c.audioStatus || c.audioStatus === 'none' || c.audioStatus === 'error') && (
              <button
                style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--moss)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}
                onClick={handleGenerateAudio}
              >
                + Generate remaining chapters
              </button>
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
                <AudioStatusDot status={ch.audioStatus} />
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
            {(book.progress || 0) > 0 ? 'Continue reading' : 'Start reading'}
          </button>
        </div>

      </div>
    </div>
  )
}
