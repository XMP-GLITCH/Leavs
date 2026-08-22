import { describe, it, expect } from 'vitest'
import { parseResults } from '../api/libgen/search.js'
// ?raw keeps this independent of cwd and of the jsdom environment's URL handling
import html from './fixtures/libgen-li-results.html?raw'

// libgen.li replaced the old libgen.rs table wholesale: no valign="top", no
// id="href" title anchor, md5 only in the mirror links. The old parser found
// zero rows in this markup and the endpoint reported it as "no results", so a
// dead source looked like an empty search for weeks. This fixture is the guard.
describe('parseResults on real libgen.li markup', () => {
  const books = parseResults(html)

  it('finds every result row', () => {
    expect(books).toHaveLength(3)
  })

  it('extracts a valid md5 for each', () => {
    for (const b of books) expect(b.md5).toMatch(/^[a-f0-9]{32}$/)
  })

  it('never leaks raw markup into a title', () => {
    for (const b of books) {
      expect(b.title).not.toMatch(/[<>]|href=|edition\.php/)
      expect(b.title.trim()).not.toBe('')
    }
  })

  // The ISBN anchor is often longer than the title anchor, so "longest wins"
  // alone produced titles like "0553897837; 9780553897838".
  it('never picks an ISBN as the title', () => {
    for (const b of books) expect(b.title).not.toMatch(/^[0-9 ;xX.,-]+$/)
  })

  it('reports a format and a human-readable stat line', () => {
    for (const b of books) {
      expect(b.ext).toMatch(/^[a-z0-9]+$/)
      expect(b.stat).toContain(b.ext.toUpperCase())
    }
  })

  it('deduplicates repeated md5s', () => {
    const doubled = parseResults(html + html)
    expect(new Set(doubled.map(b => b.md5)).size).toBe(doubled.length)
  })

  it('respects the limit', () => {
    expect(parseResults(html, 2)).toHaveLength(2)
  })

  it('returns nothing for markup with no results', () => {
    expect(parseResults('<table><tr><td>nothing here</td></tr></table>')).toEqual([])
  })
})
