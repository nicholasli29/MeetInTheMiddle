import { MAX_CONTOUR_MINUTES, type Kind, type Mode, type Origin, type Weights } from '../core/types'
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

export function OriginPanel({
  origins, addMode, onAddMode, onChange, onRemove,
}: {
  origins: Origin[]
  addMode: boolean
  onAddMode: (v: boolean) => void
  onChange: (id: string, patch: Partial<Origin>) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <span className={heading}>Starting points</span>
        <button onClick={() => onAddMode(!addMode)} className={`${chip} ${addMode ? chipOn : chipOff}`}>
          {addMode ? 'Click the map…' : '+ Add'}
        </button>
      </div>

      {origins.length === 0 && (
        <p className="text-xs text-[#7d8b9a] leading-relaxed">
          Add two or more starting points to find where you can all meet. A starting point is
          just a place and a travel budget — a home, an office, a station.
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
