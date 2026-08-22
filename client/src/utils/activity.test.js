import { describe, it, expect, beforeEach } from 'vitest'
import { recordActivityToday, getActivityDays } from './activity'

const KEY = 'leavs.activityDays'
beforeEach(() => localStorage.clear())

describe('activity log', () => {
  it('records today exactly once however often it is called', () => {
    recordActivityToday()
    recordActivityToday()
    recordActivityToday()
    expect([...getActivityDays()]).toEqual([new Date().toDateString()])
  })

  it('keeps 90 days and drops the oldest', () => {
    localStorage.setItem(KEY, JSON.stringify(Array.from({ length: 120 }, (_, i) => `day-${i}`)))
    recordActivityToday()
    const kept = getActivityDays()
    expect(kept.size).toBe(90)
    expect(kept.has(new Date().toDateString())).toBe(true)
    expect(kept.has('day-0')).toBe(false)
  })

  it('degrades to an empty set when storage holds junk', () => {
    localStorage.setItem(KEY, 'not json at all')
    expect(getActivityDays().size).toBe(0)
  })
})
