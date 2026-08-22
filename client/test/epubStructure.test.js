import { describe, it, expect, beforeEach, vi } from 'vitest'
import JSZip from 'jszip'

vi.mock('../src/db/db', () => {
  const books = [], chapters = []
  return { db: {
    books:    { add: async b => { books.push(b); return books.length }, delete: async () => {} },
    chapters: { add: async c => { chapters.push(c); return chapters.length },
                where: () => ({ equals: () => ({ delete: async () => { chapters.length = 0 } }) }) },
    __books: books, __chapters: chapters,
  } }
})

import { ingestFile } from '../src/lib/ingest'
import { db } from '../src/db/db'

beforeEach(() => {
  db.__books.length = 0
  db.__chapters.length = 0
  localStorage.clear()
})

// Minimal but valid EPUB: container.xml -> OPF -> spine of XHTML documents.
async function makeEpub(docs, name = 'book.epub') {
  const zip = new JSZip()
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`)

  const manifest = docs.map((_, i) => `<item id="c${i}" href="c${i}.xhtml"/>`).join('')
  const spine    = docs.map((_, i) => `<itemref idref="c${i}"/>`).join('')
  zip.file('OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/">
       <metadata><dc:title>Structured Book</dc:title><dc:creator>A Writer</dc:creator></metadata>
       <manifest>${manifest}</manifest><spine>${spine}</spine></package>`)

  docs.forEach((body, i) =>
    zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0"?><html><body>${body}</body></html>`))

  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], name, { type: 'application/epub+zip' })
}

const para = (n, w = 'sentence') => `<p>${(w + ' ').repeat(n).trim()}.</p>`

describe('EPUB keeps its structure', () => {
  // body.textContent + \s+ -> ' ' flattened every book into one run. The reader
  // splits paragraphs on \n\n, so a whole book rendered as a SINGLE <p> holding
  // tens of thousands of word spans. Measured on real Pride and Prejudice:
  // 733,163 characters and exactly zero paragraph breaks.
  it('emits paragraph breaks between block elements', async () => {
    await ingestFile(await makeEpub([para(30) + para(30) + para(30)]))
    const text = db.__chapters[0].text
    expect(text).toContain('\n\n')
    expect(text.split('\n\n')).toHaveLength(3)
  })

  it('handles EPUBs that use bare divs instead of paragraphs', async () => {
    const divs = `<div>${'alpha '.repeat(30)}</div><div>${'beta '.repeat(30)}</div>`
    await ingestFile(await makeEpub([divs]))
    const text = db.__chapters[0].text
    expect(text).toContain('\n\n')
    expect(text).toContain('alpha')
    expect(text).toContain('beta')
  })

  // The old threshold was 80 characters, which silently discarded dedications,
  // epigraphs and one-page chapters.
  it('keeps short sections instead of discarding them', async () => {
    await ingestFile(await makeEpub([
      `<p>For my mother.</p>`,
      para(40, 'body'),
    ]))
    expect(db.__chapters.map(c => c.text).join(' ')).toContain('For my mother')
  })

  // Gutenberg packs many chapters into one spine item; a 61-chapter novel used
  // to arrive as 15 sections titled with image captions.
  it('splits a spine item that contains several chapters', async () => {
    const body = [
      '<h1>CHAPTER I.</h1>', para(40, 'first'),
      '<h2>CHAPTER II.</h2>', para(40, 'second'),
      '<h2>CHAPTER III.</h2>', para(40, 'third'),
    ].join('')
    await ingestFile(await makeEpub([body]))
    expect(db.__chapters.length).toBeGreaterThan(1)
    expect(db.__chapters.map(c => c.title).join(' ')).toMatch(/CHAPTER II/)
  })

  it('does not duplicate text nested inside wrapper elements', async () => {
    await ingestFile(await makeEpub([`<div><p>${'unique '.repeat(30)}</p></div>`]))
    const occurrences = (db.__chapters[0].text.match(/unique/g) || []).length
    expect(occurrences).toBe(30)
  })
})
