import { describe, it, expect, beforeEach, vi } from 'vitest'
import JSZip from 'jszip'

// Dexie needs IndexedDB, which jsdom lacks — and we only care what ingestFile
// decided to WRITE, so record the writes instead of running a real database.
vi.mock('../db/db', () => {
  const books = []
  const chapters = []
  return {
    db: {
      books: {
        add:    async b  => { books.push(b); return books.length },
        delete: async id => { books.splice(id - 1, 1) },
      },
      chapters: {
        add:   async c => { chapters.push(c); return chapters.length },
        where: () => ({ equals: () => ({ delete: async () => { chapters.length = 0 } }) }),
      },
      __books: books,
      __chapters: chapters,
    },
  }
})

import { ingestFile } from './ingest'
import { db } from '../db/db'

beforeEach(() => {
  db.__books.length = 0
  db.__chapters.length = 0
  localStorage.clear()
})

const CORE_XML = `<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="http://x" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>My Title</dc:title><dc:creator>An Author</dc:creator>
</cp:coreProperties>`

async function makeDocx(paragraphs, name = 'doc.docx') {
  const zip = new JSZip()
  zip.file('docProps/core.xml', CORE_XML)
  const body = paragraphs.map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`)
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name)
}

async function makeEpub(name = 'book.epub') {
  const zip = new JSZip()
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Epub Title</dc:title><dc:creator>Epub Author</dc:creator></metadata>
      <manifest><item id="c1" href="c1.xhtml"/><item id="c2" href="c2.xhtml"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`)
  zip.file('OEBPS/c1.xhtml', `<html><body><h1>One</h1><p>${'alpha '.repeat(40)}</p></body></html>`)
  zip.file('OEBPS/c2.xhtml', `<html><body><h1>Two</h1><p>${'beta '.repeat(40)}</p></body></html>`)
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name)
}

describe('ingestFile - DOCX', () => {
  // THE regression. The old parser joined every <w:t> run with a space and
  // collapsed \s+, destroying the line structure splitChapters scans for — so
  // every DOCX, however it was written, imported as a single chapter.
  it('splits a chapter-headed DOCX into chapters', async () => {
    const file = await makeDocx([
      'Chapter 1',
      'It was the best of times. '.repeat(10),
      'Chapter 2',
      'It was the worst of times. '.repeat(10),
      'Chapter 3',
      'It was the age of wisdom. '.repeat(10),
    ])
    await ingestFile(file)

    expect(db.__chapters).toHaveLength(3)
    expect(db.__chapters.map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3'])
    expect(db.__chapters[0].text).toContain('best of times')
    expect(db.__chapters[1].text).toContain('worst of times')
    expect(db.__chapters[0].text).not.toContain('worst of times')
  })

  it('reads title and author from the document properties', async () => {
    await ingestFile(await makeDocx(['Body text long enough to survive. '.repeat(10)]))
    expect(db.__books[0].title).toBe('My Title')
    expect(db.__books[0].author).toBe('An Author')
  })

  it('falls back to flat extraction when there are no <w:p> elements', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml',
      `<?xml version="1.0"?><w:document><w:body><w:t>${'hello world '.repeat(30)}</w:t></w:body></w:document>`)
    const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'flat.docx')
    await ingestFile(file)
    expect(db.__chapters).toHaveLength(1)
    expect(db.__chapters[0].text).toContain('hello world')
  })

  it('stores a readable placeholder rather than failing on a near-empty document', async () => {
    await ingestFile(await makeDocx(['tiny']))
    expect(db.__chapters).toHaveLength(1)
    expect(db.__chapters[0].text).toMatch(/^\[/)
  })
})

