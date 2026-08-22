import { describe, it, expect } from 'vitest'
import { isAllowedDownload } from '../api/libgen/fetch.js'

describe('isAllowedDownload', () => {
  it('accepts the known mirror domains', () => {
    for (const u of [
      'https://library.lol/main/abc',
      'https://libgen.li/get.php?md5=abc',
      'https://libgen.la/book.pdf',
      'https://libgen.bz/x',
      'https://annas-archive.org/x',
    ]) expect(isAllowedDownload(u)).toBe(true)
  })

  it('accepts subdomains of a mirror', () => {
    expect(isAllowedDownload('https://download.library.lol/main/x.epub')).toBe(true)
    expect(isAllowedDownload('https://cdn.libgen.li/x.pdf')).toBe(true)
    // The bytes actually come from here: get.php 307s to cdn<N>.booksdl.lc.
    // Omitting it would make the allowlist block every real download.
    expect(isAllowedDownload('https://cdn3.booksdl.lc/get.php?md5=abc')).toBe(true)
  })

  // The leading dot in the suffix check is what stops these.
  it('rejects lookalike domains that merely end with the name', () => {
    expect(isAllowedDownload('https://evil-library.lol/x')).toBe(false)
    expect(isAllowedDownload('https://notlibgen.li/x')).toBe(false)
    expect(isAllowedDownload('https://evil-booksdl.lc/x')).toBe(false)
  })

  it('rejects a mirror name used as a subdomain of an attacker domain', () => {
    expect(isAllowedDownload('https://library.lol.evil.com/x')).toBe(false)
    expect(isAllowedDownload('https://libgen.li.attacker.net/x')).toBe(false)
  })

  it('rejects internal and metadata addresses', () => {
    for (const u of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3001/api/health',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://10.0.0.5/secrets',
    ]) expect(isAllowedDownload(u)).toBe(false)
  })

  it('rejects non-http schemes and malformed input', () => {
    expect(isAllowedDownload('file:///etc/passwd')).toBe(false)
    expect(isAllowedDownload('ftp://library.lol/x')).toBe(false)
    expect(isAllowedDownload('not a url')).toBe(false)
    expect(isAllowedDownload('')).toBe(false)
    expect(isAllowedDownload(null)).toBe(false)
  })
})
