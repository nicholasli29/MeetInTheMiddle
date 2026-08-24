import { describe, expect, it } from 'vitest'
import { multiPolygon, polygon } from '@turf/turf'
import { bestOverlap, containsPoint, intersectAll, type Zone } from './geo'

const sq = (x: number, y: number, s = 2): Zone =>
  polygon([[[x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]]]) as Zone

describe('geo', () => {
  it('folds an N-way intersection', () => {
    expect(intersectAll([sq(0, 0, 3), sq(1, 1, 3), sq(2, 2, 3)])?.geometry.type).toBe('Polygon')
  })

  it('returns null when nothing is common to all', () => {
    expect(intersectAll([sq(0, 0), sq(10, 10), sq(20, 20)])).toBeNull()
  })

  it('falls back to the largest overlapping subset', () => {
    const best = bestOverlap([sq(0, 0), sq(1, 1), sq(50, 50)])
    expect(best?.indices).toEqual([0, 1])
  })

  it('never returns a zero-area geometry for shapes that merely touch', () => {
    const z = intersectAll([sq(0, 0), sq(2, 0)])
    expect(z === null || z.geometry.type === 'Polygon' || z.geometry.type === 'MultiPolygon').toBe(true)
  })

  it('respects holes and disconnected parts', () => {
    const zone = multiPolygon([
      [
        [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
        [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]],
      ],
      [[[20, 20], [20, 22], [22, 22], [22, 20], [20, 20]]],
    ]) as Zone
    expect(containsPoint(zone, 1, 1)).toBe(true)
    expect(containsPoint(zone, 5, 5)).toBe(false)  // inside the hole
    expect(containsPoint(zone, 21, 21)).toBe(true) // the detached part
  })
})
