import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, useId } from 'react'
import { db } from '../db/db'
import { ingestFile } from '../lib/ingest'
import LeafProgress from '../components/common/LeafProgress'
import FAB from '../components/common/FAB'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const GRADIENTS = [
  'linear-gradient(155deg,#2D4A2D,#5C8A5C)',
  'linear-gradient(155deg,#4A2D1A,#8B5E3C)',
  'linear-gradient(155deg,#1A2D4A,#3D6B8A)',
  'linear-gradient(155deg,#4A1A2D,#8A3D6B)',
  'linear-gradient(155deg,#2D4A40,#5C8A78)',
  'linear-gradient(155deg,#3D3D1A,#7A7A3D)',
]

function bookGradient(title = '') {
  let hash = 0
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]
}

// role="button" + tabIndex only gets you focus. Without a key handler the card
// is reachable by keyboard and impossible to activate.
const activate = fn => e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
}

function ShelfLeaf({ progress = 0 }) {
  const id = useId().replace(/:/g, '')
  const fillH = progress * 18
  return (
    <svg className="bleaf-corner" viewBox="0 0 16 20" fill="none">
      <defs>
        <clipPath id={`bl-${id}`}>
          <path d="M8 1C8 1 15 4 15 11C15 16 12 19 8 19C4 19 1 16 1 11C1 4 8 1 8 1Z" />
        </clipPath>
      </defs>
      <path d="M8 1C8 1 15 4 15 11C15 16 12 19 8 19C4 19 1 16 1 11C1 4 8 1 8 1Z" fill="rgba(255,255,255,0.9)" />
      <rect x="0" y={20 - fillH} width="16" height={fillH} fill="var(--moss)" clipPath={`url(#bl-${id})`} />
      <path d="M8 1L8 19" stroke="rgba(45,74,45,0.4)" strokeWidth="0.7" />
    </svg>
  )
}

function RecentCard({ book, onClick }) {
  return (
    <div className="bcard" onClick={onClick} onKeyDown={activate(onClick)} role="button" tabIndex={0}>
      <div className="bcover" style={{ background: book.cover ? undefined : book.coverStyle || bookGradient(book.title) }}>
        {book.cover
          ? <img src={book.cover} alt="" />
          : <div className="bcinner">{book.title}<br /><small style={{ opacity: 0.7 }}>{book.author}</small></div>
        }
        <ShelfLeaf progress={book.progress || 0} />
      </div>
      <div className="btitle">{book.title}</div>
      <div className="bauthor">{book.author}</div>
    </div>
  )
}

function GridCard({ book, onClick }) {
  return (
    <div className="lgcard" onClick={onClick} onKeyDown={activate(onClick)} role="button" tabIndex={0}>
      <div className="lgcover" style={{ background: book.cover ? undefined : book.coverStyle || bookGradient(book.title) }}>
        {book.cover
          ? <img src={book.cover} alt="" />
          : <div className="lginner">{book.title}<br /><small style={{ opacity: 0.7 }}>{book.author}</small></div>
        }
        <ShelfLeaf progress={book.progress || 0} />
      </div>
      <div className="lgtitle">{book.title}</div>
      <div className="lgauthor">{book.author}</div>
    </div>
  )
}

function ContinueCard({ book, navigate }) {
  const pct = Math.round((book.progress || 0) * 100)
  return (
    <div className="cont-card" onClick={() => navigate(`/book/${book.id}/read`)} style={{ cursor: 'pointer' }}>
      <div className="cont-cover" style={{ background: book.cover ? undefined : book.coverStyle || bookGradient(book.title) }}>
        {book.cover ? <img src={book.cover} alt={book.title} /> : `${book.title}\n${book.author}`}
      </div>
      <div className="cont-info">
        <div className="mode-pill">
          <svg width="8" height="8" viewBox="0 0 10 10" fill="var(--vein-light)">
            <path d="M2 1.5l6 3.5-6 3.5V1.5z" />
          </svg>
          {book.mode === 'listen' ? 'Listening' : 'Reading'}
        </div>
        <h4>{book.title}</h4>
        <p>{book.author}</p>
        <div className="leaf-row">
          <LeafProgress progress={book.progress || 0} size={20} />
          <span className="prog-txt">{pct}%</span>
        </div>
      </div>
    </div>
  )
}

