import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ingestFile } from '../lib/ingest'
import { db } from '../db/db'

// ── Sources (PDF Drive + OceanPDF removed — their downloads require
//   JS rendering which can't run in a serverless function) ────────────
const SOURCES = [
  { id: 'gutenberg', label: 'Gutenberg',       sub: '70k public domain books'    },
  { id: 'openlib',   label: 'Open Library',    sub: 'Internet Archive scans'     },
  { id: 'standard',  label: 'Standard Ebooks', sub: '800 curated classics'       },
  { id: 'libgen',    label: 'Library Genesis', sub: 'Millions of books & papers' },
  { id: 'anna',      label: "Anna's Archive",  sub: 'Largest shadow library'     },
]

const QUICK = {
  gutenberg: [
    { label: 'Pride & Prejudice',  q: 'pride prejudice'             },
    { label: 'Sherlock Holmes',    q: 'sherlock holmes'             },
    { label: 'Frankenstein',       q: 'frankenstein shelley'        },
    { label: 'Meditations',        q: 'marcus aurelius meditations' },
  ],
  openlib: [
    { label: 'Atomic Habits',  q: 'atomic habits'    },
    { label: '1984',           q: '1984 orwell'      },
    { label: 'Sapiens',        q: 'sapiens harari'   },
    { label: 'The Alchemist',  q: 'alchemist coelho' },
  ],
  standard: [
    { label: 'Jane Austen',    q: 'jane austen'        },
    { label: 'Jules Verne',    q: 'jules verne'        },
    { label: 'Conan Doyle',    q: 'arthur conan doyle' },
    { label: 'H.P. Lovecraft', q: 'lovecraft'          },
  ],
  libgen: [
    { label: 'Dune',          q: 'dune frank herbert'     },
    { label: '1984',          q: '1984 george orwell'     },
    { label: 'Sapiens',       q: 'sapiens yuval harari'   },
    { label: 'Thinking Fast', q: 'thinking fast and slow' },
  ],
  anna: [
    { label: 'Atomic Habits',     q: 'atomic habits james clear'  },
    { label: 'The Alchemist',     q: 'the alchemist paulo coelho' },
    { label: 'Rich Dad Poor Dad', q: 'rich dad poor dad kiyosaki' },
    { label: 'Educated',          q: 'educated tara westover'     },
  ],
}

// ── Search adapters — include description where available ────────────
function fmtAuthor(name) {
  if (!name) return 'Unknown'
  return name.includes(',') ? name.split(',').reverse().join(' ').trim() : name
}

async function searchGutenberg(query) {
  const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(query)}&languages=en`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.results || [])
    .map(b => ({
      id:          `gut-${b.id}`,
      title:       b.title,
      author:      fmtAuthor(b.authors[0]?.name),
      cover:       b.formats['image/jpeg'] || b.formats['image/png'] || null,
      stat:        `${(b.download_count || 0).toLocaleString()} downloads`,
      description: b.subjects?.length ? b.subjects.slice(0, 6).join(' · ') : null,
      epubUrl:     b.formats['application/epub+zip'] || b.formats['application/epub+xml'] || null,
      pdfUrl:      b.formats['application/pdf'] || null,
    }))
    .filter(b => b.epubUrl || b.pdfUrl)
}

async function searchOpenLibrary(query) {
  // Keep fields minimal — first_sentence can cause 400 on some OL API versions
  const fields = 'key,title,author_name,cover_i,ia,has_fulltext,subject'
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&lang=eng&fields=${fields}&limit=40`
  )
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`)
  const data = await res.json()
  return (data.docs || [])
    .filter(d => d.has_fulltext && d.ia?.length > 0)
    .slice(0, 20)
    .map(d => {
      const ia   = d.ia[0]
      const desc = d.subject?.slice(0, 5).join(' · ') || null
      return {
        id:          `ol-${d.key}`,
        title:       d.title,
        author:      d.author_name?.[0] || 'Unknown',
        cover:       d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
        stat:        'Internet Archive',
        description: desc,
        epubUrl:     `https://archive.org/download/${ia}/${ia}.epub`,
        pdfUrl:      `https://archive.org/download/${ia}/${ia}.pdf`,
      }
    })
}

