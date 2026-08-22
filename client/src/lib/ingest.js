import { db }   from '../db/db'
import JSZip     from 'jszip'
import { getSetting } from '../utils/settings'

// FileReader wrappers — file.arrayBuffer() and file.text() only landed in
// Safari 14.1 (iOS 14.5). FileReader works all the way back to iOS 5.
function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
}
function readText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

// ── Chapter detection ────────────────────────────────────────────────────────
const CH_BREAK = /^(?:chapter|ch\.?|part|section|book)\s+(?:\d+|[ivxlcdm]+)[^\n]*/im

// Below this a section is folded into the previous one rather than standing alone.
const MIN_CHAPTER_CHARS = 80

function splitChapters(text) {
  const lines  = text.split('\n')
  const breaks = []
  for (let i = 0; i < lines.length; i++) {
    if (CH_BREAK.test(lines[i].trim())) breaks.push(i)
  }

  if (breaks.length < 2) {
    const body = text.trim()
    return [{ title: 'Chapter 1', text: body || '[No readable text found in this file. It may be image-based or a scanned document.]' }]
  }

  const chunks = []

  // Text before the first heading is real content — a preface, an introduction,
  // or simply a document whose headings start late. It used to be dropped.
  const front = lines.slice(0, breaks[0]).join('\n').trim()
  if (front.length > MIN_CHAPTER_CHARS) chunks.push({ title: 'Front matter', text: front })

  for (let idx = 0; idx < breaks.length; idx++) {
    const start = breaks[idx]
    const end   = breaks[idx + 1] ?? lines.length
    const title = lines[start].trim() || `Chapter ${idx + 1}`
    const body  = lines.slice(start + 1, end).join('\n').trim()

    // A section too short to stand alone is folded into the previous one,
    // heading and all. Filtering these out threw the text away entirely — a
    // contents page or a run of short scenes could vanish from a book.
    if (body.length <= MIN_CHAPTER_CHARS && chunks.length) {
      chunks[chunks.length - 1].text += `\n\n${title}` + (body ? `\n\n${body}` : '')
      continue
    }
    chunks.push({ title, text: body })
  }

  return chunks.length
    ? chunks
    : [{ title: 'Chapter 1', text: text.trim() || '[No readable text found.]' }]
}

