import { distance } from '@turf/turf'
import { bboxOf, bestOverlap, containsPoint, type Zone } from './geo'
import { rank, travelFacts, type ScoreInput } from './score'
import type { Candidate, Kind, Origin, ScoredCandidate, Weights } from './types'
import { fetchIsochrones } from '../providers/isochrone'
import { fetchTravelMatrix } from '../providers/matrix'
import { fetchAgendaPlaces, fetchCandidates, type Bbox } from '../providers/foursquare'
import {
  CATEGORY_BY_KEY, DEFAULT_VENUE_CATEGORY_IDS, HOTEL_CATEGORY_ID,
} from '../providers/categories'
import { fetchEvents, todayLocalISO } from '../providers/ticketmaster'

/** Roughly a fifteen minute walk — the radius agenda density is measured over. */
export const WALK_RADIUS_M = 1200
/** Anything nearer than this is the candidate itself, not something near it. */
export const SELF_RADIUS_M = 40

export interface PlanRequest {
  origins: Origin[]
  kind: Kind
  agendaKeys: string[]
  weights: Weights
  /** Local calendar date (YYYY-MM-DD). Only meaningful when kind is 'event'. */
  eventDate?: string
}

export interface PlanResult {
  zones: Zone[]
  /** The shared area, or the largest partial one when not everyone can meet. */
  overlap: Zone | null
  /** Indices of the starting points sharing `overlap`. */
  includedOrigins: number[]
  excludedOrigins: number[]
  /**
   * Starting points that could not be routed from where they were placed — a click in
   * water or open country. Routing snaps to the nearest road, so these otherwise
   * produce a reachable area somewhere else entirely and quietly distort the result.
   */
  unroutableOrigins: number[]
  /**
   * Everything needed to re-rank without touching the network. Moving a weight slider
   * is a pure recomputation over these, which is what makes it respond immediately
   * instead of refetching reachable areas and travel times.
   */
  inputs: ScoreInput[]
  results: ScoredCandidate[]
  /** Agenda categories that returned nothing anywhere in the area. */
  emptyCategories: string[]
  /** Set when there is an area but nothing worth ranking inside it. */
  note: string | null
}

function categoryIdsFor(kind: Kind, agendaKeys: string[]): string[] {
  if (kind === 'hotel') return [HOTEL_CATEGORY_ID]
  const picked = agendaKeys
    .map((k) => CATEGORY_BY_KEY.get(k)?.id)
    .filter((id): id is string => !!id)
  return picked.length ? picked : DEFAULT_VENUE_CATEGORY_IDS
}

/**
 * How many places of each chosen category sit within a walk of this candidate.
 * Computed from the per-category fetch, so it costs no additional requests.
 */
function agendaFactsFor(
  candidate: Candidate,
  byCategory: Map<string, { lng: number; lat: number }[]>,
) {
  const counts: Record<string, number> = {}
  const matched: string[] = []
  for (const [key, places] of byCategory) {
    const n = places.filter((p) => {
      const m = distance([candidate.lng, candidate.lat], [p.lng, p.lat], { units: 'meters' })
      // Excluding the candidate itself matters: venues are drawn from the same
      // categories as the agenda, so every bar would otherwise report a bar nearby and
      // the axis would say nothing at all.
      return m > SELF_RADIUS_M && m <= WALK_RADIUS_M
    }).length
    counts[key] = n
    if (n > 0) matched.push(key)
  }
  return { matched, counts }
}

/**
 * Run a full plan.
 *
 * The ordering is deliberate: the shared area is resolved first so every later request
 * is scoped to it, and travel times are fetched only for the candidates that survive
 * the geometric filter rather than for everything the search returned.
 */
