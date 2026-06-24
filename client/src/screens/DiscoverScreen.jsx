import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ingestFile } from '../lib/ingest'
import { db } from '../db/db'

// ── Sources ─────────────────────────────────────────────────────────
const SOURCES = [
  { id: 'gutenberg', label: 'Gutenberg',       sub: '70k public domain books' },
  { id: 'openlib',   label: 'Open Library',    sub: 'Internet Archive scans'  },
  { id: 'standard',  label: 'Standard Ebooks', sub: '800 curated classics'    },
  { id: 'oceanpdf',  label: 'OceanPDF',        sub: 'PDF book library'        },
]

const QUICK = {
  gutenberg: [
    { label: 'Pride & Prejudice', q: 'pride prejudice' },
    { label: 'Sherlock Holmes',   q: 'sherlock holmes' },
    { label: 'Frankenstein',      q: 'frankenstein shelley' },
    { label: 'Meditations',       q: 'marcus aurelius meditations' },
  ],
  openlib: [
    { label: 'Mark Twain',   q: 'mark twain' },
    { label: 'Dickens',      q: 'charles dickens' },
    { label: 'Tolstoy',      q: 'leo tolstoy' },
    { label: 'H.G. Wells',   q: 'h g wells' },
  ],
  standard: [
    { label: 'Jane Austen',   q: 'jane austen' },
    { label: 'Jules Verne',   q: 'jules verne' },
    { label: 'Conan Doyle',   q: 'arthur conan doyle' },
    { label: 'H.P. Lovecraft',q: 'lovecraft' },
  ],
  oceanpdf: [
    { label: 'Atomic Habits',   q: 'atomic habits' },
    { label: 'Think & Grow Rich', q: 'think and grow rich' },
    { label: 'The Alchemist',  q: 'the alchemist paulo coelho' },
    { label: 'Rich Dad Poor Dad', q: 'rich dad poor dad' },
  ],
}

// ── Search adapters ──────────────────────────────────────────────────
function fmtAuthor(name) {
  if (!name) return 'Unknown'
  return name.includes(',') ? name.split(',').reverse().join(' ').trim() : name
}

async function searchGutenberg(query) {
  const res = await fetch(
    `https://gutendex.com/books/?search=${encodeURIComponent(query)}&languages=en`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.results || [])
    .map(b => ({
      id:       `gut-${b.id}`,
      title:    b.title,
      author:   fmtAuthor(b.authors[0]?.name),
      cover:    b.formats['image/jpeg'] || b.formats['image/png'] || null,
      stat:     `${(b.download_count || 0).toLocaleString()} downloads`,
      epubUrl:  b.formats['application/epub+zip'] || b.formats['application/epub+xml'] || null,
      pdfUrl:   b.formats['application/pdf'] || null,
    }))
    .filter(b => b.epubUrl || b.pdfUrl)
}

async function searchOpenLibrary(query) {
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&language=eng` +
    `&fields=key,title,author_name,cover_i,ia,public_scan_b&limit=40`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.docs || [])
    .filter(d => d.public_scan_b && d.ia?.length > 0)
    .slice(0, 20)
    .map(d => {
      const ia = d.ia[0]
      return {
        id:      `ol-${d.key}`,
        title:   d.title,
        author:  d.author_name?.[0] || 'Unknown',
        cover:   d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
          : null,
        stat:    'Internet Archive',
        epubUrl: `https://archive.org/download/${ia}/${ia}.epub`,
        pdfUrl:  `https://archive.org/download/${ia}/${ia}.pdf`,
      }
    })
}

