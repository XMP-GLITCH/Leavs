import { db } from '../db/db'

// ── Chapter detection ────────────────────────────────────────────────────────
const CH_BREAK = /^(?:chapter|ch\.?|part|section|book)\s+(?:\d+|[ivxlcdm]+)[^\n]*/im

function splitChapters(text) {
  const lines  = text.split('\n')
  const breaks = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line && CH_BREAK.test(line)) breaks.push(i)
  }
  if (breaks.length < 2) return [{ title: 'Chapter 1', text: text.trim() }]
  return breaks.map((start, idx) => {
    const end      = breaks[idx + 1] ?? lines.length
    const headLine = lines[start].trim()
    const body     = lines.slice(start + 1, end).join('\n').trim()
    return { title: headLine || `Chapter ${idx + 1}`, text: body }
  }).filter(ch => ch.text.length > 80)
}

// ── TXT ──────────────────────────────────────────────────────────────────────
async function parseTXT(file) {
  const text = await file.text()
  const name = file.name.replace(/\.[^.]+$/, '')
  return { title: name, author: 'Unknown', chapters: splitChapters(text) }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
async function parsePDF(file, onProgress) {
  onProgress?.('Loading PDF reader…')
  const pdfjs = await import('pdfjs-dist')

  // Worker served from same origin (client/public/) — no CDN, works offline
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  onProgress?.('Reading PDF…')
  const arrayBuffer = await file.arrayBuffer()
  const pdf  = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const meta = await pdf.getMetadata().catch(() => ({}))

  const title  = meta.info?.Title  || file.name.replace(/\.[^.]+$/, '')
  const author = meta.info?.Author || 'Unknown'

  const pageTexts = []
  for (let p = 1; p <= pdf.numPages; p++) {
    if (p % 10 === 0) onProgress?.(`Reading page ${p} of ${pdf.numPages}…`)
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map(it => it.str).join(' '))
  }

  return { title, author, chapters: splitChapters(pageTexts.join('\n\n')) }
}

// ── EPUB ─────────────────────────────────────────────────────────────────────
async function parseEPUB(file, onProgress) {
  onProgress?.('Loading EPUB reader…')
  const epubMod = await import('epubjs')
  const ePub    = epubMod.default ?? epubMod

  if (typeof ePub !== 'function') throw new Error('epub.js failed to load — try a PDF or TXT instead')

  onProgress?.('Reading EPUB…')
  const arrayBuffer = await file.arrayBuffer()
  const book = ePub(arrayBuffer)
  await book.ready

  const meta   = await book.loaded.metadata
  const title  = meta.title   || file.name.replace(/\.[^.]+$/, '')
  const author = meta.creator || 'Unknown'

  await book.spine.ready.catch(() => {})
  const spineItems = book.spine.spineItems ?? book.spine.items ?? []

  const chapters = []
  for (const item of spineItems) {
    try {
      const doc  = await item.load(book.load.bind(book))
      if (!doc) continue
      const body = doc.body ?? doc.documentElement
      const text = body?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (text.length < 80) continue
      const heading = doc.querySelector?.('h1,h2,h3')?.textContent?.trim()
      chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text })
    } catch { continue }
  }

  return {
    title,
    author,
    chapters: chapters.length
      ? chapters
      : [{ title: 'Chapter 1', text: 'Could not extract text from this EPUB.' }],
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function ingestFile(file, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase()

  // 90-second hard timeout — prevents infinite spinner on mobile
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Import timed out — file may be too large. Try a smaller file or TXT format.')), 90_000)
  )

  async function doIngest() {
    onProgress?.('Reading file…')
    let parsed
    if      (ext === 'pdf')  parsed = await parsePDF(file, onProgress)
    else if (ext === 'epub') parsed = await parseEPUB(file, onProgress)
    else if (ext === 'txt')  parsed = await parseTXT(file)
    else throw new Error(`Unsupported format: .${ext} — use PDF, EPUB, or TXT`)

    onProgress?.(`Saving "${parsed.title}"…`)

    const bookId = await db.books.add({
      title:        parsed.title,
      author:       parsed.author,
      progress:     0,
      mode:         'read',
      addedAt:      Date.now(),
      lastOpenedAt: Date.now(),
    })

    const total = parsed.chapters.length
    for (let i = 0; i < total; i++) {
      await db.chapters.add({
        bookId,
        index:       i,
        title:       parsed.chapters[i].title,
        text:        parsed.chapters[i].text,
        audioStatus: 'none',
      })
      onProgress?.(`Saving chapter ${i + 1} of ${total}…`)
    }

    return bookId
  }

  return Promise.race([doIngest(), timeout])
}