function IngestOverlay({ state, onDismiss }) {
  if (!state) return null
  return (
    <div className="ingest-overlay">
      <div className="ingest-card">
        {state.status === 'error' ? (
          <>
            <div className="ingest-icon ingest-icon--err">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            </div>
            <div className="ingest-title">Import failed</div>
            <div className="ingest-msg">{state.message}</div>
            <button className="ingest-dismiss" onClick={onDismiss}>Dismiss</button>
          </>
        ) : (
          <>
            <div className="ingest-spinner" />
            <div className="ingest-title">Importing book</div>
            <div className="ingest-msg">{state.message}</div>
          </>
        )}
      </div>
    </div>
  )
}

const YT_ICON = (
  <svg viewBox="0 0 24 24" fill="white" width="20" height="20">
    <path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.2 2.8 12 2.8 12 2.8s-4.2 0-6.8.2c-.6.1-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.2.3 4.2s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.5 21.7 12 21.7 12 21.7s4.2 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.1.3-4.2v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.3l8.1 3.6-8.1 3.6z"/>
  </svg>
)

function fmtDuration(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${ss}s` : `${ss}s`
}

function YoutubeModal({ onClose, onDownload }) {
  const [url, setUrl]       = useState('')
  const [info, setInfo]     = useState(null)   // { title, channel, durationSeconds }
  const [step, setStep]     = useState('url')  // 'url' | 'confirm' | 'downloading'
  const [progress, setProgress] = useState('')
  const [error, setError]   = useState(null)

  async function handleFetchInfo(e) {
    e.preventDefault()
    if (!url.trim()) return
    setError(null)
    setStep('url')
    setInfo(null)
    try {
      setProgress('Fetching video info…')
      const res  = await fetch(`/api/youtube/audio?url=${encodeURIComponent(url.trim())}&info=1`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || `Server error (${res.status}) — try again`)
      setInfo(data)
      setStep('confirm')
      setProgress('')
    } catch (err) {
      setError(err.message)
      setProgress('')
    }
  }

  async function handleDownload() {
    setStep('downloading')
    setError(null)
    try {
      const resp = await fetch(`/api/youtube/audio?url=${encodeURIComponent(url.trim())}`)
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || `Download failed (${resp.status})`)
      }

      const contentLength = parseInt(resp.headers.get('content-length') || '0')
      const reader = resp.body.getReader()
      const chunks = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        setProgress(contentLength > 0
          ? `Downloading… ${Math.round((received / contentLength) * 100)}%`
          : `Downloading… ${(received / 1024 / 1024).toFixed(1)} MB`)
      }

      const total = chunks.reduce((s, c) => s + c.length, 0)
      const buf   = new Uint8Array(total)
      let offset  = 0
      for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.length }

      const mime = (resp.headers.get('content-type') || 'audio/mp4').split(';')[0]
      onDownload({ ...info, arrayBuffer: buf.buffer, mime })
    } catch (err) {
      setError(err.message)
      setStep('confirm')
      setProgress('')
    }
  }

  return (
    <div className="ingest-overlay" onClick={e => { if (e.target === e.currentTarget && step !== 'downloading') onClose() }}>
      <div className="ingest-card" style={{ gap: 14 }}>
        <div className="ingest-icon" style={{ background: '#FF0000' }}>{YT_ICON}</div>
        <div className="ingest-title">Import YouTube audio</div>

        {step === 'url' && (
          <form onSubmit={handleFetchInfo} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ingest-msg" style={{ marginBottom: 0 }}>
              Downloads the audio track and saves it as a listenable book.
            </div>
            <input
              type="url"
              className="voice-select"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null) }}
              autoFocus
            />
            {progress && <div className="ingest-msg">{progress}</div>}
            {error && <div style={{ fontSize: 12, color: 'var(--vein)', textAlign: 'center' }}>{error}</div>}
            <button type="submit" className="btn btn--primary" disabled={!url.trim()}>
              Next
            </button>
            <button type="button" className="ingest-dismiss" onClick={onClose}>Cancel</button>
          </form>
        )}

        {step === 'confirm' && info && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--parchment-deep)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{info.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {info.channel} · {fmtDuration(info.durationSeconds)}
              </div>
            </div>
            <div className="ingest-msg" style={{ marginBottom: 0 }}>
              Audio will be saved as a book. Open it in Listen mode to play.
            </div>
            <button className="btn btn--primary" onClick={handleDownload}>
              Download audio
            </button>
            <button className="ingest-dismiss" onClick={() => setStep('url')}>Back</button>
          </div>
        )}

        {step === 'downloading' && (
          <>
            <div className="ingest-spinner" />
            <div className="ingest-msg">{progress || 'Downloading…'}</div>
            {error && <div style={{ fontSize: 12, color: 'var(--vein)', textAlign: 'center' }}>{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function GenerateAudioModal({ books, onClose, onSelect }) {
  const readBooks = books?.filter(b => b.mode !== 'listen') ?? []
  return (
    <div className="ingest-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ingest-card" style={{ gap: 14, maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="ingest-title">Generate audio</div>
        <div className="ingest-msg" style={{ marginBottom: 0 }}>
          Pick a book to generate an AI voice reading for it.
        </div>
        {readBooks.length === 0 ? (
          <div className="ingest-msg">No read-mode books found. Upload a PDF or EPUB first.</div>
        ) : (
          readBooks.map(book => (
            <button
              key={book.id}
              className="fab-action"
              onClick={() => { onClose(); onSelect(book.id) }}
            >
              <span className="fab-action__icon fab-action__icon--moss">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </span>
              <span className="fab-action__text">
                <span className="fab-action__label">{book.title}</span>
                <span className="fab-action__desc">{book.author || 'Unknown author'}</span>
              </span>
            </button>
          ))
        )}
        <button className="ingest-dismiss" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

export default function LibraryScreen() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [ingestState, setIngestState]       = useState(null)
  const [showYoutube, setShowYoutube]       = useState(false)
  const [showGenerateAudio, setShowGenerateAudio] = useState(false)
  const [searchQuery, setSearchQuery]       = useState('')

  const books = useLiveQuery(
    () => db.books.orderBy('lastOpenedAt').reverse().toArray(),
    [],
  )

  const q = searchQuery.trim().toLowerCase()
  const searchResults = q
    ? (books ?? []).filter(b =>
        b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q))
    : null

  const continueBook = books?.[0] ?? null
  const recentBooks  = books?.slice(0, 7) ?? []
  const gridBooks    = books ?? []

  async function handleFabAction(action) {
    if (action === 'upload')         fileInputRef.current?.click()
    if (action === 'import-audio')   setShowYoutube(true)
    if (action === 'generate-audio') setShowGenerateAudio(true)
  }

  async function handleAudioImport({ title, channel, durationSeconds, arrayBuffer, mime }) {
    setShowYoutube(false)
    setIngestState({ status: 'parsing', message: `Saving "${title}"…` })
    try {
      const bookId = await db.books.add({
        title,
        author:       channel,
        cover:        null,
        progress:     0,
        mode:         'listen',
        addedAt:      Date.now(),
        lastOpenedAt: Date.now(),
      })
      const chapterId = await db.chapters.add({
        bookId,
        index:       0,
        title:       'Audio',
        text:        `[Audio imported from YouTube · ${Math.round(durationSeconds / 60)} min]`,
        audioStatus: 'ready',
      })
      await db.audioChunks.add({
        bookId,
        chapterId,
        data:           arrayBuffer,
        mime:           mime || 'audio/mp4',
        duration:       durationSeconds,
        wordBoundaries: [],
      })
      setIngestState(null)
      navigate(`/book/${bookId}/read?chapter=0`)
    } catch (err) {
      setIngestState({ status: 'error', message: err.message })
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (typeof ingestFile !== 'function') {
      setIngestState({ status: 'error', message: 'Upload module failed to load — please close and reopen the app.' })
      return
    }

    try {
      setIngestState({ status: 'parsing', message: 'Reading file…' })
      const { bookId, hasCover } = await ingestFile(file, msg =>
        setIngestState({ status: 'parsing', message: msg })
      )
      setIngestState(null)
      navigate(hasCover ? `/book/${bookId}` : `/book/${bookId}/cover`)
    } catch (err) {
      console.error('[ingest]', err)
      setIngestState({ status: 'error', message: err.message })
    }
  }

  return (
    <div className="screen">
      <div className="lib-hdr">
        <div>
          <div className="lib-greet">{greeting()}</div>
          <div className="lib-title">Your Library</div>
        </div>
        <button className="avatar" aria-label="Profile" onClick={() => navigate('/profile')}>
          <svg viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </svg>
        </button>
      </div>

      <div className="searchbar">
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search books, authors…"
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', font: 'inherit', color: 'inherit' }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            style={{ background: 'none', border: 'none', padding: '0 4px', cursor: 'pointer', color: 'inherit' }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Search results replace the normal sections while a query is active */}
      {searchResults && (
        searchResults.length === 0
          ? (
            <div className="library-empty">
              <p className="library-empty__text">No books match "{searchQuery.trim()}".</p>
            </div>
          )
          : (
            <>
              <div className="section-label" style={{ paddingTop: 10 }}>
                <h3>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</h3>
              </div>
              <div className="lib-grid">
                {searchResults.map(book => (
                  <GridCard
                    key={book.id}
                    book={book}
                    onClick={() => navigate(`/book/${book.id}`)}
                  />
                ))}
              </div>
            </>
          )
      )}

      {/* Continue Reading */}
      {!searchResults && continueBook && (
        <>
          <div className="section-label" style={{ paddingTop: 10 }}>
            <h3>Continue reading</h3>
          </div>
          <div style={{ padding: '0 24px' }}>
            <ContinueCard book={continueBook} navigate={navigate} />
          </div>
        </>
      )}

      {/* Recent — horizontal scroll */}
      {!searchResults && recentBooks.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>
            <h3>Recent</h3>
          </div>
          <div className="shelf">
            {recentBooks.map(book => (
              <RecentCard
                key={book.id}
                book={book}
                onClick={() => navigate(`/book/${book.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {/* Library grid — all books */}
      {!searchResults && gridBooks.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>
            <h3>Library</h3>
            <span>{gridBooks.length} book{gridBooks.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="lib-grid">
            {gridBooks.map(book => (
              <GridCard
                key={book.id}
                book={book}
                onClick={() => navigate(`/book/${book.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {!searchResults && books?.length === 0 && (
        <div className="library-empty">
          <p className="library-empty__text">Your library is empty.</p>
          <p className="library-empty__hint">Tap the + button to add your first book.</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.pptx,.docx"
        hidden
        onChange={handleFileSelected}
      />

      <IngestOverlay state={ingestState} onDismiss={() => setIngestState(null)} />
      {showYoutube && (
        <YoutubeModal
          onClose={() => setShowYoutube(false)}
          onDownload={handleAudioImport}
        />
      )}
      {showGenerateAudio && (
        <GenerateAudioModal
          books={books}
          onClose={() => setShowGenerateAudio(false)}
          onSelect={bookId => navigate(`/book/${bookId}`)}
        />
      )}
      <FAB onAction={handleFabAction} />
    </div>
  )
}
