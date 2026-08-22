import { describe, it, expect } from 'vitest'
import { sniffFileType } from './filetype'

const blobOf = bytes => new Blob([new Uint8Array(bytes)])
const PDF  = [0x25, 0x50, 0x44, 0x46, 0x2d]  // "%PDF-"
const ZIP  = [0x50, 0x4b, 0x03, 0x04]        // "PK\x03\x04"

describe('sniffFileType', () => {
  it('identifies a PDF by its magic bytes', async () => {
    expect(await sniffFileType(blobOf(PDF), 'application/pdf')).toBe('pdf')
  })

  it('identifies a zip container as an epub', async () => {
    expect(await sniffFileType(blobOf(ZIP), 'application/epub+zip')).toBe('epub')
  })

  // The regression. LibGen and Anna's mirrors serve PDFs as octet-stream; the
  // old header-only check called those epub and fed them to JSZip.
  it('calls a PDF served as octet-stream a PDF', async () => {
    expect(await sniffFileType(blobOf(PDF), 'application/octet-stream')).toBe('pdf')
  })

  // ...and the bytes must win even when the header actively lies.
  it('trusts the bytes over a contradicting content type', async () => {
    expect(await sniffFileType(blobOf(PDF), 'application/epub+zip')).toBe('pdf')
    expect(await sniffFileType(blobOf(ZIP), 'application/pdf')).toBe('epub')
  })

  it('falls back to the content type for unrecognised bytes', async () => {
    expect(await sniffFileType(blobOf([1, 2, 3, 4]), 'application/pdf')).toBe('pdf')
    expect(await sniffFileType(blobOf([1, 2, 3, 4]), 'text/html')).toBe('epub')
  })

  it('does not throw on an empty blob', async () => {
    expect(await sniffFileType(new Blob([]), 'application/pdf')).toBe('pdf')
    expect(await sniffFileType(new Blob([]), '')).toBe('epub')
  })
})
