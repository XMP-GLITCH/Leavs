import { db } from '../db/db'

// Decode base64 → ArrayBuffer using fetch (fastest cross-browser method)
async function b64ToArrayBuffer(base64) {
  const res = await fetch(`data:audio/mpeg;base64,${base64}`)
  return res.arrayBuffer()
}

export async function generateChapterAudio(chapter, bookId, voice = 'en-US-JennyNeural') {
  await db.chapters.update(chapter.id, { audioStatus: 'generating' })

  try {
    const res = await fetch('/api/tts/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: chapter.text, voice, chapterId: chapter.id, bookId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Server error ${res.status}`)
    }

    const { audio: audioBase64, wordBoundaries } = await res.json()

    const data = await b64ToArrayBuffer(audioBase64)

    // Remove any existing chunk for this chapter before adding
    await db.audioChunks.where('chapterId').equals(chapter.id).delete()
    await db.audioChunks.add({ bookId, chapterId: chapter.id, data, wordBoundaries: wordBoundaries ?? [] })
    await db.chapters.update(chapter.id, { audioStatus: 'ready' })
  } catch (err) {
    await db.chapters.update(chapter.id, { audioStatus: 'error' })
    throw err
  }
}

// Generate audio for every chapter in a book, one at a time
export async function generateBookAudio(bookId, voice = 'en-US-JennyNeural', onProgress) {
  const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('index')

  for (const ch of chapters) {
    if (ch.audioStatus === 'ready') continue  // skip already done
    onProgress?.(`Generating Ch. ${ch.index + 1} of ${chapters.length}…`)
    await generateChapterAudio(ch, bookId, voice)
  }
}
