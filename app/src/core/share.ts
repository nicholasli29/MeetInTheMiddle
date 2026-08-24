import type { Kind, Mode, Origin, Weights } from './types'

/**
 * The whole plan encoded into a query string.
 *
 * Small enough to carry in a link, so sharing needs no storage, no accounts and no
 * server. The trade is that a link is a snapshot: reopening it rebuilds the plan from
 * live data rather than restoring a saved result.
 */
export interface SharedPlan {
  origins: Origin[]
  kind: Kind
  agendaKeys: string[]
  weights: Weights
  eventDate?: string
}

const MODE_CODE: Record<Mode, string> = { driving: 'd', walking: 'w', cycling: 'c' }
const CODE_MODE: Record<string, Mode> = { d: 'driving', w: 'walking', c: 'cycling' }

/** Five decimals is a little over a metre — far finer than anyone places a pin. */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5

export function encodePlan(plan: SharedPlan): string {
  const p = new URLSearchParams()
  p.set('o', plan.origins.map((o) =>
    // The label is last so a comma inside it cannot be mistaken for a field separator.
    [round5(o.lng), round5(o.lat), MODE_CODE[o.mode], o.maxMinutes, o.label].join(','),
  ).join('|'))
  p.set('k', plan.kind)
  if (plan.agendaKeys.length) p.set('a', plan.agendaKeys.join(','))
  p.set('w', [plan.weights.speed, plan.weights.fairness, plan.weights.agenda]
    .map((n) => Math.round(n * 100)).join(','))
  if (plan.kind === 'event' && plan.eventDate) p.set('d', plan.eventDate)
  return p.toString()
}

/**
 * Rebuild a plan from a query string, returning null when there is nothing usable.
 *
 * Every field is validated rather than trusted: a link can be edited by hand or
 * truncated by whatever carried it, and a malformed one should open the ordinary empty
 * app rather than a half-built plan.
 */
export function decodePlan(search: string): SharedPlan | null {
  const p = new URLSearchParams(search)
  const raw = p.get('o')
  if (!raw) return null

  const origins: Origin[] = []
  for (const part of raw.split('|')) {
    const [lngS, latS, modeS, minsS, ...labelParts] = part.split(',')
    const lng = Number(lngS)
    const lat = Number(latS)
    const maxMinutes = Number(minsS)
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) continue
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) continue
    if (!Number.isFinite(maxMinutes) || maxMinutes < 1) continue
    origins.push({
      id: crypto.randomUUID(),
      label: labelParts.join(',') || `Point ${origins.length + 1}`,
      lng,
      lat,
      mode: CODE_MODE[modeS] ?? 'driving',
      maxMinutes: Math.min(Math.round(maxMinutes), 60),
    })
  }
  if (origins.length === 0) return null

  const kindRaw = p.get('k')
  const kind: Kind = kindRaw === 'hotel' || kindRaw === 'event' ? kindRaw : 'venue'

  const w = (p.get('w') ?? '').split(',').map(Number)
  const valid = w.length === 3 && w.every((n) => Number.isFinite(n) && n >= 0)
  const weights: Weights = valid
    ? { speed: w[0] / 100, fairness: w[1] / 100, agenda: w[2] / 100 }
    : { speed: 0.4, fairness: 0.35, agenda: 0.25 }

  return {
    origins,
    kind,
    agendaKeys: (p.get('a') ?? '').split(',').filter(Boolean),
    weights,
    eventDate: p.get('d') ?? undefined,
  }
}
