import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'

const COVER_OPTIONS = [
  { id: 'botanical', label: 'Botanical', gradient: 'linear-gradient(145deg, #1A3A1A, #2D6B3A, #5C8A5C)' },
  { id: 'minimal',   label: 'Minimal',   gradient: 'linear-gradient(145deg, #1A1A14, #3A3A30)'           },
  { id: 'warm',      label: 'Warm',      gradient: 'linear-gradient(145deg, #4A2D1A, #8B5E3C, #C96A28)'  },
  { id: 'twilight',  label: 'Twilight',  gradient: 'linear-gradient(145deg, #1A1A3A, #2D3A6B, #4A5C8A)'  },
]

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Extract a representative excerpt: beginning + middle + end of the full book text
function buildExcerpt(chapters) {
  const full = (chapters || []).map(c => c.text || '').filter(Boolean).join('\n\n')
  const len  = full.length
  const start  = full.slice(0, 3000)
  const mid    = len > 7000 ? full.slice(Math.floor(len / 2) - 750, Math.floor(len / 2) + 750) : ''
  const ending = len > 4000 ? full.slice(-600) : ''
  return [start, mid, ending].filter(Boolean).join('\n\n[...]\n\n').trim()
}

// HF FLUX.1-schnell — retries once if model is cold-starting
async function generateImage(title, scene, seed) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('/api/covers/image', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, scene, seed }),
    })

    if (res.status === 503) {
      const { estimated_time = 20 } = await res.json().catch(() => ({}))
      await new Promise(r => setTimeout(r, Math.min(estimated_time * 1000, 25_000)))
      continue
    }

    if (!res.ok) throw new Error(`Generation error ${res.status}`)
    return blobToDataUrl(await res.blob())
  }
  throw new Error('Model is warming up — try again in a moment.')
}

export default function CoverPickerScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const bookId = Number(id)

  const [selected,   setSelected]   = useState('botanical')
  const [aiCovers,   setAiCovers]   = useState([])
  const [aiLoading,  setAiLoading]  = useState(false)
  const [aiError,    setAiError]    = useState(null)
  const [aiSelected, setAiSelected] = useState(null)
  const [aiSource,   setAiSource]   = useState(null)   // 'gemini' | 'pollinations'

  const book     = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('order'),
    [bookId]
  )

  async function handleGenerateAI() {
    if (aiLoading || !book) return
    setAiLoading(true)
    setAiError(null)

    // Pull real book text from Dexie — beginning + middle + end
    const excerpt = buildExcerpt(chapters)

    try {
      // ── 1. Try Gemini image (uses book text as context when API key present) ──
      const res  = await fetch('/api/covers/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: book.title, author: book.author, genre: book.genre, excerpt }),
      })
      const body = await res.json().catch(() => ({}))

      if (res.ok && body.covers?.length) {
        setAiCovers(body.covers)
        setSelected('ai-0')
        setAiSelected(body.covers[0])
        setAiSource('gemini')
        return
      }

      // ── 2. Analyze book content to get 4 scene descriptions ──
      const analyzeRes = await fetch('/api/covers/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: book.title, author: book.author, excerpt }),
      })
      const { scenes = [] } = await analyzeRes.json().catch(() => ({}))

      // ── 3. Feed each scene description to HF FLUX ──
      const seeds   = [42, 137, 512, 999]
      const results = await Promise.allSettled(
        scenes.map((scene, i) => generateImage(book.title, scene, seeds[i]))
      )
      const covers  = results.filter(r => r.status === 'fulfilled').map(r => r.value)

      if (!covers.length) throw new Error('Image generation failed — add HF_TOKEN to server/.env (free at huggingface.co/settings/tokens)')

      setAiCovers(covers)
      setSelected('ai-0')
      setAiSelected(covers[0])
      setAiSource('huggingface')
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  async function handleConfirm() {
    if (!book) return
    if (aiSelected && selected?.startsWith('ai-')) {
      await db.books.update(bookId, { cover: aiSelected, coverStyle: null })
    } else {
      const opt = COVER_OPTIONS.find(o => o.id === selected)
      if (opt) await db.books.update(bookId, { coverStyle: opt.gradient, cover: null })
    }
    navigate(`/book/${id}`)
  }

  if (!book) return null

  return (
    <div className="screen">

      <div className="cover-hdr">
        <div className="back-row" onClick={() => navigate(`/book/${id}`)} style={{ cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          <span>Back</span>
        </div>
        <h2>Choose a cover</h2>
        <p>Pick a style for <em>{book.title}</em> or generate with AI.</p>
      </div>

      <div className="cover-book-strip">
        <div style={{ width: 36, height: 50, borderRadius: 4, background: 'var(--parchment-deep)', flexShrink: 0 }} />
        <div className="cbs-info">
          <h4>{book.title}</h4>
          <p>{book.author}</p>
        </div>
        <div className="cbs-badge">
          <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          AI ready
        </div>
      </div>

      {/* Gradient styles */}
      <div className="cover-grid-label">Style options</div>
      <div className="cover-grid">
        {COVER_OPTIONS.map(opt => (
          <div
            key={opt.id}
            className={`cover-option${selected === opt.id ? ' cover-option--selected' : ''}`}
            onClick={() => { setSelected(opt.id); setAiSelected(null) }}
          >
            <div className="cover-img" style={{ background: opt.gradient }}>{book.title}</div>
            <div className="cover-style-tag">{opt.label}</div>
          </div>
        ))}
      </div>

      {/* AI-generated covers */}
      {aiCovers.length > 0 && (
        <>
          <div className="cover-grid-label" style={{ marginTop: 20 }}>
            AI generated
            {aiSource === 'huggingface' && (
              <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>via Hugging Face</span>
            )}
          </div>
          <div className="cover-grid">
            {aiCovers.map((src, i) => (
              <div
                key={i}
                className={`cover-option${selected === `ai-${i}` ? ' cover-option--selected' : ''}`}
                onClick={() => { setSelected(`ai-${i}`); setAiSelected(src) }}
              >
                <div className="cover-img" style={{ padding: 0, overflow: 'hidden' }}>
                  <img src={src} alt={`AI cover ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div className="cover-style-tag">Style {i + 1}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Error */}
      {aiError && (
        <div style={{ margin: '10px 16px', padding: '10px 14px', background: 'rgba(212,114,96,0.1)', borderRadius: 8, fontSize: 13, color: '#C05A4A', lineHeight: 1.5 }}>
          {aiError}
        </div>
      )}

      {/* Generate / regenerate */}
      <div
        className="regen-row"
        onClick={aiLoading ? undefined : handleGenerateAI}
        style={{ opacity: aiLoading ? 0.5 : 1, cursor: aiLoading ? 'default' : 'pointer' }}
      >
        {aiLoading
          ? <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--moss)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
          : <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        }
        <span>
          {aiLoading
            ? 'Generating covers…'
            : aiCovers.length ? 'Regenerate' : 'Generate with AI'
          }
        </span>
      </div>

      <button className="confirm-cover-btn" onClick={handleConfirm}>
        <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
        Use this cover
      </button>

      <div style={{ height: 40 }} />
    </div>
  )
}
