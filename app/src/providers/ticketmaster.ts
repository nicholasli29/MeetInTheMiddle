import { distance } from '@turf/turf'
import type { Candidate, EventInfo } from '../core/types'
import type { Bbox } from './foursquare'

/**
 * The events API authenticates with a query parameter. In the browser the request goes
 * through the dev-server proxy, which appends the key server-side; in Node the key comes
 * from the environment.
 */
const IN_BROWSER = typeof window !== 'undefined'
const BASE = IN_BROWSER
  ? '/api/tm/discovery/v2/events.json'
  : 'https://app.ticketmaster.com/discovery/v2/events.json'

const PAGE_SIZE = 100

export class TicketmasterError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TicketmasterError'
    this.status = status
  }
}

interface TmEvent {
  id: string
  name: string
  url: string
  dates?: {
    start?: { localDate?: string; localTime?: string; noSpecificTime?: boolean; timeTBA?: boolean }
    status?: { code?: string }
  }
  priceRanges?: { currency?: string; min?: number; max?: number }[]
  classifications?: { segment?: { name?: string }; genre?: { name?: string } }[]
  _embedded?: {
    venues?: {
      name?: string
      location?: { latitude?: string; longitude?: string }
      address?: { line1?: string }
      city?: { name?: string }
    }[]
  }
}

/**
 * Statuses not worth listing.
 *
 * Live data routinely contains both cancelled and rescheduled entries. Cancelled ones
 * are dropped; off-sale ones are kept, because "this is happening but you cannot buy a
 * ticket right now" is still useful when deciding where to go.
 */
const DEAD_STATUSES = new Set(['cancelled', 'canceled'])

function circleFor(bbox: Bbox): { latlong: string; radiusMiles: number } {
  const [w, s, e, n] = bbox
  const centre: [number, number] = [(w + e) / 2, (s + n) / 2]
  const miles = distance(centre, [e, n], { units: 'miles' })
  return {
    latlong: `${centre[1]},${centre[0]}`,
    radiusMiles: Math.min(Math.max(Math.ceil(miles), 1), 250),
  }
}

function toCandidate(e: TmEvent): Candidate | null {
  const venue = e._embedded?.venues?.[0]
  const lat = Number(venue?.location?.latitude)
  const lng = Number(venue?.location?.longitude)
  // Coordinates arrive as strings and are occasionally missing. An event that cannot be
  // placed on the map cannot be scored on travel time either.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const start = e.dates?.start
  const price = e.priceRanges?.[0]
  const cls = e.classifications?.[0]

  const event: EventInfo = {
    localDate: start?.localDate ?? '',
    localTime: start?.noSpecificTime || start?.timeTBA ? null : start?.localTime ?? null,
    url: e.url,
    venueName: venue?.name ?? null,
    segment: cls?.segment?.name ?? null,
    genre: cls?.genre?.name ?? null,
    priceMin: typeof price?.min === 'number' ? price.min : null,
    priceMax: typeof price?.max === 'number' ? price.max : null,
    currency: price?.currency ?? null,
  }

  return {
    id: e.id,
    name: e.name,
    kind: 'event',
    lat,
    lng,
    categoryIds: [],
    address: [venue?.address?.line1, venue?.city?.name].filter(Boolean).join(', ') || undefined,
    website: e.url,
    price: null,
    rating: null,
    ratingCount: 0,
    openNow: null,
    event,
  }
}

/**
 * Events starting on `localDate` (YYYY-MM-DD) within the area.
 *
 * The filter is on local start time, which the API interprets in each event's own
 * timezone. Converting the chosen day into a UTC window instead would shift both
 * boundaries by the offset — an 8pm show is already the next day in UTC — silently
 * dropping late-night events and pulling in the previous evening's.
 */
export async function fetchEvents(
  bbox: Bbox,
  localDate: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const { latlong, radiusMiles } = circleFor(bbox)

  const params: Record<string, string> = {
    latlong,
    radius: String(radiusMiles),
    unit: 'miles',
    localStartDateTime: `${localDate}T00:00:00,${localDate}T23:59:59`,
    size: String(PAGE_SIZE),
    sort: 'date,asc',
  }
  if (!IN_BROWSER) {
    params.apikey = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.TM_KEY ?? ''
  }

  const res = await fetch(`${BASE}?${new URLSearchParams(params)}`, { signal })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body?.fault?.faultstring ?? body?.errors?.[0]?.detail ?? detail
    } catch { /* error body was not JSON */ }
    throw new TicketmasterError(detail, res.status)
  }

  const body = (await res.json()) as { _embedded?: { events?: TmEvent[] } }
  const live = (body._embedded?.events ?? [])
    .filter((e) => !DEAD_STATUSES.has(e.dates?.status?.code ?? ''))
    .map(toCandidate)
    .filter((c): c is Candidate => c !== null)

  // The same event can appear more than once across paginated classifications.
  const byId = new Map<string, Candidate>()
  for (const c of live) if (!byId.has(c.id)) byId.set(c.id, c)
  return [...byId.values()]
}

/** Today's date in the viewer's own timezone, as YYYY-MM-DD. */
export function todayLocalISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