// ── TXT ──────────────────────────────────────────────────────────────────────
async function parseTXT(file) {
  const text = await readText(file)
  return { title: file.name.replace(/\.[^.]+$/, ''), author: 'Unknown', cover: null, chapters: splitChapters(text) }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const OCR_PAGE_LIMIT = 200  // max pages to OCR in one import

// Turn a pdf.js text-content object into text that keeps its shape.
//
// items.map(it => it.str).join(' ') threw away every line break in the
// document, so a PDF arrived as one continuous run and the reader drew the
// whole book as a single paragraph. pdf.js flags line ends with hasEOL; the
// vertical position of each item tells us where a PARAGRAPH ends, since a
// paragraph gap is markedly larger than normal leading.
function pageToText(content) {
  const items = content.items.filter(it => typeof it.str === "string")
  if (!items.length) return ""

  // Typical line-to-line drop, measured rather than assumed: font sizes vary
  // between documents and between sections of one document.
  const drops = []
  for (let k = 1; k < items.length; k++) {
    const a = items[k - 1].transform?.[5], b = items[k].transform?.[5]
    if (a == null || b == null) continue
    const d = a - b
    if (d > 0.5) drops.push(d)
  }
  drops.sort((x, y) => x - y)
  const typical = drops.length ? drops[Math.floor(drops.length / 2)] : 0

  let out = ""
  let prevY = null
  for (const it of items) {
    const y = it.transform?.[5]
    if (prevY != null && y != null) {
      const drop = prevY - y
      // Anything appreciably beyond one line of leading reads as a new block.
      if (typical && drop > typical * 1.6) out += "\n\n"
    }
    out += it.str
    if (it.hasEOL) out += "\n"
    if (y != null) prevY = y
  }
  return out
}

async function parsePDF(file, onProgress, ctl) {
  onProgress?.('Loading PDF reader…')

  let pdfjsMod
  try { pdfjsMod = await import('pdfjs-dist') }
  catch (e) { throw new Error(`Step[pdf-load]: ${e.message}`) }

  const pdfjs = pdfjsMod.default ?? pdfjsMod
  if (typeof pdfjs.getDocument !== 'function')
    throw new Error(`Step[pdf-api]: getDocument is ${typeof pdfjs.getDocument} — try TXT`)

  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  onProgress?.('Reading PDF…')
  let arrayBuffer
  try { arrayBuffer = await readArrayBuffer(file) }
  catch (e) { throw new Error(`Step[pdf-read]: ${e.message}`) }

  let pdf
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise }
  catch (e) {
    // pdf.js throws typed exceptions here. Passing the raw message through
    // meant a password-protected book and a half-downloaded file produced
    // the same unhelpful string.
    if (e?.name === 'PasswordException')
      throw new Error('This PDF is password-protected. Remove the password (open it and re-save, or print to PDF) and import again.')
    if (e?.name === 'InvalidPDFException')
      throw new Error('This file is not a readable PDF. It may be damaged, or the download may have stopped partway.')
    if (e?.name === 'MissingPDFException')
      throw new Error('The PDF could not be read — the file appears to be empty.')
    throw new Error(`Step[pdf-open]: ${e.message}`)
  }

  // Text extraction is roughly linear in page count, and the default 90s
  // budget is a flat guess that quietly killed long books partway through —
  // reported to the reader as "Import timed out", which sounds like a bug.
  // Phones are several times slower than a laptop here, so budget generously.
  ctl?.extendTimeout(Math.min(60_000 + pdf.numPages * 600, 900_000))

  const meta   = await pdf.getMetadata().catch(() => ({}))
  const title  = meta.info?.Title  || file.name.replace(/\.[^.]+$/, '')
  const author = meta.info?.Author || 'Unknown'

  // ── Step 1: try text layer extraction ──────────────────────────────────────
  const pageTexts = []
  let failedPages = 0
  for (let p = 1; p <= pdf.numPages; p++) {
    if (ctl?.isCancelled()) throw new Error('Import cancelled')
    if (p % 10 === 0) onProgress?.(`Reading page ${p} of ${pdf.numPages}…`)
    try {
      const page    = await pdf.getPage(p)
      const content = await page.getTextContent()
      pageTexts.push(pageToText(content))
    } catch { pageTexts.push(''); failedPages++ }
  }

  // Every single page throwing means the document is structurally broken, not
  // merely image-based — OCR would render 300 blank canvases and take minutes
  // to conclude nothing.
  if (pdf.numPages > 0 && failedPages === pdf.numPages)
    throw new Error('None of this PDF could be read — every page failed to load. The file is most likely damaged or incomplete.')

  const totalChars   = pageTexts.reduce((s, t) => s + t.trim().length, 0)
  const avgCharsPage = pdf.numPages > 0 ? totalChars / pdf.numPages : 0

  // ── Step 2: if text is sparse, fall back to OCR ────────────────────────────
  if (avgCharsPage < 50) {
    onProgress?.('Scanned PDF detected — loading OCR engine…')
    try {
      const { createWorker } = await import('tesseract.js')

      const pagesToOcr = Math.min(pdf.numPages, OCR_PAGE_LIMIT)
      if (pdf.numPages > OCR_PAGE_LIMIT)
        onProgress?.(`Large document — OCR limited to first ${OCR_PAGE_LIMIT} pages…`)

      // OCR is slow — give it a real time budget instead of the default 90s
      ctl?.extendTimeout(Math.min(120_000 + pagesToOcr * 15_000, 1_500_000))

      const CONCURRENCY = 3
      const workers = await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, pagesToOcr) }, () => createWorker('eng'))
      )

      // Render + OCR page by page in a rolling queue — never hold more than
      // one canvas per worker in memory (rendering all pages upfront needs
      // gigabytes on large scans and crashes mobile browsers).
      const ocrTexts = new Array(pagesToOcr).fill('')
      let nextPage = 0
      let done     = 0

      async function runWorker(worker) {
        while (true) {
          const p = nextPage++
          if (p >= pagesToOcr || ctl?.isCancelled()) return
          const page     = await pdf.getPage(p + 1)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas   = document.createElement('canvas')
          canvas.width   = viewport.width
          canvas.height  = viewport.height
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          const { data: { text } } = await worker.recognize(canvas)
          canvas.width = canvas.height = 0  // release the bitmap immediately
          ocrTexts[p] = text
          done++
          onProgress?.(`OCR ${done} of ${pagesToOcr} pages…`)
        }
      }

      try {
        await Promise.all(workers.map(runWorker))
      } finally {
        await Promise.all(workers.map(w => w.terminate().catch(() => {})))
      }

      if (ctl?.isCancelled()) throw new Error('Import cancelled')
      return { title, author, cover: null, chapters: splitChapters(ocrTexts.join('\n\n')) }
    } catch (e) {
      if (e.message === 'Import cancelled') throw e
      // OCR unavailable (offline or blocked) — store with a clear placeholder
      const msg = e.message?.includes('fetch') || e.message?.includes('network')
        ? '[OCR requires an internet connection on first use to download the language model. Connect and re-import this file.]'
        : `[This PDF is image-based (scanned) and OCR failed: ${e.message}.${failedPages ? ` ${failedPages} of ${pdf.numPages} pages also failed to load.` : ''} Try converting it to EPUB, or to a searchable PDF, first.]`
      return { title, author, cover: null, chapters: [{ title: 'Chapter 1', text: msg }] }
    }
  }

  return { title, author, cover: null, chapters: splitChapters(pageTexts.join('\n\n')) }
}

