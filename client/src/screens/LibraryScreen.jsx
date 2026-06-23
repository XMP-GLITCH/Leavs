import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
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

function ShelfLeaf({ progress = 0 }) {
  const id = Math.random().toString(36).slice(2)
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
    <div className="bcard" onClick={onClick} role="button" tabIndex={0}>
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
    <div className="lgcard" onClick={onClick} role="button" tabIndex={0}>
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

export default function LibraryScreen() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [ingestState, setIngestState] = useState(null)

  const books = useLiveQuery(
    () => db.books.orderBy('lastOpenedAt').reverse().toArray(),
    [],
  )

  const continueBook = books?.[0] ?? null
  const recentBooks  = books?.slice(1, 7) ?? []
  const gridBooks    = books ?? []

  async function handleFabAction(action) {
    if (action === 'upload') fileInputRef.current?.click()
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
        <span>Search books, authors…</span>
      </div>

      {/* Continue Reading */}
      {continueBook && (
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
      {recentBooks.length > 0 && (
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
      {gridBooks.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>
            <h3>Library</h3>
            <a href="#">{gridBooks.length} book{gridBooks.length !== 1 ? 's' : ''}</a>
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

      {books?.length === 0 && (
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
      <FAB onAction={handleFabAction} />
    </div>
  )
}