export async function runPlan(req: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
  const { origins, kind, agendaKeys, weights, eventDate } = req

  const zones = await fetchIsochrones(origins, signal)

  /**
   * A starting point should fall inside the area reachable from it. When it does not,
   * routing snapped the click to a road some distance away — the usual cause being a
   * point dropped in water — and the area returned describes somewhere else.
   */
  const routable: number[] = []
  const unroutableOrigins: number[] = []
  origins.forEach((o, i) => {
    (containsPoint(zones[i], o.lng, o.lat) ? routable : unroutableOrigins).push(i)
  })

  const emptyResult = (note: string): PlanResult => ({
    zones, overlap: null, includedOrigins: [], excludedOrigins: origins.map((_, i) => i),
    unroutableOrigins, inputs: [], results: [], emptyCategories: [], note,
  })

  if (routable.length < 2) {
    return emptyResult(
      unroutableOrigins.length > 0
        ? 'Some starting points are not reachable by road. Move them onto a street.'
        : 'Add at least two starting points that can be routed.',
    )
  }

  // Only routable starting points shape the shared area; a snapped one would drag it
  // somewhere nobody asked about.
  const routableZones = routable.map((i) => zones[i])
  const bestOfRoutable = bestOverlap(routableZones)
  if (!bestOfRoutable) {
    return emptyResult('No two of these starting points can reach anywhere in common. Try longer travel times.')
  }
  // bestOverlap indexes into routableZones, so map back to the caller's numbering.
  const best = { zone: bestOfRoutable.zone, indices: bestOfRoutable.indices.map((i) => routable[i]) }

  const includedOrigins = best.indices
  const excludedOrigins = origins
    .map((_, i) => i)
    .filter((i) => !includedOrigins.includes(i) && !unroutableOrigins.includes(i))
  const bbox = bboxOf(best.zone) as Bbox

  const agendaCategories = agendaKeys
    .map((k) => CATEGORY_BY_KEY.get(k))
    .filter((c): c is NonNullable<typeof c> => !!c)

  const [rawCandidates, agendaPlaces] = await Promise.all([
    kind === 'event'
      ? fetchEvents(bbox, eventDate ?? todayLocalISO(), signal)
      : fetchCandidates(bbox, categoryIdsFor(kind, agendaKeys), kind, signal),
    agendaCategories.length
      ? fetchAgendaPlaces(bbox, agendaCategories, signal)
      : Promise.resolve({ byCategory: new Map(), empty: [] }),
  ])

  // The search circle is wider than the shared area, so narrow to the real shape.
  const inZone = rawCandidates.filter((c) => containsPoint(best.zone, c.lng, c.lat))
  if (inZone.length === 0) {
    return {
      zones, overlap: best.zone, includedOrigins, excludedOrigins, unroutableOrigins,
      inputs: [], results: [], emptyCategories: agendaPlaces.empty,
      note: kind === 'event'
        ? (eventDate ?? '') < todayLocalISO()
          ? 'That date has already passed, so nothing is listed for it.'
          : 'No events in the shared area on that date. Listings thin out midweek — try a weekend.'
        : 'Nothing matching was found in the shared area. Try another tab or a wider agenda.',
    }
  }

  // Only the starting points that actually share the area contribute travel times.
  const scoringOrigins = includedOrigins.map((i) => origins[i])
  const matrix = await fetchTravelMatrix(scoringOrigins, inZone, signal)

  const inputs: ScoreInput[] = inZone.map((candidate, ci) => ({
    candidate,
    travel: travelFacts(scoringOrigins.map((_, oi) => matrix[oi][ci]), scoringOrigins),
    agenda: agendaFactsFor(candidate, agendaPlaces.byCategory),
  }))

  // Somewhere nobody in the group can actually reach is not a result.
  const reachable = inputs.filter((i) => i.travel.reachableBy.length > 0)

  return {
    zones,
    overlap: best.zone,
    includedOrigins,
    excludedOrigins,
    unroutableOrigins,
    inputs: reachable,
    results: rank(reachable, weights, agendaKeys),
    emptyCategories: agendaPlaces.empty,
    note: reachable.length === 0
      ? 'Places were found in the shared area, but none within everyone’s travel time.'
      : null,
  }
}
