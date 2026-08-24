import { useEffect, useRef, useState } from 'react'
import { MAX_CONTOUR_MINUTES, type Kind, type Mode, type Origin, type Weights } from '../core/types'
import { geocode, type GeocodeResult } from '../providers/geocode'
import { AGENDA_CATEGORIES } from '../providers/categories'
import { AXIS_COLOURS, AXIS_LABELS, ORIGIN_COLOURS } from './theme'

const MODES: { value: Mode; label: string }[] = [
  { value: 'driving', label: 'Drive' },
  { value: 'cycling', label: 'Cycle' },
  { value: 'walking', label: 'Walk' },
]

const card = 'rounded-lg border border-[#1e2936] bg-[#111820] p-3'
const heading = 'text-[11px] uppercase tracking-wider text-[#7d8b9a] font-medium'
const chip = 'text-[11px] px-2 py-1 rounded border transition'
const chipOn = 'border-[#4aa8ff] bg-[#4aa8ff]/15 text-[#9ccfff]'
const chipOff = 'border-[#2a3746] text-[#7d8b9a] hover:border-[#3d5064]'

/**
 * Type-to-search for a starting point.
 *
 * Clicking the map is precise but assumes you know where somewhere is; most people know
 * a name instead. Results are biased toward the points already placed, so a generic
 * query resolves near where the plan is happening.
 */
