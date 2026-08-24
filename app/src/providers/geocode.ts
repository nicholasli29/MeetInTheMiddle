import { TOKEN } from './mapboxClient'

const BASE = 'https://api.mapbox.com/search/searchbox/v1/forward'

export interface GeocodeResult {
  id: string
  /** Short name, used as the starting point's label. */
  name: string
  /** Fuller context, e.g. "San Francisco, California". */
  context: string
  lng: number
  lat: number
}

interface ForwardFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    mapbox_id?: string
    name?: string
    place_formatted?: string
    full_address?: string
  }
}

/**
 * Forward geocoding for starting points.
 *
 * Uses the search endpoint rather than the older geocoder, whose point-of-interest
 * coverage is too thin here: searching "oracle park" there returns Oracle Parkway, a
 * street in another city, and never the stadium. People naming a meeting point say a
 * place far more often than a street address.
 *
 * The single-call forward form is used in preference to suggest-then-retrieve, which
 * exists for session-based billing and costs an extra round trip per selection.
 */
export async function geocode(
  query: string,
  opts: { proximity?: { lng: number; lat: number }; limit?: number; signal?: AbortSignal } = {},
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const params = new URLSearchParams({
    q,
    limit: String(opts.limit ?? 5),
    access_token: TOKEN,
    // Bias toward where the group already is, falling back to the requester's location
    // so a bare "city hall" lands somewhere plausible rather than arbitrarily.
    proximity: opts.proximity ? `${opts.proximity.lng},${opts.proximity.lat}` : 'ip',
  })

  const res = await fetch(`${BASE}?${params}`, { signal: opts.signal })
  // Unlike the other providers this returns nothing rather than throwing: it runs on
  // every keystroke, and an error banner flickering while someone is mid-word is worse
  // than an empty dropdown.
  if (!res.ok) return []

  const body = (await res.json()) as { features?: ForwardFeature[] }
  return (body.features ?? []).flatMap((f, i): GeocodeResult[] => {
    const [lng, lat] = f.geometry?.coordinates ?? []
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
    const p = f.properties ?? {}
    return [{
      id: p.mapbox_id ?? `${lng},${lat},${i}`,
      name: p.name ?? p.full_address ?? q,
      context: p.place_formatted ?? p.full_address ?? '',
      lng,
      lat,
    }]
  })
}