describe('ingestFile - TXT', () => {
  it('splits on chapter headings', async () => {
    const text = ['Chapter 1', 'x '.repeat(100), 'Chapter 2', 'y '.repeat(100)].join('\n\n')
    await ingestFile(new File([text], 'book.txt'))
    expect(db.__chapters).toHaveLength(2)
  })

  it('keeps a heading-less file as a single chapter', async () => {
    await ingestFile(new File(['just some prose '.repeat(50)], 'plain.txt'))
    expect(db.__chapters).toHaveLength(1)
    expect(db.__chapters[0].title).toBe('Chapter 1')
  })

  it('titles the book from the filename', async () => {
    await ingestFile(new File(['some prose '.repeat(50)], 'The Odyssey.txt'))
    expect(db.__books[0].title).toBe('The Odyssey')
  })
})

describe('ingestFile - EPUB', () => {
  it('reads the spine in order, taking titles from headings', async () => {
    await ingestFile(await makeEpub())
    expect(db.__books[0].title).toBe('Epub Title')
    expect(db.__books[0].author).toBe('Epub Author')
    expect(db.__chapters.map(c => c.title)).toEqual(['One', 'Two'])
    expect(db.__chapters.map(c => c.index)).toEqual([0, 1])
  })

  it('names the failing step when the archive is not an epub', async () => {
    await expect(ingestFile(new File(['not a zip at all'], 'bad.epub')))
      .rejects.toThrow(/Step\[epub-/)
  })
})

describe('ingestFile - general', () => {
  it('rejects an unsupported extension with a usable message', async () => {
    await expect(ingestFile(new File(['x'], 'notes.rtf')))
      .rejects.toThrow(/Unsupported format \.rtf/)
  })

  it('honours the default-mode preference', async () => {
    localStorage.setItem('leavs.defaultMode', '"listen"')
    await ingestFile(new File(['some prose '.repeat(50)], 'a.txt'))
    expect(db.__books[0].mode).toBe('listen')
  })

  it('defaults to read mode', async () => {
    await ingestFile(new File(['some prose '.repeat(50)], 'b.txt'))
    expect(db.__books[0].mode).toBe('read')
  })

  it('reports progress as it goes', async () => {
    const seen = []
    await ingestFile(new File(['some prose '.repeat(50)], 'c.txt'), m => seen.push(m))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatch(/Reading file/)
  })
})

describe('splitChapters content preservation', () => {
  // Everything before the first heading used to be discarded outright.
  it('keeps text that appears before the first chapter heading', async () => {
    const text = [
      'A preface that matters. '.repeat(10),
      'Chapter 1',
      'First chapter body. '.repeat(10),
      'Chapter 2',
      'Second chapter body. '.repeat(10),
    ].join('\n\n')
    await ingestFile(new File([text], 'front.txt'))

    expect(db.__chapters[0].title).toBe('Front matter')
    expect(db.__chapters[0].text).toContain('A preface that matters')
    expect(db.__chapters).toHaveLength(3)
  })

  // Short sections used to be filtered out, taking their text with them.
  it('folds a too-short section into the previous chapter instead of dropping it', async () => {
    const text = [
      'Chapter 1',
      'A full length chapter body goes here. '.repeat(10),
      'Chapter 2',
      'tiny',
      'Chapter 3',
      'Another full length chapter body here. '.repeat(10),
    ].join('\n\n')
    await ingestFile(new File([text], 'short.txt'))

    const all = db.__chapters.map(c => c.text).join(' ')
    expect(all).toContain('tiny')          // the text survived
    expect(all).toContain('Chapter 2')     // and so did its heading
    expect(db.__chapters).toHaveLength(2)  // folded, not kept as its own chapter
  })

  it('loses no characters overall when sections are folded', async () => {
    const text = ['Chapter 1', 'x'.repeat(200), 'Chapter 2', 'unique-marker-abc', 'Chapter 3', 'y'.repeat(200)].join('\n\n')
    await ingestFile(new File([text], 'nolost.txt'))
    expect(db.__chapters.map(c => c.text).join(' ')).toContain('unique-marker-abc')
  })
})
