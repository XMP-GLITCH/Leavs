// Identify a downloaded book by its magic bytes.
//
// LibGen and Anna's Archive mirrors routinely serve application/octet-stream,
// so Content-Type cannot decide this. A PDF guessed as EPUB reaches JSZip and
// dies with an unhelpful "Step[epub-unzip]" — which is what used to happen to
// most shadow-library PDFs.

// FileReader rather than blob.arrayBuffer(): the latter is Safari 14.1+, and
// this codebase deliberately supports older iOS (see ingest.js).
export function readHead(blob, n = 4) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(new Uint8Array(r.result))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob.slice(0, n))
  })
}

export async function sniffFileType(blob, contentType = '') {
  try {
    const h = await readHead(blob, 4)
    if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf'  // "%PDF"
    if (h[0] === 0x50 && h[1] === 0x4B) return 'epub'                                    // "PK" zip
  } catch { /* unreadable — fall back to the header */ }
  return contentType.includes('pdf') ? 'pdf' : 'epub'
}
