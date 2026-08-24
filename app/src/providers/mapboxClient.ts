/** Shared plumbing for the Mapbox endpoints. */
export const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
export const BASE = 'https://api.mapbox.com'

export class MapboxError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'MapboxError'
    this.status = status
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).message ?? detail
    } catch { /* error body was not JSON */ }
    throw new MapboxError(detail, res.status)
  }
  return res.json() as Promise<T>
}
