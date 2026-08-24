import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runPlan, type PlanResult } from './core/plan'
import { rank } from './core/score'
import type { Kind, Origin, Weights } from './core/types'
import { AgendaChips, EventDate, KindTabs, OriginPanel, WeightSliders } from './ui/Controls'
import { MapView } from './ui/MapView'
import type { GeocodeResult } from './providers/geocode'
import { todayLocalISO } from './providers/ticketmaster'
import { ResultList } from './ui/ResultList'

const DEFAULT_WEIGHTS: Weights = { speed: 0.4, fairness: 0.35, agenda: 0.25 }

const NAMES = ['Alex', 'Bea', 'Cass', 'Dana', 'Eli', 'Fran', 'Gil', 'Hana']

/**
 * A worked scenario, offered rather than loaded on start.
 *
 * Opening on an empty map keeps placing your own starting points the primary action;
 * the example exists so the app can be seen working without knowing a city well enough
 * to pick three sensible points.
 */
const EXAMPLE: Omit<Origin, 'id'>[] = [
  { label: 'Alex', lng: -122.4194, lat: 37.7749, mode: 'driving', maxMinutes: 45 },
  { label: 'Bea',  lng: -122.2712, lat: 37.8044, mode: 'driving', maxMinutes: 45 },
  { label: 'Cass', lng: -121.8863, lat: 37.3382, mode: 'driving', maxMinutes: 60 },
]

/**
 * Upper bound on starting points.
 *
 * The travel matrix allows 25 coordinates per request and the shared-area fallback
 * searches subsets exhaustively, so both degrade past a small group. Eight sits well
 * inside either limit.
 */
const MAX_ORIGINS = NAMES.length