async function searchStandardEbooks(query) {
  const res = await fetch(`/api/standard-ebooks/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
  const data = await res.json()
  return (data.books || []).map((b, i) => ({
    id:          `se-${i}`,
    title:       b.title,
    author:      b.author,
    cover:       b.coverUrl || null,
    stat:        'Standard Ebooks',
    description: b.description || null,
    epubUrl:     b.epubUrl,
    pdfUrl:      null,
  }))
}

async function searchLibGen(query) {
  const res = await fetch(`/api/libgen/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
  const data = await res.json()
  return (data.books || []).map(b => ({ ...b, source: 'libgen', description: null }))
}

async function searchAnna(query) {
  const res = await fetch(`/api/anna/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
  const data = await res.json()
  return (data.books || []).map(b => ({ ...b, source: 'anna', description: null }))
}

async function runSearch(source, query) {
  if (source === 'gutenberg') return searchGutenberg(query)
  if (source === 'openlib')   return searchOpenLibrary(query)
  if (source === 'standard')  return searchStandardEbooks(query)
  if (source === 'libgen')    return searchLibGen(query)
  if (source === 'anna')      return searchAnna(query)
  return []
}

// ── Download with progress ───────────────────────────────────────────
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const contentType   = res.headers.get('content-type') || ''
  const contentLength = res.headers.get('content-length')
  const total         = contentLength ? parseInt(contentLength, 10) : null

  if (!total || !res.body) {
    onProgress(-1)
    return { blob: await res.blob(), contentType }
  }
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(received / total)
  }
  return { blob: new Blob(chunks, { type: contentType }), contentType }
}

// ── Shared format label ──────────────────────────────────────────────
function fmtLabel(book) {
  // libgen/anna: stat already contains format (e.g. "2018 · EPUB · 1.2 MB")
  if (book.source === 'libgen' || book.source === 'anna') return null
  if (book.epubUrl && book.pdfUrl) return 'EPUB · PDF'
  if (book.epubUrl)                return 'EPUB'
  if (book.pdfUrl)                 return 'PDF'
  return null
}

// ── BookRow ──────────────────────────────────────────────────────────
function BookRow({ book, progress, onAdd, onTap }) {
  const isMd5    = book.source === 'libgen' || book.source === 'anna'
  const hasDl    = book.epubUrl || book.pdfUrl || isMd5
  const isAdding = progress != null
  const fmt      = fmtLabel(book)
  const pct      = (progress == null || progress === -1) ? null : Math.round(progress * 100)

  return (
    <div
      className="disc-book"
      style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
      onClick={() => onTap(book)}
    >
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
          {isAdding
            ? <span style={{ color: 'var(--moss)', fontWeight: 500 }}>
                {pct !== null ? `Downloading ${pct}%` : 'Downloading…'}
              </span>
            : <>{book.stat}{fmt && <span style={{ marginLeft: 6, opacity: 0.55 }}>{fmt}</span>}</>
          }
        </div>
      </div>
      {hasDl
        ? (
          <button
            className="disc-add"
            onClick={e => { e.stopPropagation(); !isAdding && onAdd(book) }}
            disabled={isAdding}
            aria-label="Add to library"
          >
            {isAdding
              ? <div className="disc-spin" />
              : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
            }
          </button>
        )
        : <span className="disc-no-epub" onClick={e => e.stopPropagation()}>No download</span>
      }
      {isAdding && (
        <div className="disc-progress-track">
          {pct !== null
            ? <div className="disc-progress-fill" style={{ width: `${pct}%` }} />
            : <div className="disc-progress-indeterminate" />
          }
        </div>
      )}
    </div>
  )
}

// ── BookDetailSheet ──────────────────────────────────────────────────
function BookDetailSheet({ book, onClose, onAdd, progress }) {
  const [richDesc,     setRichDesc]     = useState(null)
  const [descLoading,  setDescLoading]  = useState(false)

  useEffect(() => {
    setRichDesc(null)
    if (!book) return
    // Only fetch extra detail for Open Library books that have no baked-in description
    if (!book.id.startsWith('ol-') || book.description) return
    const workPath = book.id.slice(3) // e.g. "/works/OL24456W"
    setDescLoading(true)
    fetch(`https://openlibrary.org${workPath}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const raw = d.description
        if (!raw) return
        const text = typeof raw === 'string' ? raw : (raw.value || '')
        setRichDesc(text.slice(0, 800) || null)
      })
      .catch(() => {})
      .finally(() => setDescLoading(false))
  }, [book?.id])

  if (!book) return null

  const isMd5    = book.source === 'libgen' || book.source === 'anna'
  const hasDl    = book.epubUrl || book.pdfUrl || isMd5
  const fmt      = fmtLabel(book)
  const isAdding = progress != null
  const pct      = (progress == null || progress === -1) ? null : Math.round(progress * 100)
  const desc     = book.description || richDesc

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-cover-wrap">
          {book.cover
            ? <img src={book.cover} alt={book.title} className="sheet-cover-img" />
            : <div className="sheet-cover-ph-lg">{book.title[0]}</div>
          }
        </div>

        <h2 className="sheet-title">{book.title}</h2>
        <p className="sheet-author">{book.author}</p>
        {(book.stat || fmt) && (
          <p className="sheet-stat">{book.stat}{fmt ? ` · ${fmt}` : ''}</p>
        )}

        {desc
          ? <p className="sheet-desc">{desc}</p>
          : <p className="sheet-desc sheet-desc--empty">
              {descLoading ? 'Loading description…' : 'No description available'}
            </p>
        }

        {hasDl
          ? (
            <button
              className="sheet-dl-btn"
              disabled={isAdding}
              onClick={() => { onClose(); onAdd(book) }}
            >
              {isAdding
                ? (pct !== null ? `Downloading ${pct}%…` : 'Downloading…')
                : '+ Add to Library'
              }
            </button>
          )
          : <p className="sheet-no-dl">No download available</p>
        }
      </div>
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
  const [sheet,   setSheet]   = useState(null)

  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setResults(null); setError(null)
    if (!query.trim()) return
    doSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useEffect(() => {
    if (!query.trim()) { setResults(null); setError(null); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(query), 500)
    return () => clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (!sheet) return
    const fn = e => { if (e.key === 'Escape') setSheet(null) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [sheet])

  async function doSearch(q) {
    setLoading(true); setError(null)
    try   { setResults(await runSearch(source, q)) }
    catch (err) { setError(err.message || 'Search failed — try another source.'); setResults(null) }
    finally { setLoading(false) }
  }

  async function handleAdd(book) {
    const bid = book.id
    const onProgress = p => setAdding(a => ({ ...a, [bid]: p }))
    setAdding(a => ({ ...a, [bid]: 0 }))
    setAddMsg(null)
    try {
      let blob = null, fileType = null

      if (book.source === 'libgen' || book.source === 'anna') {
        const { blob: b, contentType } = await fetchWithProgress(
          `/api/libgen/fetch?md5=${encodeURIComponent(book.md5)}`, onProgress
        )
        blob = b; fileType = contentType.includes('pdf') ? 'pdf' : 'epub'
      } else {
        const candidates = []
        if (book.epubUrl) candidates.push({ url: book.epubUrl, type: 'epub' })
        if (book.pdfUrl)  candidates.push({ url: book.pdfUrl,  type: 'pdf'  })
        for (const { url, type } of candidates) {
          try {
            const { blob: b } = await fetchWithProgress(
              `/api/gutenberg/proxy?url=${encodeURIComponent(url)}`, onProgress
            )
            blob = b; fileType = type; break
          } catch { continue }
        }
      }

      if (!blob) throw new Error('No downloadable format found for this book')

      const ext  = fileType === 'pdf' ? '.pdf' : '.epub'
      const mime = fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      const file = new File(
        [blob],
        book.title.replace(/[^\w\s]/gi, '').trim().slice(0, 50) + ext,
        { type: mime }
      )
      const result = await ingestFile(file)
      const bookId = typeof result === 'object' ? result.bookId : result
      if (!bookId) throw new Error('Book was not saved correctly')

      const updates = { mode: 'listen' }
      if (book.cover) updates.cover = book.cover
      await db.books.update(bookId, updates)
      navigate(`/book/${bookId}`)
    } catch (err) {
      setAddMsg(`Could not add: ${err.message}`)
      setAdding(a => { const n = { ...a }; delete n[bid]; return n })
    }
  }

  const currentSource   = SOURCES.find(s => s.id === source)
  const sourceInfoChips = [currentSource?.sub].filter(Boolean)
  if (source === 'openlib')   sourceInfoChips.push('EPUB + PDF available')
  if (source === 'gutenberg') sourceInfoChips.push('EPUB + PDF where available')
  if (source === 'standard')  sourceInfoChips.push('EPUB only · Premium formatting')
  if (source === 'libgen')    sourceInfoChips.push('EPUB · PDF · DJVU · more')
  if (source === 'anna')      sourceInfoChips.push('EPUB · PDF · multiple formats')

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title display">Discover</h1>

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

      {!query && !loading && (
        <div style={{ padding: '4px 16px 8px' }}>
          <div className="section-label" style={{ padding: '12px 0 6px' }}><h3>Try searching</h3></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {QUICK[source].map(({ label, q }) => (
              <button key={label} className="disc-quick-chip" onClick={() => setQuery(q)}>{label}</button>
            ))}
          </div>
          <div className="section-label" style={{ padding: '20px 0 6px' }}><h3>Source</h3></div>
          <div className="discover-sources">
            {sourceInfoChips.map(txt => (
              <div key={txt} className="source-chip">
                <span className="source-chip__dot" /><span>{txt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--vein)', borderTopColor: 'var(--moss)', animation: 'spin 0.7s linear infinite' }} />
        </div>
      )}

      {(error || addMsg) && (
        <div style={{ margin: '12px 16px', padding: '10px 14px', background: 'rgba(212,114,96,0.1)', borderRadius: 8, fontSize: 13, color: '#C05A4A' }}>
          {error || addMsg}
        </div>
      )}

      {!loading && results && (
        results.length === 0
          ? <p style={{ padding: '24px 16px', fontSize: 14, color: 'var(--text-secondary)' }}>No results for "{query}" on {currentSource?.label}</p>
          : (
            <div className="disc-list">
              <div className="section-label" style={{ padding: '12px 16px 4px' }}>
                <h3>{results.length} results · {currentSource?.label}</h3>
              </div>
              {results.map(book => (
                <BookRow
                  key={book.id}
                  book={book}
                  progress={adding[book.id] ?? null}
                  onAdd={handleAdd}
                  onTap={setSheet}
                />
              ))}
            </div>
          )
      )}

      <BookDetailSheet
        book={sheet}
        onClose={() => setSheet(null)}
        onAdd={handleAdd}
        progress={sheet ? (adding[sheet.id] ?? null) : null}
      />
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