// ── DOCX ─────────────────────────────────────────────────────────────────────
async function parseDOCX(file, onProgress) {
  onProgress?.('Unzipping document…')

  let arrayBuffer
  try { arrayBuffer = await readArrayBuffer(file) }
  catch (e) { throw new Error(`Step[docx-read]: ${e.message}`) }

  let zip
  try { zip = await JSZip.loadAsync(arrayBuffer) }
  catch (e) { throw new Error(`Step[docx-unzip]: ${e.message}`) }

  let title  = file.name.replace(/\.[^.]+$/, '')
  let author = 'Unknown'
  try {
    const coreXml = await zip.file('docProps/core.xml')?.async('text')
    if (coreXml) {
      const doc = new DOMParser().parseFromString(coreXml, 'text/xml')
      title  = doc.querySelector('title')?.textContent?.trim()   || title
      author = doc.querySelector('creator')?.textContent?.trim() || author
    }
  } catch { /* metadata optional */ }

  let docXml
  try { docXml = await zip.file('word/document.xml')?.async('text') }
  catch (e) { throw new Error(`Step[docx-content]: ${e.message}`) }
  if (!docXml) throw new Error('Step[docx-content]: word/document.xml not found — may not be a .docx file')

  // Extract per PARAGRAPH (<w:p>), not per text run (<w:t>).
  //
  // Joining every run into one string and collapsing \s+ to a single space
  // destroyed the line structure — and splitChapters() finds headings by
  // scanning lines, so every DOCX imported as a single chapter no matter how
  // it was written. <w:p\b> deliberately does not match <w:pPr> (properties).
  const paras = [...docXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(([, p]) =>
      [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map(m => m[1])
        .join('')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter(Boolean)

  // Fall back to the old flat extraction if the document uses no <w:p> at all.
  const fullText = paras.length
    ? paras.join('\n\n')
    : [...docXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join(' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim()

  if (!fullText || fullText.length < 20)
    return { title, author, cover: null, chapters: [{ title: 'Document', text: '[Could not extract text from this document. It may be image-based or use unsupported formatting.]' }] }

  return { title, author, cover: null, chapters: splitChapters(fullText) }
}

// ── PPTX ─────────────────────────────────────────────────────────────────────
async function parsePPTX(file, onProgress) {
  onProgress?.('Unzipping presentation…')

  let arrayBuffer
  try { arrayBuffer = await readArrayBuffer(file) }
  catch (e) { throw new Error(`Step[pptx-read]: ${e.message}`) }

  let zip
  try { zip = await JSZip.loadAsync(arrayBuffer) }
  catch (e) { throw new Error(`Step[pptx-unzip]: ${e.message}`) }

  // Metadata from docProps/core.xml
  let title  = file.name.replace(/\.[^.]+$/, '')
  let author = 'Unknown'
  try {
    const coreXml = await zip.file('docProps/core.xml')?.async('text')
    if (coreXml) {
      const coreDoc = new DOMParser().parseFromString(coreXml, 'text/xml')
      title  = coreDoc.querySelector('title')?.textContent?.trim()   || title
      author = coreDoc.querySelector('creator')?.textContent?.trim() || author
    }
  } catch { /* metadata optional */ }

  // Collect slide files in order
  const slideFiles = Object.keys(zip.files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const n = s => parseInt(s.match(/(\d+)\.xml$/)?.[1] ?? '0')
      return n(a) - n(b)
    })

  if (!slideFiles.length) throw new Error('Step[pptx-slides]: no slide XML files found — file may be corrupt or unsupported')

  const chapters = []
  for (let i = 0; i < slideFiles.length; i++) {
    if (i % 10 === 0) onProgress?.(`Reading slide ${i + 1} of ${slideFiles.length}…`)
    try {
      const xml = await zip.file(slideFiles[i])?.async('text')
      if (!xml) continue
      // Extract text runs via regex — avoids namespace issues across browsers
      const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m => m[1]).filter(Boolean)
      const text  = texts.join(' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim()
      if (text.length < 3) continue
      chapters.push({ title: `Slide ${i + 1}`, text })
    } catch { continue }
  }

  return {
    title,
    author,
    cover: null,
    chapters: chapters.length
      ? chapters
      : [{ title: 'Slide 1', text: '[Could not extract text from this presentation. It may be image-based.]' }],
  }
}

// ── Block-aware text extraction ──────────────────────────────────────────────
// body.textContent flattens every block element into one run, and collapsing
// \s+ afterwards destroys what is left. The reader splits paragraphs on
// \n\n, so the result was an entire book rendered as ONE paragraph — a
// single <p> holding tens of thousands of word spans.
//
// Leaf blocks only (p, headings, li, …): selecting containers too would emit
// every paragraph twice, once inside its wrapper.
const LEAF_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt,figcaption'

function blocksToText(root) {
  const pick = sel => [...root.querySelectorAll(sel)]
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  let parts = pick(LEAF_BLOCKS)

  // Some EPUBs wrap everything in bare <div>s and use no <p> at all. If the
  // leaf blocks account for well under the document text, fall back to divs.
  const whole = (root.textContent || '').replace(/\s+/g, ' ').trim()
  if (parts.join(' ').length < whole.length * 0.5) {
    const divs = pick('div')
    if (divs.join(' ').length > parts.join(' ').length) parts = divs
  }

  // Last resort: no usable blocks, keep the flat text rather than lose it.
  return parts.length ? parts.join('\n\n') : whole
}

// ── EPUB cover extraction ─────────────────────────────────────────────────────
async function extractEpubCover(zip, opfDoc, opfDir) {
  let coverHref = null

  // Method 1: <meta name="cover" content="manifest-item-id">
  let coverId = null
  for (const el of opfDoc.querySelectorAll('meta')) {
    if (el.getAttribute('name') === 'cover') { coverId = el.getAttribute('content'); break }
  }
  if (coverId) {
    for (const el of opfDoc.querySelectorAll('item')) {
      if (el.getAttribute('id') === coverId) { coverHref = el.getAttribute('href'); break }
    }
  }

  // Method 2: <item properties="cover-image ...">
  if (!coverHref) {
    for (const el of opfDoc.querySelectorAll('item')) {
      const props = el.getAttribute('properties') || ''
      if (props.includes('cover-image')) { coverHref = el.getAttribute('href'); break }
    }
  }

  if (!coverHref) return null

  try {
    const fullPath = (opfDir + coverHref).replace(/\/\//g, '/')
    const data = await zip.file(fullPath)?.async('uint8array')
    if (!data) return null
    // Skip covers larger than 300 KB to keep IndexedDB lean
    if (data.length > 300_000) return null
    const ext  = coverHref.split('.').pop().toLowerCase()
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] ?? 'image/jpeg'
    return await blobToDataUrl(new Blob([data], { type: mime }))
  } catch {
    return null
  }
}

// ── EPUB — JSZip + DOMParser (no epub.js) ────────────────────────────────────
async function parseEPUB(file, onProgress) {
  onProgress?.('Unzipping EPUB…')

  if (typeof JSZip?.loadAsync !== 'function')
    throw new Error(`Step[epub-jszip]: JSZip.loadAsync is ${typeof JSZip?.loadAsync}`)

  let arrayBuffer
  try { arrayBuffer = await readArrayBuffer(file) }
  catch (e) { throw new Error(`Step[epub-read]: ${e.message}`) }

  let zip
  try { zip = await JSZip.loadAsync(arrayBuffer) }
  catch (e) { throw new Error(`Step[epub-unzip]: ${e.message}`) }

  // 1. container.xml → OPF path
  let containerXml
  try { containerXml = await zip.file('META-INF/container.xml')?.async('text') }
  catch (e) { throw new Error(`Step[epub-container]: ${e.message}`) }
  if (!containerXml) throw new Error('Step[epub-container]: missing META-INF/container.xml')

  const parser  = new DOMParser()
  const contDoc = parser.parseFromString(containerXml, 'text/xml')
  const opfPath = contDoc.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('Step[epub-opf-path]: no rootfile element')

  // 2. OPF → metadata + spine
  let opfXml
  try { opfXml = await zip.file(opfPath)?.async('text') }
  catch (e) { throw new Error(`Step[epub-opf-read]: ${e.message}`) }
  if (!opfXml) throw new Error(`Step[epub-opf-read]: OPF not found at ${opfPath}`)

  const opfDoc  = parser.parseFromString(opfXml, 'text/xml')
  const metaEl  = opfDoc.querySelector('metadata')
  const title   = metaEl?.querySelector('title')?.textContent?.trim()
              || file.name.replace(/\.[^.]+$/, '')
  const author  = metaEl?.querySelector('creator')?.textContent?.trim() || 'Unknown'

  const opfDir  = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  // 3. Extract cover image (before spine, so we always try even if spine fails)
  const cover = await extractEpubCover(zip, opfDoc, opfDir).catch(() => null)

  const manifest = {}
  opfDoc.querySelectorAll('item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href')
  })

  const spineHrefs = [...opfDoc.querySelectorAll('itemref')]
    .map(ref => manifest[ref.getAttribute('idref')])
    .filter(Boolean)

  if (spineHrefs.length === 0) throw new Error('Step[epub-spine]: no spine items found')

  // 4. Extract text from each spine file
  const chapters = []
  for (let i = 0; i < spineHrefs.length; i++) {
    if (i % 5 === 0) onProgress?.(`Reading chapter ${i + 1} of ${spineHrefs.length}…`)
    try {
      const path = opfDir + spineHrefs[i].split('#')[0]
      const html = await zip.file(path)?.async('text')
      if (!html) continue
      const doc = parser.parseFromString(html, 'text/html')
      doc.querySelectorAll('script,style,nav').forEach(el => el.remove())
      // Replace <img> with a placeholder so inline images aren't silently lost
      doc.querySelectorAll('img').forEach(img => {
        const alt = img.getAttribute('alt')
        const span = doc.createElement('span')
        span.textContent = alt ? ` [image: ${alt}] ` : ' [image] '
        img.replaceWith(span)
      })
      const text = doc.body ? blocksToText(doc.body) : ''
      // Any length threshold here loses real content — 80 discarded one-page
      // chapters, 20 still discarded "For my mother." Skip only what is
      // genuinely empty and let the chapter logic fold short pieces together.
      if (!text.trim()) continue
      const heading = doc.querySelector('h1,h2,h3')?.textContent?.replace(/\s+/g, ' ').trim()
      // One spine item frequently holds many chapters — Gutenberg builds its
      // EPUBs that way, which is why a 61-chapter novel used to import as 15
      // sections with captions for titles. Now that the text keeps its line
      // structure, splitChapters can actually find the headings.
      const inner = splitChapters(text)
      if (inner.length > 1) chapters.push(...inner)
      else chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text })
    } catch { continue }
  }

  return {
    title,
    author,
    cover,
    chapters: chapters.length
      ? chapters
      : [{ title: 'Chapter 1', text: '[Could not extract text from this EPUB. It may be image-based or DRM-protected.]' }],
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────
export async function ingestFile(file, onProgress) {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()

  // Cancellable timeout: when it fires, the parse loops see the flag and abort
  // instead of finishing in the background and saving a ghost book. Slow steps
  // (OCR) can extend the deadline to a budget that matches the work.
  let cancelled = false
  let timer     = null
  let armTimer  = null
  const timeout = new Promise((_, reject) => {
    armTimer = ms => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        cancelled = true
        reject(new Error('Import timed out — try a smaller file or TXT format.'))
      }, ms)
    }
    armTimer(90_000)
  })
  const ctl = {
    isCancelled:   () => cancelled,
    extendTimeout: ms => armTimer?.(ms),
  }

  async function doIngest() {
    onProgress?.('Reading file…')

    let parsed
    if      (ext === 'pdf')  parsed = await parsePDF(file, onProgress, ctl)
    else if (ext === 'epub') parsed = await parseEPUB(file, onProgress)
    else if (ext === 'txt')  parsed = await parseTXT(file)
    else if (ext === 'pptx') parsed = await parsePPTX(file, onProgress)
    else if (ext === 'docx') parsed = await parseDOCX(file, onProgress)
    else throw new Error(`Unsupported format .${ext} — use PDF, EPUB, DOCX, PPTX or TXT`)

    if (cancelled) throw new Error('Import cancelled')

    onProgress?.(`Saving "${parsed.title}"…`)

    let bookId
    try {
      bookId = await db.books.add({
        title:        parsed.title,
        author:       parsed.author,
        cover:        parsed.cover ?? null,
        progress:     0,
        mode:         getSetting('defaultMode') === 'listen' ? 'listen' : 'read',
        addedAt:      Date.now(),
        lastOpenedAt: Date.now(),
      })
    } catch (e) { throw new Error(`Step[db-book]: ${e.message}`) }

    const total = parsed.chapters.length
    try {
      for (let i = 0; i < total; i++) {
        // The parse loops check this and the save loop did not — a timeout
        // landing here left a book in the library holding only some of its text.
        if (cancelled) throw new Error('Import cancelled')
        const chapterText = parsed.chapters[i].text || '[No text content for this chapter.]'
        try {
          await db.chapters.add({
            bookId,
            index:       i,
            title:       parsed.chapters[i].title,
            text:        chapterText,
            audioStatus: 'none',
          })
        } catch (e) { throw new Error(`Step[db-chapter-${i}]: ${e.message}`) }
        if (i % 5 === 0) onProgress?.(`Saving chapter ${i + 1} of ${total}…`)
      }
    } catch (e) {
      // Roll back rather than leave a partial book that looks importable.
      try {
        await db.chapters.where('bookId').equals(bookId).delete()
        await db.books.delete(bookId)
      } catch { /* best effort — the original failure is what matters */ }
      throw e
    }

    return { bookId, hasCover: !!parsed.cover }
  }

  const work = doIngest()
  work.catch(() => {})  // avoid an unhandled rejection when the timeout wins the race
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}