export function AddressSearch({
  proximity, onPick,
}: {
  proximity?: { lng: number; lat: number }
  onPick: (r: GeocodeResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Depend on the coordinates, not the object: a parent rebuilding it each render would
  // otherwise re-trigger the search continuously.
  const pLng = proximity?.lng
  const pLat = proximity?.lat
  const q = query.trim()
  const tooShort = q.length < 2

  useEffect(() => {
    if (tooShort) return
    // Debounced so a typed word costs one request rather than one per keystroke.
    const t = setTimeout(() => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      setBusy(true)
      const near = pLng !== undefined && pLat !== undefined ? { lng: pLng, lat: pLat } : undefined
      geocode(q, { proximity: near, signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) { setResults(r); setActive(0); setOpen(true) } })
        .catch(() => { /* aborted or offline: leave the previous list alone */ })
        .finally(() => { if (!ac.signal.aborted) setBusy(false) })
    }, 300)
    return () => clearTimeout(t)
  }, [q, tooShort, pLng, pLat])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const choose = (r: GeocodeResult) => {
    onPick(r)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const showList = open && !tooShort && results.length > 0
  const showEmpty = open && !tooShort && !busy && results.length === 0

  return (
    <div className="relative mb-2" ref={box}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && showList && results[active]) { e.preventDefault(); choose(results[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Search an address or place…"
        className="w-full bg-[#0d141b] border border-[#2a3746] rounded px-2 py-1.5 text-xs text-[#cfe0ee] placeholder:text-[#5f6f7e] outline-none focus:border-[#3d5064]"
      />
      {busy && <span className="absolute right-2 top-1.5 text-[10px] text-[#5f6f7e]">…</span>}

      {showList && (
        <ul className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-[#2a3746] bg-[#111820] shadow-lg overflow-hidden">
          {results.map((r, i) => (
            <li key={r.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`w-full text-left px-2 py-1.5 transition ${i === active ? 'bg-[#4aa8ff]/15' : 'hover:bg-[#1a232e]'}`}
              >
                <div className="text-xs text-[#cfe0ee] truncate">{r.name}</div>
                {r.context && <div className="text-[10px] text-[#7d8b9a] truncate">{r.context}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showEmpty && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-[#2a3746] bg-[#111820] px-2 py-1.5 text-[10px] text-[#7d8b9a]">
          Nothing found for “{q}”.
        </div>
      )}
    </div>
  )
}

export function OriginPanel({
  origins, addMode, onAddMode, onChange, onRemove, onPickAddress, proximity,
}: {
  origins: Origin[]
  addMode: boolean
  onAddMode: (v: boolean) => void
  onChange: (id: string, patch: Partial<Origin>) => void
  onRemove: (id: string) => void
  onPickAddress: (r: GeocodeResult) => void
  proximity?: { lng: number; lat: number }
}) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <span className={heading}>Starting points</span>
        <button onClick={() => onAddMode(!addMode)} className={`${chip} ${addMode ? chipOn : chipOff}`}>
          {addMode ? 'Click the map…' : '+ Add'}
        </button>
      </div>

      <AddressSearch proximity={proximity} onPick={onPickAddress} />

      {origins.length === 0 && (
        <p className="text-xs text-[#7d8b9a] leading-relaxed">
          Search above, or press <span className="text-[#9fb0c0]">+ Add</span> and click the map.
          A starting point is just a place and a travel budget — a home, an office, a station.
        </p>
      )}

      <div className="space-y-2">
        {origins.map((o, i) => (
          <div key={o.id} className="rounded-md border border-[#1e2936] bg-[#0d141b] p-2">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0 border-2 border-[#0b0f14]"
                style={{ background: ORIGIN_COLOURS[i % ORIGIN_COLOURS.length] }}
              />
              <input
                value={o.label}
                onChange={(e) => onChange(o.id, { label: e.target.value })}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-transparent focus:border-[#2a3746]"
              />
              <button
                onClick={() => onRemove(o.id)}
                aria-label={`Remove ${o.label}`}
                className="text-[#5f6f7e] hover:text-[#ff8080] text-sm px-1"
              >
                ×
              </button>
            </div>

            <div className="flex gap-1 mt-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange(o.id, { mode: m.value })}
                  className={`flex-1 text-[11px] py-1 rounded border transition ${
                    o.mode === m.value ? chipOn : chipOff
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="range" min={5} max={MAX_CONTOUR_MINUTES} step={5}
                value={o.maxMinutes}
                onChange={(e) => onChange(o.id, { maxMinutes: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="text-xs tabular-nums text-[#9fb0c0] w-12 text-right">{o.maxMinutes} min</span>
            </div>
          </div>
        ))}
      </div>

      {origins.length > 0 && (
        <p className="text-[10px] text-[#5f6f7e] mt-2 leading-relaxed">
          Travel budgets stop at {MAX_CONTOUR_MINUTES} minutes — the reachable-area API does not
          compute longer ones.
        </p>
      )}
    </div>
  )
}

export function KindTabs({ kind, onChange }: { kind: Kind; onChange: (k: Kind) => void }) {
  const tabs: { value: Kind; label: string }[] = [
    { value: 'venue', label: 'Venues' },
    { value: 'hotel', label: 'Hotels' },
  ]
  return (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 text-xs py-1.5 rounded border transition ${
            kind === t.value ? chipOn : chipOff
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function AgendaChips({
  selected, empty, onToggle,
}: {
  selected: string[]
  empty: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between mb-2">
        <span className={heading}>Agenda</span>
        <span className="text-[10px] text-[#5f6f7e]">
          {selected.length ? `${selected.length} selected` : 'optional'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {AGENDA_CATEGORIES.map((c) => {
          const on = selected.includes(c.key)
          const blank = on && empty.includes(c.key)
          return (
            <button
              key={c.key}
              onClick={() => onToggle(c.key)}
              title={blank ? `No ${c.label.toLowerCase()} anywhere in the shared area` : undefined}
              className={`text-[11px] px-2 py-1 rounded-full border transition ${
                on
                  ? blank
                    ? 'border-[#7a5c2e] bg-[#7a5c2e]/20 text-[#e0b968]'
                    : 'border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]'
                  : chipOff
              }`}
            >
              {c.emoji} {c.label}{blank ? ' · none' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function WeightSliders({
  weights, agendaOn, onChange,
}: {
  weights: Weights
  agendaOn: boolean
  onChange: (w: Weights) => void
}) {
  const keys: (keyof Weights)[] = ['speed', 'fairness', 'agenda']
  const total = weights.speed + weights.fairness + (agendaOn ? weights.agenda : 0)

  return (
    <div className={card}>
      <span className={heading}>What matters</span>
      <div className="space-y-2.5 mt-2">
        {keys.map((k) => {
          const off = k === 'agenda' && !agendaOn
          const share = total > 0 && !off ? (weights[k] / total) * 100 : 0
          return (
            <div key={k} className={off ? 'opacity-40' : ''}>
              <div className="flex justify-between text-[11px] mb-1">
                <span style={{ color: AXIS_COLOURS[k] }}>{AXIS_LABELS[k]}</span>
                <span className="tabular-nums text-[#7d8b9a]">
                  {off ? 'pick an agenda' : `${Math.round(share)}%`}
                </span>
              </div>
              <input
                type="range" min={0} max={100}
                value={weights[k] * 100}
                disabled={off}
                onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) / 100 })}
                className="w-full"
                style={{ accentColor: AXIS_COLOURS[k] }}
              />
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-[#5f6f7e] mt-2 leading-relaxed">
        Speed favours the shortest average trip. Fairness favours the smallest gap between the
        longest and shortest.
      </p>
    </div>
  )
}
