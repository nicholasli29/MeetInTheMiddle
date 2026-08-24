/**
 * End-to-end check against the real APIs.
 *
 * Excluded from the default test run because it needs network and consumes request
 * quota. Run deliberately with:  npx vitest run plan.live
 */
import { describe, expect, it } from 'vitest'
import { runPlan } from './plan'
import type { Origin } from './types'

const origins: Origin[] = [
  { id: 'a', label: 'Alex', lng: -122.4194, lat: 37.7749, mode: 'driving', maxMinutes: 45 },
  { id: 'b', label: 'Bea',  lng: -122.2712, lat: 37.8044, mode: 'driving', maxMinutes: 45 },
  { id: 'c', label: 'Cass', lng: -121.8863, lat: 37.3382, mode: 'driving', maxMinutes: 60 },
]

describe('live plan', () => {
  it('ranks real venues in the shared area', async () => {
    const out = await runPlan({
      origins,
      kind: 'venue',
      agendaKeys: ['dining', 'bars'],
      weights: { speed: 0.4, fairness: 0.35, agenda: 0.25 },
    })

    console.log('\nshared by :', out.includedOrigins.map((i) => origins[i].label).join(', '))
    console.log('excluded  :', out.excludedOrigins.map((i) => origins[i].label).join(', ') || '(none)')
    console.log('empty tags:', out.emptyCategories.join(', ') || '(none)')
    console.log('results   :', out.results.length, out.note ?? '')
    console.log('\n  rank  total  speed  fair   agenda  mean  spread  name')
    for (const [i, r] of out.results.slice(0, 8).entries()) {
      console.log(
        `  ${String(i + 1).padStart(4)}  ${r.total.toFixed(3)}  ` +
        `${r.axes.speed.toFixed(2)}   ${r.axes.fairness.toFixed(2)}   ${r.axes.agenda.toFixed(2)}    ` +
        `${(r.travel.meanMinutes ?? NaN).toFixed(0).padStart(4)}  ${(r.travel.spreadMinutes ?? NaN).toFixed(0).padStart(6)}  ` +
        r.candidate.name,
      )
    }

    expect(out.overlap).not.toBeNull()
    expect(out.results.length).toBeGreaterThan(0)
    // A NaN here would sort silently and wrongly.
    expect(out.results.every((r) => Number.isFinite(r.total))).toBe(true)
    // Ranking must be monotonically non-increasing.
    const totals = out.results.map((r) => r.total)
    expect([...totals].sort((a, b) => b - a)).toEqual(totals)
  }, 60_000)

  it('handles one starting point on its own travel mode against few results', async () => {
    const { fetchTravelMatrix } = await import('../providers/matrix')
    const solo: Origin[] = [
      { id: 'a', label: 'Alex', lng: -122.4194, lat: 37.7749, mode: 'cycling', maxMinutes: 60 },
    ]
    const out = await fetchTravelMatrix(solo, [{ lng: -122.3892, lat: 37.6213 }])
    expect(out[0]).toHaveLength(1)
    expect(typeof out[0][0]).toBe('number')
  }, 30_000)
})
