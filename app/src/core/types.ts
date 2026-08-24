export type Mode = 'driving' | 'walking' | 'cycling'
export type Kind = 'venue' | 'hotel' | 'event'

/**
 * A starting point is a place, a way of travelling and a time budget.
 *
 * Deliberately not modelled as "a person": the label is presentational, so the same
 * engine works if starting points later come from stations or landmarks instead.
 */
export interface Origin {
  id: string
  label: string
  lng: number
  lat: number
  mode: Mode
  /** Minutes. The isochrone API rejects contours above 60. */
  maxMinutes: number
}

export const MAX_CONTOUR_MINUTES = 60

export interface Candidate {
  id: string
  name: string
  kind: Kind
  lng: number
  lat: number
  categoryIds: string[]
  address?: string
  website?: string
  /**
   * 1–4 tier, shown on the result card but not scored on. Absent for about a
   * quarter of places, and never guessed at.
   */
  price: number | null
  /** 0–10, with the number of ratings behind it. */
  rating: number | null
  ratingCount: number
  openNow: boolean | null
}

/** Travel facts for one candidate, index-aligned with the origins used to score it. */
export interface TravelFacts {
  /** Minutes from each origin; null where the pair could not be routed. */
  minutes: (number | null)[]
  /** Indices of origins that can reach this within their own budget. */
  reachableBy: number[]
  /** Mean across routable origins, or null if none are. */
  meanMinutes: number | null
  /** Longest minus shortest across routable origins; null below two. */
  spreadMinutes: number | null
}

export interface AgendaFacts {
  /** Selected agenda keys with at least one match within walking distance. */
  matched: string[]
  /** Matches per selected agenda key. */
  counts: Record<string, number>
}

export interface Weights {
  speed: number
  fairness: number
  agenda: number
}

export const AXES = ['speed', 'fairness', 'agenda'] as const
export type Axis = (typeof AXES)[number]

export interface ScoredCandidate {
  candidate: Candidate
  travel: TravelFacts
  agenda: AgendaFacts
  /** Normalised 0–1 per axis, as used for ranking. */
  axes: Weights
  /** Weighted contributions; these sum to `total` and drive the breakdown bar. */
  contributions: Weights
  total: number
}
