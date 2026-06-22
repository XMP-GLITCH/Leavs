import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { db } from '../db/db'
import { AudioPlayer, computeWaveform, findActiveWord, fmtTime } from '../lib/audioPlayer'
import { useSettings, getSetting } from '../utils/settings'

const STATIC_WAVE = [0.3,0.55,0.7,0.5,0.85,0.4,0.65,0.9,0.45,0.75,0.55,0.8,0.35,0.6,0.95,0.5,0.7,0.4,0.85,0.6,0.45,0.75,0.55,0.8,0.35,0.65,0.9,0.5,0.7,0.4,0.85,0.6,0.45,0.75,0.55,0.35,0.65,0.5,0.4,0.3]
const BARS = 40

const HL_COLORS = [
  { cls: 'hl-y', bg: '#F5D76E' },
  { cls: 'hl-g', bg: '#7BC678' },
  { cls: 'hl-b', bg: '#7AB8D8' },
  { cls: 'hl-r', bg: '#D47260' },
]

const SPEEDS = [0.75, 1.0, 1.2, 1.5, 2.0]

const READER_NAV = [
  { id: 'library',  label: 'Library',  back: true, icon: <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg> },
  { id: 'annotate', label: 'Annotate', icon: <svg viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg> },
  { id: 'notes',    label: 'Notes',    icon: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> },
  { id: 'focus',    label: 'Focus',    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.64 5.64l.7.7M17.66 17.66l.7.7M5.64 18.36l.7-.7M17.66 6.34l.7-.7" /></svg> },
]

export default function ReaderScreen() {
  const { id }      = useParams()
  const [sp]        = useSearchParams()
  const navigate    = useNavigate()
  const bookId      = Number(id)
  const chapterIndex = Number(sp.get('chapter') || 0)

  // ── UI state ────────────────────────────────────────────────────────────
  const [activeNav,      setActiveNav]      = useState('annotate')
  const [showNotesPanel, setShowNotesPanel] = useState(false)
  const [vocabWord,      setVocabWord]      = useState(null)
  const [vocabPi,        setVocabPi]        = useState(null)
  const [vocabDef,       setVocabDef]       = useState(null)
  const [vocabLoading,   setVocabLoading]   = useState(false)
  const [showHlPanel,    setShowHlPanel]    = useState(false)
  const [selectedText,   setSelectedText]   = useState('')
  const [customSel,      setCustomSel]      = useState(null)  // { minWi, maxWi }
  const [noteText,       setNoteText]       = useState('')
  const [hlColor,        setHlColor]        = useState('hl-y')

  // ── Settings ────────────────────────────────────────────────────────────
  const [prefs] = useSettings('fontSize', 'playbackSpeed')
  const [sleepEnd,       setSleepEnd]       = useState(null)
  const [sleepRemaining, setSleepRemaining] = useState(0)

  // ── Audio state ─────────────────────────────────────────────────────────
  const [isPlaying,     setIsPlaying]     = useState(false)
  const [currentTime,   setCurrentTime]   = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [waveform,      setWaveform]      = useState(STATIC_WAVE)
  const [audioReady,    setAudioReady]    = useState(false)
  const [speedIdx,      setSpeedIdx]      = useState(2)
  const [activeWordIdx, setActiveWordIdx] = useState(-1)

  // ── Refs ────────────────────────────────────────────────────────────────
  const playerRef         = useRef(null)
  const scrollRestoredRef = useRef(false)
  const wordBoundariesRef = useRef([])
  // Custom text-selection refs (avoid stale closures inside addEventListener)
  const paraTokensRef  = useRef([])
  const selAnchorRef   = useRef(null)
  const customSelRef   = useRef(null)
  const longPressRef   = useRef(null)
  const touchStartRef  = useRef(null)

  // ── Data ────────────────────────────────────────────────────────────────
  const book     = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapter  = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).filter(c => c.index === chapterIndex).first(),
    [bookId, chapterIndex],
  )
  const chapterCount = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).count(), [bookId],
  ) ?? 0
  const savedProgress = useLiveQuery(() => db.progress.get(bookId), [bookId])
  const chapters      = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('index'),
    [bookId],
  )
  const audioChunk = useLiveQuery(
    () => chapter ? db.audioChunks.where('chapterId').equals(chapter.id).first() : undefined,
    [chapter?.id],
  )
  const chapterHighlights = useLiveQuery(
    () => chapter
      ? db.highlights.where('chapterId').equals(chapterIndex)
          .filter(h => h.bookId === bookId).toArray()
      : [],
    [chapter?.id, chapterIndex, bookId],
  )
  const allHighlights = useLiveQuery(
    () => db.highlights.where('bookId').equals(bookId).sortBy('createdAt'),
    [bookId],
  )
  const allBookmarks = useLiveQuery(
    () => db.bookmarks.where('bookId').equals(bookId).sortBy('createdAt'),
    [bookId],
  )

  // ── AudioPlayer lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    const player = new AudioPlayer()
    player.onTimeUpdate = (t, d) => {
      setCurrentTime(t)
      if (d > 0) setAudioDuration(d)
      const idx = findActiveWord(wordBoundariesRef.current, t)
      if (idx !== -1) setActiveWordIdx(idx)
    }
    player.onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
      setActiveWordIdx(-1)
    }
    playerRef.current = player
    return () => player.destroy()
  }, [])

  useEffect(() => {
    if (!audioChunk?.data || !playerRef.current) return
    setAudioReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setActiveWordIdx(-1)
    wordBoundariesRef.current = audioChunk.wordBoundaries ?? []

    playerRef.current.load(audioChunk.data).then(() => {
      setAudioReady(true)
      setAudioDuration(playerRef.current.duration)
      setWaveform(computeWaveform(playerRef.current.buffer, BARS))
      playerRef.current.setSpeed(SPEEDS[speedIdx])
    })
  }, [audioChunk?.id])

  // ── Vocab definition fetch ───────────────────────────────────────────────
  useEffect(() => {
    if (!vocabWord) { setVocabDef(null); return }
    setVocabLoading(true)
    setVocabDef(null)
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(vocabWord)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.[0]) return
        const entry   = data[0]
        const meaning = entry.meanings?.[0]
        const def     = meaning?.definitions?.[0]
        setVocabDef({
          phonetic:    entry.phonetics?.find(p => p.text)?.text || '',
          partOfSpeech: meaning?.partOfSpeech || '',
          definition:  def?.definition || '',
          example:     def?.example    || '',
        })
      })
      .catch(() => {})
      .finally(() => setVocabLoading(false))
  }, [vocabWord])

  // ── Scroll progress ──────────────────────────────────────────────────────
  const saveProgress = useCallback(async () => {
    if (!chapter?.text || !chapterCount) return
    const totalH = document.documentElement.scrollHeight - window.innerHeight
    const ratio  = totalH > 0 ? Math.min(1, window.scrollY / totalH) : 0
    const charOffset = Math.round(ratio * chapter.text.length)
    await db.progress.put({ bookId, chapterId: chapterIndex, charOffset, updatedAt: Date.now() })
    await db.books.update(bookId, {
      progress:     Math.min(1, (chapterIndex + ratio) / chapterCount),
      lastOpenedAt: Date.now(),
    })
  }, [bookId, chapterIndex, chapterCount, chapter?.text])

  useEffect(() => {
    let timer
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(saveProgress, 900) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer) }
  }, [saveProgress])

  useEffect(() => {
    db.books.update(bookId, { lastOpenedAt: Date.now() })
    const t = setTimeout(saveProgress, 400)
    return () => clearTimeout(t)
  }, [bookId, chapterIndex])

  useEffect(() => {
    if (scrollRestoredRef.current || !savedProgress || !chapter) return
    if (savedProgress.chapterId !== chapterIndex || !savedProgress.charOffset) return
    scrollRestoredRef.current = true
    const ratio = savedProgress.charOffset / (chapter.text?.length || 1)
    setTimeout(() => {
      const totalH = document.documentElement.scrollHeight - window.innerHeight
      if (totalH > 0) window.scrollTo({ top: ratio * totalH, behavior: 'instant' })
    }, 150)
  }, [savedProgress, chapter, chapterIndex])

  // ── Sleep timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sleepEnd) return
    const iv = setInterval(() => {
      const rem = Math.max(0, Math.ceil((sleepEnd - Date.now()) / 1000))
      setSleepRemaining(rem)
      if (rem <= 0) {
        playerRef.current?.pause()
        setIsPlaying(false)
        setSleepEnd(null)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [sleepEnd])

  function handleSleepTimer() {
    if (sleepEnd) { setSleepEnd(null); return }
    const mins = getSetting('sleepTimerMinutes')
    setSleepEnd(Date.now() + mins * 60 * 1000)
  }

  // ── Listen time tracking (every 10s while playing) ────────────────────
  useEffect(() => {
    if (!isPlaying) return
    const iv = setInterval(async () => {
      const current = await db.books.get(bookId)
      await db.books.update(bookId, { listenedSeconds: (current?.listenedSeconds || 0) + 10 })
    }, 10_000)
    return () => clearInterval(iv)
  }, [isPlaying, bookId])

  // ── Chapter navigation ───────────────────────────────────────────────────
  function goToChapter(idx) {
    if (idx < 0 || (chapterCount > 0 && idx >= chapterCount)) return
    if (isPlaying) { playerRef.current?.pause(); setIsPlaying(false) }
    scrollRestoredRef.current = false
    window.scrollTo(0, 0)
    navigate(`/book/${id}/read?chapter=${idx}`)
  }

  useEffect(() => { customSelRef.current = customSel }, [customSel])

  // ── Custom long-press + drag selection (no native iOS blue highlight) ─────
  useEffect(() => {
    const el = document.querySelector('.rdrbody')
    if (!el) return

    function wiAt(x, y) {
      const t = document.elementFromPoint(x, y)?.closest('[data-wi]')
      return t ? Number(t.dataset.wi) : null
    }

    function onTouchStart(e) {
      const touch = e.touches[0]
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
      longPressRef.current  = setTimeout(() => {
        const wi = wiAt(touch.clientX, touch.clientY)
        if (wi == null) return
        selAnchorRef.current = wi
        setCustomSel({ minWi: wi, maxWi: wi })
        customSelRef.current = { minWi: wi, maxWi: wi }
        navigator.vibrate?.(25)
      }, 480)
    }

    function onTouchMove(e) {
      const touch = e.touches[0]
      const start = touchStartRef.current
      const moved = start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10
      if (moved && selAnchorRef.current == null) clearTimeout(longPressRef.current)
      if (selAnchorRef.current == null) return
      e.preventDefault()
      const wi = wiAt(touch.clientX, touch.clientY)
      if (wi == null) return
      const a   = selAnchorRef.current
      const sel = { minWi: Math.min(a, wi), maxWi: Math.max(a, wi) }
      setCustomSel(sel)
      customSelRef.current = sel
    }

    function onTouchEnd(e) {
      clearTimeout(longPressRef.current)
      if (selAnchorRef.current != null) return   // selection drag ended — user taps Highlight btn
      const ct      = e.changedTouches[0]
      const start   = touchStartRef.current
      const elapsed = Date.now() - (start?.t ?? 0)
      const moved   = start && Math.hypot(ct.clientX - start.x, ct.clientY - start.y) > 10
      touchStartRef.current = null
      // Quick tap while not in selection mode → open vocab
      if (elapsed < 480 && !moved && !customSelRef.current) {
        const wi = wiAt(ct.clientX, ct.clientY)
        if (wi == null) return
        for (const para of paraTokensRef.current) {
          const tok = para.tokens.find(t => typeof t === 'object' && t.i === wi)
          if (tok) { setVocabWord(tok.tok); setVocabPi(para.pi); break }
        }
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true  })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true  })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, [chapter?.id])   // re-run when chapter mounts so .rdrbody exists in DOM

  // Desktop: click on word → vocab (touch handled by addEventListener above)
  function handleMouseUp(e) {
    const wordEl = e.target.closest?.('[data-wi]')
    if (!wordEl) return
    const wi = Number(wordEl.dataset.wi)
    for (const para of paragraphTokens) {
      const tok = para.tokens.find(t => typeof t === 'object' && t.i === wi)
      if (tok) { setVocabWord(tok.tok); setVocabPi(para.pi); break }
    }
  }

  function getCustomSelText() {
    if (!customSel || !chapter?.text) return ''
    let s = Infinity, e = 0
    for (const para of paragraphTokens) {
      for (const t of para.tokens) {
        if (typeof t !== 'object' || t.i < customSel.minWi || t.i > customSel.maxWi) continue
        if (t.charStart < s) s = t.charStart
        if (t.charEnd   > e) e = t.charEnd
      }
    }
    return s < e ? chapter.text.slice(s, e).trim() : ''
  }

  async function saveHighlight() {
    const text = selectedText || vocabWord
    if (text) {
      await db.highlights.add({
        bookId, chapterId: chapterIndex,
        selectedText: text, colour: hlColor,
        note: noteText.trim(), createdAt: Date.now(),
      })
    }
    window.getSelection()?.removeAllRanges()
    setShowHlPanel(false)
    setSelectedText('')
    setNoteText('')
    setCustomSel(null)
    selAnchorRef.current = null
    customSelRef.current = null
  }

  // ── Bookmark ─────────────────────────────────────────────────────────────
  async function addBookmark() {
    const totalH = document.documentElement.scrollHeight - window.innerHeight
    const ratio  = totalH > 0 ? Math.min(1, window.scrollY / totalH) : 0
    const charOffset = Math.round(ratio * (chapter?.text?.length || 1))
    await db.bookmarks.add({
      bookId,
      chapterId:      chapterIndex,
      charOffset,
      audioTimestamp: audioReady ? currentTime : null,
      createdAt:      Date.now(),
    })
  }

  // ── Audio controls ───────────────────────────────────────────────────────
  function handlePlayPause() {
    if (!audioReady || !playerRef.current) return
    if (isPlaying) { playerRef.current.pause(); setIsPlaying(false) }
    else           { playerRef.current.play();  setIsPlaying(true)  }
  }

  function handleWaveformClick(e) {
    if (!audioReady || !audioDuration || !playerRef.current) return
    const rect  = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    playerRef.current.seek(ratio * audioDuration)
  }

  function handleSpeedToggle() {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    playerRef.current?.setSpeed(SPEEDS[next])
  }

  function handleSkip(delta) {
    if (!audioReady || !playerRef.current) return
    playerRef.current.seek(currentTime + delta)
  }

  // ── Paragraph tokens with char positions ────────────────────────────────
  const paragraphTokens = useMemo(() => {
    if (!chapter?.text) return []
    const text = chapter.text
    let wIdx = 0
    const result = []
    let pi = 0

    const sepRe = /\n\n+/g
    let lastIdx = 0
    let m

    const addPara = (para, paraStart) => {
      if (!para.trim()) return
      const isFirst    = pi === 0
      const dropChar   = isFirst ? para[0] : null
      const bodyOff    = isFirst ? 1 : 0
      const bodyStart  = paraStart + bodyOff
      const body       = para.slice(bodyOff)
      const tokens     = []
      const tokRe      = /(\S+|\s+)/g
      let tm
      while ((tm = tokRe.exec(body)) !== null) {
        const tok = tm[0]
        if (/^\s+$/.test(tok)) { tokens.push(tok); continue }
        const cs = bodyStart + tm.index
        tokens.push({ tok, i: wIdx++, charStart: cs, charEnd: cs + tok.length })
      }
      result.push({ pi, dropChar, tokens })
      pi++
    }

    while ((m = sepRe.exec(text)) !== null) {
      addPara(text.slice(lastIdx, m.index), lastIdx)
      lastIdx = m.index + m[0].length
    }
    addPara(text.slice(lastIdx), lastIdx)

    return result
  }, [chapter?.text])

  // Keep ref in sync so touch listeners (addEventListener closures) can read it
  useEffect(() => { paraTokensRef.current = paragraphTokens }, [paragraphTokens])

  // ── Highlight ranges ─────────────────────────────────────────────────────
  const hlRanges = useMemo(() => {
    if (!chapterHighlights?.length || !chapter?.text) return []
    const ranges = []
    for (const h of chapterHighlights) {
      const idx = chapter.text.indexOf(h.selectedText)
      if (idx >= 0) ranges.push({ start: idx, end: idx + h.selectedText.length, colour: h.colour })
    }
    return ranges
  }, [chapterHighlights, chapter?.text])

  function getHlClass(charStart, charEnd) {
    for (const r of hlRanges) {
      if (charStart < r.end && charEnd > r.start) return r.colour
    }
    return null
  }

  // ── Karaoke scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (activeWordIdx < 0) return
    const el = document.querySelector(`[data-wi="${activeWordIdx}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeWordIdx])

  const cursorBar = audioDuration > 0
    ? Math.min(BARS - 1, Math.floor((currentTime / audioDuration) * BARS))
    : 14

  const hasPrev = chapterIndex > 0
  const hasNext = chapterCount > 0 && chapterIndex < chapterCount - 1

  if (!book || !chapter) {
    return (
      <div className="reader-shell" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading…</span>
      </div>
    )
  }

  return (
    <div className="reader-shell">

      {/* ── Header ── */}
      <header className="rdrhdr">
        <button className="icon-btn icon-btn--ink" onClick={() => navigate(`/book/${id}`)} aria-label="Back">
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'center' }}>
          <button
            className="icon-btn icon-btn--ink"
            onClick={() => goToChapter(chapterIndex - 1)}
            style={{ opacity: hasPrev ? 1 : 0.25 }}
            aria-label="Previous chapter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="ch-lbl" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
            {chapter.title || `Ch. ${chapterIndex + 1}`}
            {chapterCount > 0 && <span style={{ opacity: 0.4, marginLeft: 4 }}>{chapterIndex + 1}/{chapterCount}</span>}
          </span>
          <button
            className="icon-btn icon-btn--ink"
            onClick={() => goToChapter(chapterIndex + 1)}
            style={{ opacity: hasNext ? 1 : 0.25 }}
            aria-label="Next chapter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button className="icon-btn icon-btn--ink" aria-label="Bookmark" onClick={addBookmark}>
            <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          </button>
          <button className="icon-btn icon-btn--ink" aria-label="Annotate" onClick={() => { setSelectedText(''); setShowHlPanel(true) }}>
            <svg viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
          </button>
        </div>
      </header>

      {/* ── Reader body ── */}
      <div className="rdrbody" style={{ fontSize: prefs.fontSize }} onMouseUp={handleMouseUp}>
        {paragraphTokens.length > 0
          ? paragraphTokens.map(({ pi, dropChar, tokens }) => (
              <p key={pi} className="rp">
                {dropChar && <span className="dropcap">{dropChar}</span>}
                {tokens.map((t, ti) => {
                  if (typeof t === 'string') return t
                  const hlCls  = getHlClass(t.charStart, t.charEnd)
                  const inSel  = customSel && t.i >= customSel.minWi && t.i <= customSel.maxWi
                  return (
                    <span
                      key={ti}
                      data-wi={t.i}
                      className={`word${t.i === activeWordIdx ? ' kara' : ''}${hlCls ? ' ' + hlCls : ''}${inSel ? ' custom-sel' : ''}`}
                    >
                      {t.tok}
                    </span>
                  )
                })}
              </p>
            ))
          : <p className="rp" style={{ color: 'var(--text-secondary)' }}>No text content yet.</p>
        }

        {hasNext && (
          <div className="ch-end-card" onClick={() => goToChapter(chapterIndex + 1)}>
            <div>
              <div className="ch-end-label">Up next</div>
              <div className="ch-end-title">
                {chapters?.[chapterIndex + 1]?.title || `Chapter ${chapterIndex + 2}`}
              </div>
            </div>
            <div className="ch-end-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </div>
          </div>
        )}
      </div>

      {/* ── Vocab popup ── */}
      {vocabWord && !showHlPanel && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 24 }} onClick={() => { setVocabWord(null); setVocabPi(null) }} />
          <div className="vocab-pop">
            <div className="vocab-hdr">
              <div className="vw">{vocabWord}</div>
              <button className="vocab-close-btn" onClick={() => { setVocabWord(null); setVocabPi(null) }} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {vocabDef?.phonetic && <div className="vphon">{vocabDef.phonetic}</div>}
            {vocabLoading && <div className="vd" style={{ opacity: 0.5 }}>Looking up…</div>}
            {!vocabLoading && vocabDef && (
              <>
                {vocabDef.partOfSpeech && <div className="vpos">{vocabDef.partOfSpeech}</div>}
                <div className="vd">{vocabDef.definition}</div>
                {vocabDef.example && <div className="vex">"{vocabDef.example}"</div>}
              </>
            )}
            {!vocabLoading && !vocabDef && <div className="vd" style={{ opacity: 0.5 }}>No definition found.</div>}
            <div className="vocab-actions">
              <div className="vs" onClick={async () => {
                await db.vocabulary.add({ word: vocabWord, bookId, chapterId: chapterIndex, createdAt: Date.now() })
                setVocabWord(null)
              }}>
                <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                Save to vocabulary
              </div>
              <div className="vs vs--hl" onClick={() => {
                const word = vocabWord
                setVocabWord(null); setVocabPi(null)
                setSelectedText(word)
                setShowHlPanel(true)
              }}>
                <svg viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                Highlight
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Custom selection confirm bar ── */}
      {customSel && !showHlPanel && (
        <div className="sel-confirm-bar">
          <button className="sel-cancel-btn" onPointerDown={e => {
            e.preventDefault()
            setCustomSel(null); selAnchorRef.current = null; customSelRef.current = null
          }}>Cancel</button>
          <button className="sel-hl-btn" onPointerDown={e => {
            e.preventDefault()
            const text = getCustomSelText()
            setCustomSel(null); selAnchorRef.current = null; customSelRef.current = null
            if (text) { setSelectedText(text); setVocabWord(null); setShowHlPanel(true) }
          }}>
            <svg viewBox="0 0 24 24"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            Highlight
          </button>
        </div>
      )}

      {/* ── Audio player ── */}
      <div className="player">
        <div className="pl-row">
          <div className="pl-mini-cover">
            {book.cover && <img src={book.cover} alt={book.title} />}
          </div>
          <div className="pl-info">
            <h4>{book.title}</h4>
            <p>{chapter.title || `Ch. ${chapterIndex + 1}`}</p>
          </div>
          {audioReady
            ? <div className="sync-badge"><div className="sync-dot" />SYNCED</div>
            : chapter.audioStatus === 'ready'
              ? <div className="sync-badge" style={{ opacity: 0.5 }}>Loading…</div>
              : <div className="sync-badge" style={{ opacity: 0.4, fontSize: 9 }}>NO AUDIO</div>
          }
        </div>

        <div
          className="waveform"
          style={{ cursor: audioReady ? 'pointer' : 'default' }}
          onClick={handleWaveformClick}
        >
          {waveform.map((h, i) => (
            <div
              key={i}
              className={`wb${i < cursorBar ? ' wb--played' : i === cursorBar ? ' wb--cursor' : ''}`}
              style={{ height: `${Math.round(h * 22) + 4}px` }}
            />
          ))}
        </div>

        <div className="pl-time">
          <span>{fmtTime(currentTime)}</span>
          <span>{audioDuration > 0 ? fmtTime(audioDuration) : '—:——'}</span>
        </div>

        <div className="pl-ctrl">
          <button className="ctrl" aria-label="Skip back 15s" onClick={() => handleSkip(-15)}>
            <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.65)">
              <path d="M12.5 5C8.4 5 5 8.4 5 12.5H3L6.3 16l3.3-3.5H7.5C7.5 9.5 9.8 7 12.8 7s5.3 2.5 5.3 5.5-2.3 5.5-5.3 5.5c-1.7 0-3.1-.7-4.1-1.9l-1.4 1.4C8.7 19 10.6 20 12.8 20c4.1 0 7.2-3.4 7.2-7.5S16.9 5 12.5 5z" />
              <text x="9.5" y="14.5" fontSize="5" fontFamily="DM Sans,sans-serif" fill="rgba(255,255,255,0.65)" fontWeight="600">15</text>
            </svg>
          </button>

          <button className="ctrl" aria-label="Previous chapter" onClick={() => goToChapter(chapterIndex - 1)} style={{ opacity: hasPrev ? 1 : 0.3 }}>
            <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.65)"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </button>

          <button
            className="playbtn"
            onClick={handlePlayPause}
            style={{ opacity: audioReady ? 1 : 0.4 }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <svg viewBox="0 0 24 24" fill="var(--moss)"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              : <svg viewBox="0 0 24 24" fill="var(--moss)"><path d="M5 3l14 9-14 9V3z" /></svg>
            }
          </button>

          <button className="ctrl" aria-label="Next chapter" onClick={() => goToChapter(chapterIndex + 1)} style={{ opacity: hasNext ? 1 : 0.3 }}>
            <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.65)"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </button>

          <button className="spdbadge" onClick={handleSpeedToggle} aria-label="Playback speed">
            {SPEEDS[speedIdx]}×
          </button>

          <button
            className={`ctrl sleep-ctrl${sleepEnd ? ' sleep-ctrl--on' : ''}`}
            onClick={handleSleepTimer}
            aria-label={sleepEnd ? 'Cancel sleep timer' : 'Start sleep timer'}
          >
            {sleepEnd
              ? <span className="sleep-remaining">{Math.ceil(sleepRemaining / 60)}m</span>
              : <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.55)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            }
          </button>
        </div>
      </div>

      {/* ── Reader bottom nav ── */}
      <nav className="reader-nav">
        {READER_NAV.map(({ id: navId, label, icon, back }) => (
          <button
            key={navId}
            className={`reader-nav__item${activeNav === navId || (navId === 'notes' && showNotesPanel) ? ' reader-nav__item--active' : ''}`}
            onClick={() => {
              if (back) { navigate(`/book/${id}`); return }
              if (navId === 'notes') { setShowNotesPanel(v => !v); return }
              setActiveNav(navId)
              setShowNotesPanel(false)
            }}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* ── Annotation panel ── */}
      {showHlPanel && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => { setShowHlPanel(false); window.getSelection()?.removeAllRanges() }} />
          <div className="hl-panel">
            <div className="ph" />
            <div className="hl-title">Annotate</div>
            <div className="hl-sub">
              {selectedText ? `${selectedText.length} characters selected` : vocabWord ? `"${vocabWord}"` : 'Select text in the reader to highlight it.'}
            </div>
            {(selectedText || vocabWord) && <div className="sel-txt">{selectedText || vocabWord}</div>}
            <div className="color-row">
              {HL_COLORS.map(({ cls, bg }) => (
                <div key={cls} className={`cc${hlColor === cls ? ' on' : ''}`} style={{ background: bg }} onClick={() => setHlColor(cls)}>
                  {hlColor === cls && <svg viewBox="0 0 12 12" stroke="white" fill="none" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </div>
              ))}
            </div>
            <textarea className="note-ta" placeholder="Add a note (optional)…" value={noteText} onChange={e => setNoteText(e.target.value)} />
            <button className="save-btn" onClick={saveHighlight}>
              <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              Save highlight
            </button>
            <div className="ts-note">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              <span>Ch. {chapterIndex + 1} of {chapterCount || '…'}</span>
            </div>
          </div>
        </>
      )}

      {/* ── Notes panel ── */}
      {showNotesPanel && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setShowNotesPanel(false)} />
          <div className="notes-panel">
            <div className="ph" />
            <div className="hl-title">Notes & Highlights</div>

            {!allHighlights?.length && !allBookmarks?.length && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>
                No notes yet. Select text to highlight or use the bookmark button to save your place.
              </p>
            )}

            {allHighlights?.length > 0 && (
              <div className="notes-section">
                <div className="notes-section-lbl">Highlights</div>
                {allHighlights.map(h => (
                  <div key={h.id} className="note-item"
                    onClick={() => { setShowNotesPanel(false); navigate(`/book/${id}/read?chapter=${h.chapterId}`) }}
                  >
                    <div className={`note-bar ${h.colour}`} />
                    <div className="note-body">
                      <div className="note-quote">"{h.selectedText}"</div>
                      {h.note && <div className="note-annotation">{h.note}</div>}
                      <div className="note-meta">Ch. {h.chapterId + 1}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {allBookmarks?.length > 0 && (
              <div className="notes-section">
                <div className="notes-section-lbl">Bookmarks</div>
                {allBookmarks.map(b => (
                  <div key={b.id} className="note-item"
                    onClick={() => { setShowNotesPanel(false); navigate(`/book/${id}/read?chapter=${b.chapterId}`) }}
                  >
                    <div className="note-bm-ico">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--moss)" stroke="none">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div className="note-body">
                      <div className="note-meta">Ch. {b.chapterId + 1}
                        {b.audioTimestamp != null && <span style={{ marginLeft: 8 }}>· {fmtTime(b.audioTimestamp)}</span>}
                      </div>
                      {b.note && <div className="note-annotation">{b.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
