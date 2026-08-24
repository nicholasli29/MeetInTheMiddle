import { describe, expect, it } from 'vitest'
import {
  effectiveWeights, normalise, rank, smoothedRating, travelFacts, type ScoreInput,
} from './score'
import type { Candidate, Origin } from './types'

const origins = (mins: number[]): Origin[] =>
  mins.map((m, i) => ({
    id: `o${i}`, label: `O${i}`, lng: 0, lat: 0, mode: 'driving', maxMinutes: m,
  }))

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, name: id, kind: 'venue', lng: 0, lat: 0, categoryIds: [],
  price: null, rating: null, ratingCount: 0, openNow: null, ...over,
})

const input = (
  id: string,
  minutes: (number | null)[],
  os: Origin[],
  counts: Record<string, number> = {},
  over: Partial<Candidate> = {},
): ScoreInput => ({
  candidate: cand(id, over),
  travel: travelFacts(minutes, os),
  agenda: { matched: Object.keys(counts).filter((k) => counts[k] > 0), counts },
})

describe('normalise', () => {
  it('is neutral rather than NaN when every value matches', () => {
    expect(normalise(30, [30, 30, 30], 5)).toBe(0.5)
  })

  it('keeps noise-scale differences small', () => {
    expect(normalise(30.2, [30, 30.1, 30.2], 5)).toBeLessThan(0.1)
  })

  it('spans the range once differences clear the floor', () => {
    expect(normalise(50, [20, 50], 5)).toBe(1)
    expect(normalise(20, [20, 50], 5)).toBe(0)
  })
})

describe('weights', () => {
  it('drops agenda and rescales when nothing is selected', () => {
    const w = effectiveWeights({ speed: 0.4, fairness: 0.4, agenda: 0.2 }, { agenda: false })
    expect(w.agenda).toBe(0)
    expect(w.speed + w.fairness).toBeCloseTo(1)
  })

  it('splits evenly when every slider is zero', () => {
    const w = effectiveWeights({ speed: 0, fairness: 0, agenda: 0 }, { agenda: true })
    expect(w.speed).toBeCloseTo(1 / 3)
  })
})

describe('travelFacts', () => {
  it('drops unroutable pairs instead of producing NaN', () => {
    const t = travelFacts([10, null, 30], origins([60, 60, 60]))
    expect(t.meanMinutes).toBe(20)
    expect(t.spreadMinutes).toBe(20)
    expect(t.reachableBy).toEqual([0, 2])
  })

  it('honours each budget separately', () => {
    expect(travelFacts([10, 40], origins([15, 15])).reachableBy).toEqual([0])
  })

  it('reports no spread when only one origin can route', () => {
    expect(travelFacts([null, 25, null], origins([60, 60, 60])).spreadMinutes).toBeNull()
  })
})

describe('rank', () => {
  const os = origins([60, 60, 60])
  const even = { speed: 1 / 3, fairness: 1 / 3, agenda: 1 / 3 }

  it('produces finite totals with no agenda selected', () => {
    const out = rank([input('a', [10, 20, 30], os), input('b', [15, 15, 15], os)], even, [])
    expect(out.every((s) => Number.isFinite(s.total))).toBe(true)
  })

  it('separates fairness from speed', () => {
    // 'even' is slower on average but shared equally; 'lopsided' is quicker overall
    // while one person absorbs the entire journey.
    const evenTrip = input('even', [30, 30, 30], os)
    const lopsided = input('lopsided', [5, 5, 70], os)
    expect(rank([evenTrip, lopsided], { speed: 0, fairness: 1, agenda: 0 }, [])[0].candidate.id)
      .toBe('even')
    expect(rank([evenTrip, lopsided], { speed: 1, fairness: 0, agenda: 0 }, [])[0].candidate.id)
      .toBe('lopsided')
  })

  it('re-ranks when the weights move', () => {
    const near = input('near', [10, 12, 14], os, { bars: 0 })
    const rich = input('rich', [25, 27, 29], os, { bars: 8 })
    expect(rank([near, rich], { speed: 1, fairness: 0, agenda: 0 }, ['bars'])[0].candidate.id)
      .toBe('near')
    expect(rank([near, rich], { speed: 0, fairness: 0, agenda: 1 }, ['bars'])[0].candidate.id)
      .toBe('rich')
  })

  it('stays neutral when every candidate has the same agenda density', () => {
    const a = input('a', [10, 20, 30], os, { bars: 9 })
    const b = input('b', [12, 22, 32], os, { bars: 9 })
    const out = rank([a, b], { speed: 0, fairness: 0, agenda: 1 }, ['bars'])
    expect(out.every((s) => s.axes.agenda === 0.5)).toBe(true)
  })

  it('separates a cluster from a lone match', () => {
    const lone = input('lone', [20, 20, 20], os, { bars: 1 })
    const dense = input('dense', [20, 20, 20], os, { bars: 8 })
    expect(rank([lone, dense], { speed: 0, fairness: 0, agenda: 1 }, ['bars'])[0].candidate.id)
      .toBe('dense')
  })

  it('contributions sum to the total', () => {
    const out = rank([input('a', [10, 20, 30], os, { c1: 2 }, { price: 2 })], even, ['c1', 'c2'])
    const c = out[0].contributions
    expect(c.speed + c.fairness + c.agenda).toBeCloseTo(out[0].total)
  })

  it('breaks ties on a rating weighted by how many votes back it', () => {
    const fewVotes = input('few', [20, 20, 20], os, {}, { rating: 9.8, ratingCount: 3 })
    const manyVotes = input('many', [20, 20, 20], os, {}, { rating: 8.9, ratingCount: 3000 })
    const out = rank([fewVotes, manyVotes], even, [])
    expect(out[0].total).toBeCloseTo(out[1].total)
    expect(out[0].candidate.id).toBe('many')
  })

  it('pulls a sparsely rated score toward the prior', () => {
    expect(smoothedRating(10, 1)).toBeLessThan(8.5)
    expect(smoothedRating(10, 5000)).toBeGreaterThan(9.9)
  })
})
