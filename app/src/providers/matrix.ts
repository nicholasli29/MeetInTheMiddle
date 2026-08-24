import type { Mode, Origin } from '../core/types'
import { MapboxError, getJson, BASE, TOKEN } from './mapboxClient'

/** The matrix endpoint accepts at most this many coordinates per request. */
const MATRIX_COORD_LIMIT = 25

interface MatrixResponse {
  code: string
  durations: (number | null)[][] | null
}

const coord = (p: { lng: number; lat: number }) => `${p.lng},${p.lat}`

/**
 * Travel minutes from every starting point to every destination, as
 * [originIndex][destinationIndex]. A null means the pair could not be routed, which the
 * scoring layer treats as unreachable rather than letting it become NaN.
 *
 * Three API constraints shape the request plan:
 *  - One routing profile per request, so starting points are grouped by travel mode and
 *    each group gets its own call. A driving group and a walking group cannot share one.
 *  - At most 25 coordinates per request, so destinations are chunked to fit alongside
 *    each group's sources.
 *  - At least two matrix elements per request. A single source against a single
 *    destination is rejected, and that combination arises in ordinary use.
 */
export async function fetchTravelMatrix(
  origins: Origin[],
  destinations: { lng: number; lat: number }[],
  signal?: AbortSignal,
): Promise<(number | null)[][]> {
  const out: (number | null)[][] = origins.map(() => destinations.map(() => null))
  if (origins.length === 0 || destinations.length === 0) return out

  const byMode = new Map<Mode, number[]>()
  origins.forEach((o, i) => {
    const list = byMode.get(o.mode) ?? []
    list.push(i)
    byMode.set(o.mode, list)
  })

  for (const [mode, originIdx] of byMode) {
    const perChunk = MATRIX_COORD_LIMIT - originIdx.length
    if (perChunk < 1) {
      throw new MapboxError(`Too many starting points on one travel mode (${originIdx.length})`, 400)
    }

    for (let start = 0; start < destinations.length; start += perChunk) {
      const chunk = destinations.slice(start, start + perChunk)

      // Pad a would-be 1x1 request up to two elements; the duplicate column is dropped
      // when the response is unpacked.
      const padded =
        originIdx.length * chunk.length < 2 ? [...chunk, chunk[chunk.length - 1]] : chunk

      const coords = [...originIdx.map((i) => coord(origins[i])), ...padded.map(coord)].join(';')
      const sources = originIdx.map((_, i) => i).join(';')
      const dests = padded.map((_, i) => originIdx.length + i).join(';')

      const data = await getJson<MatrixResponse>(
        `${BASE}/directions-matrix/v1/mapbox/${mode}/${coords}` +
        `?sources=${sources}&destinations=${dests}&annotations=duration&access_token=${TOKEN}`,
        signal,
      )
      if (data.code !== 'Ok' || !data.durations) continue

      data.durations.forEach((row, r) => {
        const globalOrigin = originIdx[r]
        row.forEach((seconds, c) => {
          if (c >= chunk.length) return // padding column
          out[globalOrigin][start + c] = seconds === null ? null : seconds / 60
        })
      })
    }
  }

  return out
}
