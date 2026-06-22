import { db } from '../db/db'

// ── Chapter detection ────────────────────────────────────────────────────────
const CH_BREAK = /^(?:chapter|ch\.?|part|section|book)\s+(?:\d+|[ivxlcdm]+)[^\n]*/im

function splitChapters(text) {
  const lines  = text.split('\n')
  const breaks = []
  for (let i = 0; i < lines.length; i++) {
    if (CH_BREAK.test(lines[i].trim())) breaks.push(i)
  }
  if (breaks.length < 2) return [{ title: 'Chapter 1', text: text.trim() }]
  return breaks.map((start, idx) => {
    const end  = breaks[idx + 1] ?? lines.length
    const body = lines.slice(start + 1, end).join('\n').trim()
    return { title: lines[start].trim() || `Chapter ${idx + 1}`, text: body }
  }).filter(ch => ch.text.length > 80)
}

// ── TXT ──────────────────────────────────────────────────────────────────────
async function parseTXT(file) {
  const text = await file.text()
  return { title: file.name.replace(/\.[^.]+$/, ''), author: 'Unknown', chapters: splitChapters(text) }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
async function parsePDF(file, onProgress) {
  onProgress?.('Loading PDF reader…')

  let pdfjsMod
  try { pdfjsMod = await import('pdfjs-dist') }
  catch (e) { throw new Error(`PDF reader failed to load: ${e.message}`) }

  const pdfjs = pdfjsMod.default ?? pdfjsMod
  if (typeof pdfjs.getDocument !== 'function')
    throw new Error('PDF reader unavailable — try a TXT file instead')

  // Worker is served locally (public/pdf.worker.min.mjs) — no CDN needed
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  onProgress?.('Reading PDF…')
  const arrayBuffer = await file.arrayBuffer()

  let pdf
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  } catch (e) { throw new Error(`Could not open PDF: ${e.message}`) }

  const meta   = await pdf.getMetadata().catch(() => ({}))
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

// ── EPUB — native JSZip + DOMParser (no epub.js) ─────────────────────────────
async function parseEPUB(file, onProgress) {
  onProgress?.('Loading EPUB…')

  let JSZip
  try {
    const mod = await import('jszip')
    JSZip = mod.default ?? mod
  } catch (e) { throw new Error(`EPUB unzip failed to load: ${e.message}`) }

  onProgress?.('Unzipping…')
  const arrayBuffer = await file.arrayBuffer()
  let zip
  try { zip = await JSZip.loadAsync(arrayBuffer) }
  catch (e) { throw new Error(`Could not unzip EPUB: ${e.message}`) }

  // 1. Read container.xml → find OPF path
  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  if (!containerXml) throw new Error('Invalid EPUB: missing META-INF/container.xml')

  const parser   = new DOMParser()
  const contDoc  = parser.parseFromString(containerXml, 'text/xml')
  const opfPath  = contDoc.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('Invalid EPUB: no rootfile in container.xml')

  // 2. Read OPF → metadata + spine
  const opfXml = await zip.file(opfPath)?.async('text')
  if (!opfXml) throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`)

  const opfDoc   = parser.parseFromString(opfXml, 'text/xml')
  const metaEl   = opfDoc.querySelector('metadata')
  const title    = metaEl?.querySelector('title')?.textContent?.trim()
               || file.name.replace(/\.[^.]+$/, '')
  const author   = metaEl?.querySelector('creator')?.textContent?.trim() || 'Unknown'

  const opfDir   = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = {}
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href')
  })

  const spineHrefs = [...opfDoc.querySelectorAll('spine itemref')]
    .map(ref => manifest[ref.getAttribute('idref')])
    .filter(Boolean)

  // 3. Extract text from each spine file
  const chapters = []
  for (let i = 0; i < spineHrefs.length; i++) {
    if (i % 5 === 0) onProgress?.(`Reading chapter ${i + 1} of ${spineHrefs.length}…`)
    try {
      const path = opfDir + spineHrefs[i].split('#')[0]   // strip fragment
      const html = await zip.file(path)?.async('text')
      if (!html) continue

      const doc = parser.parseFromString(html, 'text/html')
      doc.querySelectorAll('script,style,nav').forEach(el => el.remove())
      const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < 80) continue

      const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim()
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
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('Import timed out — try a smaller file or TXT format.')),
      90_000
    )
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
      if (i % 5 === 0) onProgress?.(`Saving chapter ${i + 1} of ${total}…`)
    }

    return bookId
  }

  return Promise.race([doIngest(), timeout])
}
