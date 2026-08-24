import { describe, expect, it } from 'vitest'
import { decodePlan, encodePlan, type SharedPlan } from './share'
import type { Origin } from './types'

const origin = (over: Partial<Origin> = {}): Origin => ({
  id: 'x', label: 'Alex', lng: -122.4194, lat: 37.7749, mode: 'driving', maxMinutes: 45, ...over,
})

const plan = (over: Partial<SharedPlan> = {}): SharedPlan => ({
  origins: [origin(), origin({ label: 'Bea', lng: -122.2712, lat: 37.8044, mode: 'cycling' })],
  kind: 'venue',
  agendaKeys: ['dining', 'bars'],
  weights: { speed: 0.4, fairness: 0.35, agenda: 0.25 },
  ...over,
})

describe('share links', () => {
  it('round-trips a plan', () => {
    const back = decodePlan(encodePlan(plan()))!
    expect(back.origins.map((o) => [o.label, o.lng, o.lat, o.mode, o.maxMinutes]))
      .toEqual([['Alex', -122.4194, 37.7749, 'driving', 45], ['Bea', -122.2712, 37.8044, 'cycling', 45]])
    expect(back.kind).toBe('venue')
    expect(back.agendaKeys).toEqual(['dining', 'bars'])
    expect(back.weights).toEqual({ speed: 0.4, fairness: 0.35, agenda: 0.25 })
  })

  it('keeps a label containing a comma intact', () => {
    const back = decodePlan(encodePlan(plan({ origins: [origin({ label: 'Oakland, CA' })] })))!
    expect(back.origins[0].label).toBe('Oakland, CA')
  })

  it('carries the date only for events', () => {
    expect(decodePlan(encodePlan(plan({ kind: 'event', eventDate: '2026-08-29' })))!.eventDate)
      .toBe('2026-08-29')
    expect(decodePlan(encodePlan(plan({ kind: 'venue', eventDate: '2026-08-29' })))!.eventDate)
      .toBeUndefined()
  })

  it('returns null when there is nothing to rebuild', () => {
    expect(decodePlan('')).toBeNull()
    expect(decodePlan('k=venue')).toBeNull()
    expect(decodePlan('o=notanumber,alsonot,d,45,X')).toBeNull()
  })

  it('drops impossible coordinates rather than plotting them', () => {
    // A hand-edited or truncated link should not produce a starting point off the globe.
    expect(decodePlan('o=999,37.7,d,45,Bad')).toBeNull()
    const mixed = decodePlan('o=999,37.7,d,45,Bad|-122.42,37.77,d,45,Good')!
    expect(mixed.origins.map((o) => o.label)).toEqual(['Good'])
  })

  it('falls back to defaults for a malformed weight list', () => {
    const back = decodePlan('o=-122.42,37.77,d,45,Alex&w=broken')!
    expect(back.weights).toEqual({ speed: 0.4, fairness: 0.35, agenda: 0.25 })
  })

  it('clamps a travel budget beyond the API ceiling', () => {
    expect(decodePlan('o=-122.42,37.77,d,900,Alex')!.origins[0].maxMinutes).toBe(60)
  })
})
