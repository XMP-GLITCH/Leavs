// Daily reading-activity log for streak tracking.
// Book.lastOpenedAt alone can't reconstruct history: re-opening the same book
// overwrites the timestamp and erases yesterday's activity.

const KEY      = 'leavs.activityDays'
const KEEP_MAX = 90  // days of history to retain

export function recordActivityToday() {
  try {
    const today = new Date().toDateString()
    const arr   = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (arr.includes(today)) return
    arr.push(today)
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-KEEP_MAX)))
  } catch { /* storage unavailable — streak just falls back to lastOpenedAt */ }
}

export function getActivityDays() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) }
  catch { return new Set() }
}
