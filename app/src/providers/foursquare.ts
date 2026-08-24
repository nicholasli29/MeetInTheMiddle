import { distance } from '@turf/turf'
import type { Candidate, Kind } from '../core/types'
import type { AgendaCategory } from './categories'

/**
 * Requests go through the dev server rather than straight from the page.
 *
 * Not a CORS workaround — the API does send permissive CORS headers. It is about the
 * credential: any `VITE_`-prefixed variable is inlined into the client bundle, so a
 * browser-side call would ship the key to every visitor. Proxying keeps it server-side.
 *
 * Node has no such constraint, so the end-to-end test calls the API directly with the
 * key from the environment.
 */
const IN_BROWSER = typeof window !== 'undefined'
const API_VERSION = '2025-06-17'
const BASE = IN_BROWSER
  ? '/api/fsq/places/search'
  : 'https://places-api.foursquare.com/places/search'

/**
 * Only free-tier fields are requested.
 *
 * `price`, `rating`, `hours` and `popularity` are premium fields on this API. Nothing
 * in the ranking depends on any of them, so they are deliberately left out rather than
 * requested and discarded. Adding one to this list is the whole change needed if a
 * later feature wants it.
 */
const FIELDS = 'fsq_place_id,name,latitude,longitude,categories,location,website'

/** A single search returns at most this many results. */
const PAGE_LIMIT = 50

export class FoursquareError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'FoursquareError'
    this.status = status
  }
}

interface FsqPlace {
  fsq_place_id: string
  name: string
  latitude: number
  longitude: number
  categories?: { fsq_category_id: string; name: string }[]
  location?: { formatted_address?: string; address?: string; locality?: string }
  website?: string
}

function directHeaders(): Record<string, string> {
  const key = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.FSQ_KEY ?? ''
  return {
    Authorization: `Bearer ${key}`,
    'X-Places-Api-Version': API_VERSION,
    Accept: 'application/json',
  }
}

async function search(
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<FsqPlace[]> {
  const qs = new URLSearchParams({ ...params, fields: FIELDS } as Record<string, string>)
  const res = await fetch(`${BASE}?${qs}`, {
    signal,
    headers: IN_BROWSER ? { Accept: 'application/json' } : directHeaders(),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).message ?? detail
    } catch { /* error body was not JSON */ }
    throw new FoursquareError(detail, res.status)
  }
  const body = (await res.json()) as { results?: FsqPlace[] }
  return body.results ?? []
}

export type Bbox = [number, number, number, number]

/**
 * The API searches a circle, so a bounding box becomes the circle that encloses it.
 * That circle is deliberately larger than the box; the caller narrows results to the
 * true shared area afterwards.
 */
function circleFor(bbox: Bbox): { ll: string; radius: number } {
  const [w, s, e, n] = bbox
  const centre: [number, number] = [(w + e) / 2, (s + n) / 2]
  const metres = distance(centre, [e, n], { units: 'meters' })
  return { ll: `${centre[1]},${centre[0]}`, radius: Math.min(Math.ceil(metres), 100_000) }
}

function toCandidate(p: FsqPlace, kind: Kind): Candidate {
  return {
    id: p.fsq_place_id,
    name: p.name,
    kind,
    lng: p.longitude,
    lat: p.latitude,
    categoryIds: (p.categories ?? []).map((c) => c.fsq_category_id),
    address: p.location?.formatted_address ?? p.location?.address,
    website: p.website,
    // Paid fields, deliberately not requested — see FIELDS above.
    price: null,
    rating: null,
    ratingCount: 0,
    openNow: null,
  }
}

/** Places of one kind within the search circle for `bbox`. */
export async function fetchCandidates(
  bbox: Bbox,
  categoryIds: string[],
  kind: Kind,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const { ll, radius } = circleFor(bbox)
  const places = await search(
    { ll, radius, fsq_category_ids: categoryIds.join(','), limit: PAGE_LIMIT },
    signal,
  )
  // One place can surface under more than one requested category.
  const byId = new Map<string, FsqPlace>()
  for (const place of places) {
    if (!byId.has(place.fsq_place_id)) byId.set(place.fsq_place_id, place)
  }
  return [...byId.values()].map((p) => toCandidate(p, kind))
}

export interface AgendaPlaces {
  /** Agenda key to the places found for it inside the area. */
  byCategory: Map<string, { lng: number; lat: number }[]>
  /** Agenda keys that returned nothing anywhere in the area. */
  empty: string[]
}

/**
 * Fetch each chosen agenda category once across the whole area.
 *
 * Looking up every candidate's surroundings separately would cost candidates × categories
 * requests and force an arbitrary "only score the top N" cut-off. One request per
 * category instead, after which proximity is plain geometry and free.
 *
 * Results are attributed to the query that returned them rather than matched against ids
 * on the response. Searching by a parent category works, but places come back carrying
 * leaf ids, so comparing a response id to the parent would never match.
 */
export async function fetchAgendaPlaces(
  bbox: Bbox,
  categories: AgendaCategory[],
  signal?: AbortSignal,
): Promise<AgendaPlaces> {
  const { ll, radius } = circleFor(bbox)
  const byCategory = new Map<string, { lng: number; lat: number }[]>()
  const empty: string[] = []

  const results = await Promise.all(
    categories.map(async (cat) => ({
      cat,
      places: await search({ ll, radius, fsq_category_ids: cat.id, limit: PAGE_LIMIT }, signal),
    })),
  )

  for (const { cat, places } of results) {
    byCategory.set(cat.key, places.map((p) => ({ lng: p.longitude, lat: p.latitude })))
    if (places.length === 0) empty.push(cat.key)
  }

  return { byCategory, empty }
}
