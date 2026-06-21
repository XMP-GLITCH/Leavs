import Dexie from 'dexie'

export const db = new Dexie('leavs')

db.version(1).stores({
  // books: { id, title, author, cover, genre, addedAt, lastOpenedAt, progress (0-1), mode, audioGenerated }
  books: '++id, title, author, addedAt, lastOpenedAt',

  // chapters: { id, bookId, index, title, text, audioStatus ('none'|'generating'|'ready'), duration }
  chapters: '++id, bookId, [bookId+index]',

  // audioChunks: { id, bookId, chapterId, data (ArrayBuffer), duration, wordTimestamps (JSON) }
  audioChunks: '++id, bookId, chapterId',

  // highlights: { id, bookId, chapterId, selectedText, startOffset, endOffset, colour, note, audioTimestamp, createdAt }
  highlights: '++id, bookId, chapterId, createdAt',

  // bookmarks: { id, bookId, chapterId, charOffset, note, audioTimestamp, createdAt }
  bookmarks: '++id, bookId, chapterId, createdAt',

  // vocabulary: { id, word, definition, bookId, chapterId, charOffset, createdAt }
  vocabulary: '++id, word, bookId, createdAt',

  // progress: one record per book — { bookId, chapterId, charOffset, audioPosition, mode, updatedAt }
  progress: 'bookId',
})
