import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ingestFile } from '../lib/ingest'
import { db } from '../db/db'

const GUTENDEX = 'https://gutendex.com/books'

const QUICK_SEARCHES = [
  { label: 'Pride & Prejudice', q: 'pride prejudice austen' },
  { label: 'Sherlock Holmes',   q: 'sherlock holmes doyle' },
  { label: 'Frankenstein',      q: 'frankenstein shelley'  },
  { label: 'Stoicism',          q: 'marcus aurelius stoic' },
]

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function BookResult({ book, adding, onAdd }) {
  const rawAuthor = book.authors[0]?.name || 'Unknown'
  const author = rawAuthor.includes(',')
    ? rawAuthor.split(',').reverse().join(' ').trim()
    : rawAuthor

  const coverUrl = book.formats['image/jpeg'] || book.formats['image/png']
  const epubUrl  = book.formats['application/epub+zip'] || book.formats['application/epub+xml']

  return (
    <div className="disc-book">
      <div className="disc-cover">
        {coverUrl
          ? <img src={coverUrl} alt={book.title} />
          : <div className="disc-cover-ph">{book.title[0]}</div>
        }
      </div>
      <div className="disc-meta">
        <div className="disc-title">{book.title}</div>
        <div className="disc-author">{author}</div>
        <div className="disc-dl">{(book.download_count || 0).toLocaleString()} reads</div>
      </div>
      {epubUrl
        ? (
          <button
            className="disc-add"
            onClick={() => onAdd(book, epubUrl, coverUrl)}
            disabled={adding}
            aria-label="Add to library"
          >
            {adding
              ? <div className="disc-spin" />
              : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
            }
          </button>
        )
        : <span className="disc-no-epub">No EPUB</span>
      }
    </div>
  )
}

export default function DiscoverScreen() {
  const navigate = useNavigate()

  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [adding,  setAdding]  = useState({})
  const [addMsg,  setAddMsg]  = useState(null)

  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) { setResults(null); setError(null); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${GUTENDEX}/?search=${encodeURIComponent(query)}&languages=en`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setResults(data.results || [])
      } catch {
        setError('Search failed — check your connection.')
        setResults(null)
      } finally {
        setLoading(false)
      }
    }, 500)
    return () => clearTimeout(timerRef.current)
  }, [query])

  async function handleAdd(book, epubUrl, coverUrl) {
    setAdding(a => ({ ...a, [book.id]: true }))
    setAddMsg(null)
    try {
      const proxyUrl = `/api/gutenberg/proxy?url=${encodeURIComponent(epubUrl)}`
      const res = await fetch(proxyUrl)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const filename = book.title.replace(/[^\w\s]/gi, '').trim().slice(0, 50) + '.epub'
      const file = new File([blob], filename, { type: 'application/epub+zip' })
      const bookId = await ingestFile(file)
      // Gutenberg books already have a cover image — skip the picker
      if (coverUrl) {
        await db.books.update(bookId, { cover: coverUrl })
        navigate(`/book/${bookId}`)
      } else {
        navigate(`/book/${bookId}/cover`)
      }
    } catch (err) {
      setAddMsg(`Could not add: ${err.message}`)
      setAdding(a => ({ ...a, [book.id]: false }))
    }
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title display">Discover</h1>
        <div className="search-bar">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search title or author…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="search-input"
          />
          {query && (
            <button
              style={{ background: 'none', border: 'none', padding: '0 4px', cursor: 'pointer', color: 'var(--text-secondary)' }}
              onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus() }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
      </header>

      {/* Quick searches */}
      {!query && !loading && (
        <div style={{ padding: '4px 16px 8px' }}>
          <div className="section-label" style={{ padding: '12px 0 6px' }}>
            <h3>Try searching</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {QUICK_SEARCHES.map(({ label, q }) => (
              <button
                key={label}
                className="disc-quick-chip"
                onClick={() => setQuery(q)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="section-label" style={{ padding: '20px 0 6px' }}>
            <h3>Sources</h3>
          </div>
          <div className="discover-sources">
            {['Project Gutenberg — 70,000+ free books', 'English language only', 'Public domain classics'].map(src => (
              <div key={src} className="source-chip">
                <span className="source-chip__dot" />
                <span>{src}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--vein)', borderTopColor: 'var(--moss)', animation: 'spin 0.7s linear infinite' }} />
        </div>
      )}

      {/* Error / add message */}
      {(error || addMsg) && (
        <div style={{ margin: '12px 16px', padding: '10px 14px', background: 'rgba(212,114,96,0.1)', borderRadius: 8, fontSize: 13, color: '#C05A4A' }}>
          {error || addMsg}
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        results.length === 0
          ? (
            <p style={{ padding: '24px 16px', fontSize: 14, color: 'var(--text-secondary)' }}>
              No results for "{query}"
            </p>
          )
          : (
            <div className="disc-list">
              <div className="section-label" style={{ padding: '12px 16px 4px' }}>
                <h3>{results.length} results</h3>
              </div>
              {results.map(book => (
                <BookResult
                  key={book.id}
                  book={book}
                  adding={!!adding[book.id]}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          )
      )}
    </div>
  )
}
