import { area, bbox, booleanPointInPolygon, featureCollection, intersect } from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

export type Zone = Feature<Polygon | MultiPolygon>

/**
 * Turf's `intersect` takes a FeatureCollection of two features, and what comes back is
 * not guaranteed to have area: shapes touching at a point or along an edge produce a
 * Point or LineString. Both facts are load-bearing, so results are narrowed here once.
 */
function isAreal(f: Feature | null): f is Zone {
  return !!f && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
}

function intersectPair(a: Zone, b: Zone): Zone | null {
  let out: Feature | null = null
  try {
    out = intersect(featureCollection([a, b])) as Feature | null
  } catch {
    // Turf throws rather than returning null on some degenerate inputs.
    return null
  }
  return isAreal(out) ? out : null
}

/** Fold an N-way intersection, bailing as soon as the running result is empty. */
export function intersectAll(zones: Zone[]): Zone | null {
  if (zones.length === 0) return null
  let acc: Zone | null = zones[0]
  for (let i = 1; i < zones.length; i++) {
    if (!acc) return null
    acc = intersectPair(acc, zones[i])
  }
  return acc
}

/**
 * The largest group of starting points that share a zone.
 *
 * Groups frequently have no area everyone can reach, and answering "nowhere" would be
 * accurate and useless. Falling back to the biggest subset that does overlap keeps the
 * result actionable and lets the UI name who was left out. Exhaustive over subsets,
 * which is fine because the number of starting points is capped well inside single
 * figures.
 */
export function bestOverlap(zones: Zone[]): { zone: Zone; indices: number[] } | null {
  const n = zones.length
  if (n === 0) return null

  const all = intersectAll(zones)
  if (all) return { zone: all, indices: zones.map((_, i) => i) }

  for (let size = n - 1; size >= 2; size--) {
    let best: { zone: Zone; indices: number[]; area: number } | null = null
    for (const subset of combinations(n, size)) {
      const z = intersectAll(subset.map((i) => zones[i]))
      if (!z) continue
      const a = area(z)
      if (!best || a > best.area) best = { zone: z, indices: subset, area: a }
    }
    // Prefer the biggest group; among equally sized groups, the roomiest zone.
    if (best) return { zone: best.zone, indices: best.indices }
  }
  return null
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i)
  for (;;) {
    yield idx.slice()
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

/** [west, south, east, north] */
export function bboxOf(zone: Zone): [number, number, number, number] {
  const b = bbox(zone)
  return [b[0], b[1], b[2], b[3]]
}

/**
 * Point-in-polygon that respects interior rings and disconnected parts. Reachable areas
 * are routinely full of holes, and ray casting over `coordinates[0]` would quietly
 * mis-answer for every one of them.
 */
export function containsPoint(zone: Zone, lng: number, lat: number): boolean {
  return booleanPointInPolygon([lng, lat], zone)
}
