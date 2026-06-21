import { db } from '../db/db'

// ── Chapter detection ────────────────────────────────────────────────────────
const CH_BREAK = /^(?:chapter|ch\.?|part|section|book)\s+(?:\d+|[ivxlcdm]+)[^\n]*/im

function splitChapters(text) {
  const lines = text.split('\n')
  const breaks = [] // indices of lines that start a chapter

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line && CH_BREAK.test(line)) breaks.push(i)
  }

  if (breaks.length < 2) {
    // No chapter structure — treat whole file as one chapter
    return [{ title: 'Chapter 1', text: text.trim() }]
  }

  return breaks.map((start, idx) => {
    const end = breaks[idx + 1] ?? lines.length
    const headLine = lines[start].trim()
    const body = lines.slice(start + 1, end).join('\n').trim()
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
async function parsePDF(file) {
  const pdfjs = await import('pdfjs-dist')
  // Use jsDelivr CDN worker — matched to installed version, cached after first load
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const meta = await pdf.getMetadata().catch(() => ({}))

  const title  = meta.info?.Title  || file.name.replace(/\.[^.]+$/, '')
  const author = meta.info?.Author || 'Unknown'

  const pageTexts = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map(it => it.str).join(' '))
  }

  return { title, author, chapters: splitChapters(pageTexts.join('\n\n')) }
}

// ── EPUB ─────────────────────────────────────────────────────────────────────
async function parseEPUB(file) {
  const { default: ePub } = await import('epubjs')

  const blob = new Blob([await file.arrayBuffer()], { type: 'application/epub+zip' })
  const url  = URL.createObjectURL(blob)

  const book = ePub(url)
  await book.ready

  const meta   = await book.loaded.metadata
  const title  = meta.title   || file.name.replace(/\.[^.]+$/, '')
  const author = meta.creator || 'Unknown'

  const chapters = []
  const items    = []
  book.spine.each(item => items.push(item))

  for (const item of items) {
    const doc = await item.load(book.load.bind(book)).catch(() => null)
    if (!doc) continue
    const text = (doc.body || doc.documentElement)?.textContent
      ?.replace(/\s+/g, ' ')
      .trim()
    if (!text || text.length < 80) continue
    const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim()
    chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text })
  }

  URL.revokeObjectURL(url)

  return {
    title,
    author,
    chapters: chapters.length ? chapters : [{ title: 'Chapter 1', text: 'Could not extract text from this EPUB.' }],
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function ingestFile(file, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase()

  onProgress?.('Reading file…')
  let parsed
  if      (ext === 'pdf')  parsed = await parsePDF(file)
  else if (ext === 'epub') parsed = await parseEPUB(file)
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
    const ch = parsed.chapters[i]
    await db.chapters.add({
      bookId,
      index:       i,
      title:       ch.title,
      text:        ch.text,
      audioStatus: 'none',
    })
    onProgress?.(`Saving chapter ${i + 1} of ${total}…`)
  }

  return bookId
}