export default function App() {
  const [origins, setOrigins] = useState<Origin[]>([])
  const [kind, setKind] = useState<Kind>('venue')
  const [agendaKeys, setAgendaKeys] = useState<string[]>([])
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [addMode, setAddMode] = useState(true)
  // Today in the viewer's own timezone, not the machine's UTC date.
  const [eventDate, setEventDate] = useState(() => todayLocalISO())

  const [plan, setPlan] = useState<PlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [limitHit, setLimitHit] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Refetch when something that needs the network changes.
   *
   * Weights are deliberately absent from the dependencies: they only affect ranking,
   * which is recomputed below without a request.
   */
  useEffect(() => {
    // Clearing here rather than deriving during render is deliberate — `plan` holds the
    // result of an async fetch, so there is nothing to derive it from once the inputs
    // stop being valid.
    if (origins.length < 2) {
      setPlan(null)
      setError(null)
      return
    }

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      setLoading(true)
      setError(null)

      runPlan({ origins, kind, agendaKeys, weights: DEFAULT_WEIGHTS, eventDate }, ac.signal)
        .then((res) => { if (!ac.signal.aborted) { setPlan(res); setSelectedId(null) } })
        .catch((e: unknown) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
          setError(e instanceof Error ? e.message : 'Something went wrong')
          setPlan(null)
        })
        .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    }, 450) // fold a burst of pin drags or slider moves into one request

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [origins, kind, agendaKeys, eventDate])

  // Re-ranking on a weight change is pure computation over what was already fetched.
  const results = useMemo(
    () => (plan ? rank(plan.inputs, weights, agendaKeys) : []),
    [plan, weights, agendaKeys],
  )

  const addOrigin = useCallback((lng: number, lat: number, label?: string) => {
    setOrigins((prev) => {
      // Refusing quietly would make the control look broken; say why instead.
      if (prev.length >= MAX_ORIGINS) { setLimitHit(true); return prev }
      const fallback = NAMES.find((n) => !prev.some((o) => o.label === n)) ?? `Person ${prev.length + 1}`
      return [
        ...prev,
        { id: crypto.randomUUID(), label: label ?? fallback, lng, lat, mode: 'driving', maxMinutes: 45 },
      ]
    })
  }, [])

  /** A searched place keeps its own name, which reads better than "Alex" for a station. */
  const addFromAddress = useCallback((r: GeocodeResult) => {
    addOrigin(r.lng, r.lat, r.name)
  }, [addOrigin])

  /**
   * Bias the search toward the middle of what is already placed, so a generic query
   * resolves near the plan rather than somewhere unrelated.
   */
  const proximity = useMemo(() => {
    if (origins.length === 0) return undefined
    return {
      lng: origins.reduce((a, o) => a + o.lng, 0) / origins.length,
      lat: origins.reduce((a, o) => a + o.lat, 0) / origins.length,
    }
  }, [origins])

  const patchOrigin = useCallback((id: string, patch: Partial<Origin>) => {
    setOrigins((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }, [])

  const moveOrigin = useCallback((id: string, lng: number, lat: number) => {
    setOrigins((prev) => prev.map((o) => (o.id === id ? { ...o, lng, lat } : o)))
  }, [])

  const removeOrigin = useCallback((id: string) => {
    setOrigins((prev) => prev.filter((o) => o.id !== id))
    setLimitHit(false)
  }, [])

  const loadExample = useCallback(() => {
    setOrigins(EXAMPLE.map((o) => ({ ...o, id: crypto.randomUUID() })))
    setAgendaKeys(['dining', 'bars'])
    setAddMode(false)
    setLimitHit(false)
  }, [])

  const toggleAgenda = useCallback((key: string) => {
    setAgendaKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }, [])

  const unroutableNames = plan?.unroutableOrigins
    .map((i) => origins[i]?.label)
    .filter(Boolean)
    .join(', ')
  const partial = !!plan?.overlap && plan.excludedOrigins.length > 0
  const excludedNames = plan?.excludedOrigins.map((i) => origins[i]?.label).filter(Boolean).join(', ')
  const includedNames = plan?.includedOrigins.map((i) => origins[i]?.label).filter(Boolean).join(' and ')

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        origins={origins}
        zones={plan?.zones ?? []}
        overlap={plan?.overlap ?? null}
        results={results}
        selectedId={selectedId}
        addMode={addMode}
        onMapClick={addOrigin}
        onOriginMove={moveOrigin}
        onSelect={setSelectedId}
      />

      <div className="absolute top-0 left-0 bottom-0 w-[330px] p-3 overflow-y-auto space-y-2.5">
        <div className="rounded-lg border border-[#1e2936] bg-[#111820] px-3 py-2.5">
          <h1 className="text-sm font-semibold tracking-tight">Meet in the Middle</h1>
          <p className="text-[11px] text-[#7d8b9a] mt-0.5 leading-snug">
            Where you can all get to — ranked by speed, fairness and what’s nearby.
          </p>
        </div>

        <OriginPanel
          origins={origins}
          addMode={addMode}
          onAddMode={setAddMode}
          onChange={patchOrigin}
          onRemove={removeOrigin}
          onPickAddress={addFromAddress}
          proximity={proximity}
        />

        {origins.length === 0 && (
          <button
            onClick={loadExample}
            className="w-full text-xs py-2 rounded-lg border border-[#2a3746] text-[#9fb0c0] hover:border-[#3d5064] hover:text-[#cfe0ee] transition"
          >
            Load an example — three friends around the Bay
          </button>
        )}

        {limitHit && (
          <div className="rounded-lg border border-[#5c4620] bg-[#7a5c2e]/15 px-3 py-2 text-[11px] text-[#e0b968] leading-snug">
            {MAX_ORIGINS} starting points is the maximum — remove one to add another.
          </div>
        )}

        <AgendaChips selected={agendaKeys} empty={plan?.emptyCategories ?? []} onToggle={toggleAgenda} />
        <WeightSliders weights={weights} agendaOn={agendaKeys.length > 0} onChange={setWeights} />
      </div>

      <div className="absolute top-0 right-0 bottom-0 w-[370px] p-3 overflow-y-auto space-y-2.5">
        <div className="rounded-lg border border-[#1e2936] bg-[#111820] p-3 space-y-2">
          <KindTabs kind={kind} onChange={setKind} />

          {kind === 'event' && <EventDate date={eventDate} onChange={setEventDate} />}

          <div className="text-[11px] text-[#7d8b9a] min-h-[16px]">
            {loading && 'Working out where you can all get to…'}
            {!loading && origins.length < 2 && 'Add at least two starting points.'}
            {!loading && origins.length >= 2 && results.length > 0 &&
              `${results.length} ${
                kind === 'hotel' ? 'hotels' : kind === 'event' ? 'events' : 'venues'
              } everyone can reach.`}
          </div>

          {error && (
            <div className="text-[11px] text-[#ff9d9d] bg-[#ff8080]/10 border border-[#5c2a2a] rounded p-2 leading-snug">
              {error}
            </div>
          )}

          {unroutableNames && (
            <div className="text-[11px] text-[#ff9d9d] bg-[#ff8080]/10 border border-[#5c2a2a] rounded p-2 leading-snug">
              <strong className="font-medium">{unroutableNames}</strong>{' '}
              {plan!.unroutableOrigins.length > 1 ? 'are' : 'is'} not reachable by road — dropped in
              water or off the network. Drag onto a street to include{' '}
              {plan!.unroutableOrigins.length > 1 ? 'them' : 'it'}.
            </div>
          )}

          {partial && (
            <div className="text-[11px] text-[#e0b968] bg-[#7a5c2e]/15 border border-[#5c4620] rounded p-2 leading-snug">
              No single spot works for everyone. Showing the best for {includedNames} —{' '}
              <strong className="font-medium">{excludedNames}</strong>{' '}
              {plan!.excludedOrigins.length > 1 ? 'are' : 'is'} outside the shared area.
            </div>
          )}

          {!loading && !error && plan?.note && (
            <div className="text-[11px] text-[#9fb0c0] bg-[#1a232e] border border-[#25313f] rounded p-2 leading-snug">
              {plan.note}
            </div>
          )}
        </div>

        <ResultList
          results={results}
          origins={origins}
          includedOrigins={plan?.includedOrigins ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
          kind={kind}
        />
      </div>
    </div>
  )
}