async function searchStandardEbooks(query) {
  const res = await fetch(`/api/standard-ebooks/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return (data.books || []).map((b, i) => ({
    id:      `se-${i}`,
    title:   b.title,
    author:  b.author,
    cover:   b.coverUrl || null,
    stat:    'Standard Ebooks',
    epubUrl: b.epubUrl,
    pdfUrl:  null,
  }))
}

async function searchOceanPdf(query) {
  const res = await fetch(`/api/ocean-pdf/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return (data.books || []).map(b => ({
    ...b,
    stat:    'OceanPDF',
    epubUrl: null,
    pdfUrl:  null,
  }))
}

async function runSearch(source, query) {
  if (source === 'gutenberg') return searchGutenberg(query)
  if (source === 'openlib')   return searchOpenLibrary(query)
  if (source === 'standard')  return searchStandardEbooks(query)
  if (source === 'oceanpdf')  return searchOceanPdf(query)
  return []
}

// ── Components ───────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function BookRow({ book, adding, onAdd }) {
  const hasDl = book.epubUrl || book.pdfUrl || book.pageUrl
  const fmt = book.source === 'oceanpdf'    ? 'PDF'
            : book.epubUrl && book.pdfUrl   ? 'EPUB · PDF'
            : book.epubUrl                  ? 'EPUB'
            : book.pdfUrl                   ? 'PDF'
            : null

  return (
    <div className="disc-book">
      <div className="disc-cover">
        {book.cover
          ? <img src={book.cover} alt={book.title} loading="lazy" />
          : <div className="disc-cover-ph">{book.title[0]}</div>
        }
      </div>
      <div className="disc-meta">
        <div className="disc-title">{book.title}</div>
        <div className="disc-author">{book.author}</div>
        <div className="disc-dl">
          {book.stat}
          {fmt && <span style={{ marginLeft: 6, opacity: 0.55 }}>{fmt}</span>}
        </div>
      </div>
      {hasDl
        ? (
          <button
            className="disc-add"
            onClick={() => onAdd(book)}
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
        : <span className="disc-no-epub">No download</span>
      }
    </div>
  )
}

// ── Screen ───────────────────────────────────────────────────────────
export default function DiscoverScreen() {
  const navigate = useNavigate()

  const [source,  setSource]  = useState('gutenberg')
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [adding,  setAdding]  = useState({})
  const [addMsg,  setAddMsg]  = useState(null)

  const timerRef = useRef(null)
  const inputRef = useRef(null)

  // Re-search when source changes (if there's already a query)
  useEffect(() => {
    setResults(null)
    setError(null)
    if (!query.trim()) return
    doSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // Debounced search on query change
  useEffect(() => {
    if (!query.trim()) { setResults(null); setError(null); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(query), 500)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function doSearch(q) {
    setLoading(true)
    setError(null)
    try {
      const books = await runSearch(source, q)
      setResults(books)
    } catch {
      setError('Search failed — check your connection.')
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(book) {
    setAdding(a => ({ ...a, [book.id]: true }))
    setAddMsg(null)
    try {
      let blob = null
      let fileType = null

      if (book.source === 'oceanpdf') {
        // OceanPDF: two-step — server fetches page, finds PDF link, streams it
        const res = await fetch(`/api/ocean-pdf/fetch?url=${encodeURIComponent(book.pageUrl)}`)
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'Could not download PDF')
        }
        blob     = await res.blob()
        fileType = 'pdf'
      } else {
        // Other sources: try EPUB first, PDF as fallback
        const candidates = []
        if (book.epubUrl) candidates.push({ url: book.epubUrl, type: 'epub' })
        if (book.pdfUrl)  candidates.push({ url: book.pdfUrl,  type: 'pdf'  })

        for (const { url, type } of candidates) {
          const res = await fetch(`/api/gutenberg/proxy?url=${encodeURIComponent(url)}`)
          if (res.ok) { blob = await res.blob(); fileType = type; break }
        }
      }

      if (!blob) throw new Error('No downloadable format found for this book')

      const ext      = fileType === 'pdf' ? '.pdf' : '.epub'
      const mime     = fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      const filename = book.title.replace(/[^\w\s]/gi, '').trim().slice(0, 50) + ext
      const file     = new File([blob], filename, { type: mime })

      const result = await ingestFile(file)
      const bookId = typeof result === 'object' ? result.bookId : result
      if (!bookId) throw new Error('Book was not saved correctly — please try again.')

      const updates = { mode: 'listen' }
      if (book.cover) updates.cover = book.cover
      await db.books.update(bookId, updates)
      navigate(`/book/${bookId}`)
    } catch (err) {
      setAddMsg(`Could not add: ${err.message}`)
      setAdding(a => ({ ...a, [book.id]: false }))
    }
  }

  const currentSource = SOURCES.find(s => s.id === source)

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title display">Discover</h1>

        {/* Source tabs */}
        <div className="src-tabs">
          {SOURCES.map(s => (
            <button
              key={s.id}
              className={`src-tab${source === s.id ? ' src-tab--active' : ''}`}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="search-bar" style={{ marginTop: 10 }}>
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            placeholder={`Search ${currentSource?.label}…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="search-input"
          />
          {query && (
            <button
              style={{ background: 'none', border: 'none', padding: '0 4px', cursor: 'pointer', color: 'var(--text-secondary)' }}
              onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus() }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
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
            {QUICK[source].map(({ label, q }) => (
              <button key={label} className="disc-quick-chip" onClick={() => setQuery(q)}>
                {label}
              </button>
            ))}
          </div>

          <div className="section-label" style={{ padding: '20px 0 6px' }}>
            <h3>Source</h3>
          </div>
          <div className="discover-sources">
            {[
              currentSource?.sub,
              source === 'openlib'   ? 'EPUB + PDF available'    : null,
              source === 'gutenberg' ? 'EPUB + PDF where available' : null,
              source === 'standard'  ? 'EPUB only · Premium formatting' : null,
              'Public domain · Free to download',
            ].filter(Boolean).map(txt => (
              <div key={txt} className="source-chip">
                <span className="source-chip__dot" />
                <span>{txt}</span>
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
              No results for "{query}" on {currentSource?.label}
            </p>
          )
          : (
            <div className="disc-list">
              <div className="section-label" style={{ padding: '12px 16px 4px' }}>
                <h3>{results.length} results · {currentSource?.label}</h3>
              </div>
              {results.map(book => (
                <BookRow
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
