import { db }   from '../db/db'
import JSZip     from 'jszip'

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

  const chunks = breaks.map((start, idx) => {
    const end  = breaks[idx + 1] ?? lines.length
    const body = lines.slice(start + 1, end).join('\n').trim()
    return { title: lines[start].trim() || `Chapter ${idx + 1}`, text: body }
  }).filter(ch => ch.text.length > 80)

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
async function parsePDF(file, onProgress) {
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
  catch (e) { throw new Error(`Step[pdf-open]: ${e.message}`) }

  const meta   = await pdf.getMetadata().catch(() => ({}))
  const title  = meta.info?.Title  || file.name.replace(/\.[^.]+$/, '')
  const author = meta.info?.Author || 'Unknown'

  const pageTexts = []
  for (let p = 1; p <= pdf.numPages; p++) {
    if (p % 10 === 0) onProgress?.(`Reading page ${p} of ${pdf.numPages}…`)
    try {
      const page    = await pdf.getPage(p)
      const content = await page.getTextContent()
      pageTexts.push(content.items.map(it => it.str).join(' '))
    } catch { pageTexts.push('') }
  }

  return { title, author, cover: null, chapters: splitChapters(pageTexts.join('\n\n')) }
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
      const text  = texts.join(' ').replace(/\s+/g, ' ').trim()
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
      const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < 80) continue
      const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim()
      chapters.push({ title: heading || `Chapter ${chapters.length + 1}`, text })
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

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Import timed out — try a smaller file or TXT format.')),
      90000
    )
  )

  async function doIngest() {
    onProgress?.('Reading file…')

    let parsed
    try {
      if      (ext === 'pdf')  parsed = await parsePDF(file, onProgress)
      else if (ext === 'epub') parsed = await parseEPUB(file, onProgress)
      else if (ext === 'txt')  parsed = await parseTXT(file)
      else if (ext === 'pptx') parsed = await parsePPTX(file, onProgress)
      else throw new Error(`Unsupported format .${ext} — use PDF, EPUB, PPTX or TXT`)
    } catch (e) {
      throw e
    }

    onProgress?.(`Saving "${parsed.title}"…`)

    let bookId
    try {
      bookId = await db.books.add({
        title:        parsed.title,
        author:       parsed.author,
        cover:        parsed.cover ?? null,
        progress:     0,
        mode:         'read',
        addedAt:      Date.now(),
        lastOpenedAt: Date.now(),
      })
    } catch (e) { throw new Error(`Step[db-book]: ${e.message}`) }

    const total = parsed.chapters.length
    for (let i = 0; i < total; i++) {
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

    return { bookId, hasCover: !!parsed.cover }
  }

  return Promise.race([doIngest(), timeout])
}
