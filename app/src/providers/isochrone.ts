import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { Zone } from '../core/geo'
import { MAX_CONTOUR_MINUTES, type Origin } from '../core/types'
import { MapboxError, getJson, BASE, TOKEN } from './mapboxClient'

/**
 * The area reachable from one starting point.
 *
 * Contours above 60 minutes are rejected by the API, so the value is clamped here as
 * well as bounded in the UI — a slider is easy to change, and a 422 mid-demo is not a
 * good way to find out.
 */
export async function fetchIsochrone(origin: Origin, signal?: AbortSignal): Promise<Zone> {
  const minutes = Math.min(Math.max(1, Math.round(origin.maxMinutes)), MAX_CONTOUR_MINUTES)
  const url =
    `${BASE}/isochrone/v1/mapbox/${origin.mode}/${origin.lng},${origin.lat}` +
    `?contours_minutes=${minutes}&polygons=true&denoise=1&access_token=${TOKEN}`

  const fc = await getJson<{ features: Feature<Polygon | MultiPolygon>[] }>(url, signal)
  const feature = fc.features?.[0]
  if (!feature) throw new MapboxError(`No reachable area returned for ${origin.label}`, 200)
  return feature as Zone
}

export async function fetchIsochrones(origins: Origin[], signal?: AbortSignal): Promise<Zone[]> {
  return Promise.all(origins.map((o) => fetchIsochrone(o, signal)))
}
