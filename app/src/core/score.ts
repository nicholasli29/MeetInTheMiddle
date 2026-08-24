import type {
  AgendaFacts, Candidate, Origin, ScoredCandidate, TravelFacts, Weights,
} from './types'

/**
 * Smallest spread a normalisation is allowed to assume, per axis.
 *
 * Plain min-max stretches whatever range it is given across the full 0–1 interval, so a
 * set whose averages differ by twenty seconds would be presented as the gap between best
 * and worst. Flooring the denominator keeps small real differences small.
 */
const MIN_RANGE_MINUTES = 5
const MIN_RANGE_AGENDA = 0.15

/** Nearby matches per agenda category beyond which more stop counting. */
const DENSITY_CAP = 5

/** Prior for smoothing ratings: a mid rating worth this many votes. */
const RATING_PRIOR = 7.5
const RATING_PRIOR_WEIGHT = 20

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Min-max normalise with a floored denominator.
 *
 * Returns a neutral 0.5 when every value is identical: the axis cannot separate anything,
 * and reporting 0 would invert to a full bar and read as "all optimal" rather than
 * "nothing to choose between". Checked before the floor is applied, or the branch is
 * unreachable.
 */
export function normalise(x: number, xs: number[], floor: number): number {
  if (!Number.isFinite(x)) return 0.5
  const finite = xs.filter(Number.isFinite)
  if (finite.length === 0) return 0.5
  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  if (hi === lo) return 0.5
  return clamp01((x - lo) / Math.max(hi - lo, floor))
}

/**
 * Travel facts for one candidate.
 *
 * The matrix returns null for pairs it cannot route, and `Math.max(...[5, null])` is NaN,
 * which then sorts arbitrarily and without error. Nulls are dropped here, once, so
 * nothing downstream has to remember to.
 */
export function travelFacts(minutes: (number | null)[], origins: Origin[]): TravelFacts {
  const routable: { i: number; m: number }[] = []
  minutes.forEach((m, i) => {
    if (m !== null && Number.isFinite(m)) routable.push({ i, m })
  })

  const ms = routable.map((r) => r.m)
  return {
    minutes,
    reachableBy: routable.filter(({ i, m }) => m <= origins[i].maxMinutes).map(({ i }) => i),
    meanMinutes: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null,
    spreadMinutes: ms.length >= 2 ? Math.max(...ms) - Math.min(...ms) : null,
  }
}

/** Mean saturating density across the selected agenda categories, 0–1. */
export function agendaDensity(agenda: AgendaFacts, selected: string[]): number {
  if (selected.length === 0) return 0
  const total = selected.reduce(
    (acc, key) => acc + Math.min(agenda.counts[key] ?? 0, DENSITY_CAP) / DENSITY_CAP,
    0,
  )
  return total / selected.length
}

/**
 * A rating pulled toward the prior in proportion to how few votes back it.
 *
 * Used only to settle equal scores, so a 9.8 from three votes does not outrank an 8.9
 * from three thousand.
 */
export function smoothedRating(rating: number | null, count: number): number {
  if (rating === null) return RATING_PRIOR
  return (RATING_PRIOR * RATING_PRIOR_WEIGHT + rating * count) / (RATING_PRIOR_WEIGHT + count)
}

/**
 * Drop axes with no data behind them and rescale the rest to sum to 1.
 *
 * With no agenda selected the raw agenda score is 0/0. Emitting NaN would propagate into
 * the composite and make the sort return an arbitrary order with no error at all.
 */
export function effectiveWeights(w: Weights, opts: { agenda: boolean }): Weights {
  const active: Weights = {
    speed: Math.max(0, w.speed),
    fairness: Math.max(0, w.fairness),
    agenda: opts.agenda ? Math.max(0, w.agenda) : 0,
  }
  const sum = active.speed + active.fairness + active.agenda
  if (sum <= 0) {
    const n = opts.agenda ? 3 : 2
    return { speed: 1 / n, fairness: 1 / n, agenda: opts.agenda ? 1 / n : 0 }
  }
  return {
    speed: active.speed / sum,
    fairness: active.fairness / sum,
    agenda: active.agenda / sum,
  }
}

export interface ScoreInput {
  candidate: Candidate
  travel: TravelFacts
  agenda: AgendaFacts
}

/**
 * Score and rank a candidate set.
 *
 * Every axis is normalised the same way against the same surviving set, which is what
 * makes the weights mean what the sliders claim. Were one axis absolute and another
 * relative to the results, an identical weight would move the ranking by very different
 * amounts on each.
 */
export function rank(
  inputs: ScoreInput[],
  weights: Weights,
  selectedAgenda: string[],
): ScoredCandidate[] {
  const agendaOn = selectedAgenda.length > 0
  const w = effectiveWeights(weights, { agenda: agendaOn })

  const means = inputs.map((i) => i.travel.meanMinutes).filter((m): m is number => m !== null)
  const spreads = inputs.map((i) => i.travel.spreadMinutes).filter((s): s is number => s !== null)
  const agendaRaw = inputs.map((i) => (agendaOn ? agendaDensity(i.agenda, selectedAgenda) : 0))

  const scored = inputs.map((input, idx): ScoredCandidate => {
    // Quicker and more evenly shared are both better, hence 1 - normalised.
    const speed =
      input.travel.meanMinutes === null
        ? 0
        : 1 - normalise(input.travel.meanMinutes, means, MIN_RANGE_MINUTES)

    // One routable origin has no spread worth speaking of. Neutral, not perfect —
    // otherwise the least reachable places would top the fairness axis for free.
    const fairness =
      input.travel.spreadMinutes === null
        ? 0.5
        : 1 - normalise(input.travel.spreadMinutes, spreads, MIN_RANGE_MINUTES)

    const agenda = agendaOn ? normalise(agendaRaw[idx], agendaRaw, MIN_RANGE_AGENDA) : 0

    const axes: Weights = { speed, fairness, agenda }
    const contributions: Weights = {
      speed: w.speed * speed,
      fairness: w.fairness * fairness,
      agenda: w.agenda * agenda,
    }
    const total = contributions.speed + contributions.fairness + contributions.agenda

    return {
      candidate: input.candidate,
      travel: input.travel,
      agenda: input.agenda,
      axes,
      contributions,
      total: Number.isFinite(total) ? total : 0,
    }
  })

  // Ties are common — agenda densities are coarse and travel times cluster — so the
  // ordering is settled explicitly rather than inherited from whatever order arrived.
  return scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    const ar = smoothedRating(a.candidate.rating, a.candidate.ratingCount)
    const br = smoothedRating(b.candidate.rating, b.candidate.ratingCount)
    if (br !== ar) return br - ar
    return a.candidate.name.localeCompare(b.candidate.name)
  })
}
