import type { Candidate, Origin, ScoredCandidate } from '../core/types'
import { CATEGORY_BY_KEY } from '../providers/categories'
import { AXIS_COLOURS, AXIS_LABELS, ORIGIN_COLOURS } from './theme'

const mins = (n: number | null) => (n === null ? '–' : String(Math.round(n)))

/** "7:30 pm · Oakland Arena" */
function eventLine(e: NonNullable<Candidate['event']>): string {
  const bits: string[] = []
  if (e.localTime) {
    const [h, m] = e.localTime.split(':').map(Number)
    bits.push(new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
  } else {
    bits.push('time to be announced')
  }
  if (e.venueName) bits.push(e.venueName)
  return bits.join(' · ')
}

/**
 * Price is published for a minority of events, so its absence is stated rather than
 * hidden behind a blank or a zero that would read as free.
 */
function eventPrice(e: NonNullable<Candidate['event']>): string {
  if (e.priceMin === null) return 'price not listed'
  const sym = e.currency === 'USD' ? '$' : `${e.currency ?? ''} `
  if (e.priceMax === null || e.priceMax === e.priceMin) return `${sym}${e.priceMin}`
  return `${sym}${e.priceMin}–${sym}${e.priceMax}`
}

/** Stacked bar showing how much each axis contributed to the total. */
function ContributionBar({ r }: { r: ScoredCandidate }) {
  const parts = (['speed', 'fairness', 'agenda'] as const)
    .map((k) => ({ k, v: r.contributions[k] }))
    .filter((p) => p.v > 0.001)
  const sum = parts.reduce((a, p) => a + p.v, 0)

  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-[#1a232e]">
      {parts.map((p) => (
        <div
          key={p.k}
          style={{ width: `${(p.v / Math.max(sum, 1e-6)) * 100}%`, background: AXIS_COLOURS[p.k] }}
          title={`${AXIS_LABELS[p.k]} ${p.v.toFixed(3)}`}
        />
      ))}
    </div>
  )
}

/**
 * A plain-language reason this result placed where it did, built from what actually
 * distinguishes it rather than a fixed template.
 */
function explain(r: ScoredCandidate, partial: boolean): string {
  const bits: string[] = []
  const { spreadMinutes, meanMinutes, minutes } = r.travel

  if (spreadMinutes !== null && meanMinutes !== null) {
    const times = minutes.filter((m): m is number => m !== null)
    const lo = Math.round(Math.min(...times))
    const hi = Math.round(Math.max(...times))
    bits.push(
      spreadMinutes <= 8
        ? `everyone arrives within ${Math.round(spreadMinutes)} min of each other (${lo}–${hi} min)`
        : `trips run ${lo}–${hi} min, a ${Math.round(spreadMinutes)} min gap`,
    )
    bits.push(`${Math.round(meanMinutes)} min average`)
  }

  if (r.agenda.matched.length) {
    const top = r.agenda.matched
      .map((k) => ({ k, n: r.agenda.counts[k] ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map(({ k, n }) => `${n} ${CATEGORY_BY_KEY.get(k)?.label.toLowerCase() ?? k}`)
    bits.push(`${top.join(' and ')} within a walk`)
  }

  return (bits.join(' · ') || 'No travel data for this one.') + (partial ? ' (partial group)' : '')
}

export function ResultList({
  results, origins, includedOrigins, selectedId, onSelect, kind,
}: {
  results: ScoredCandidate[]
  origins: Origin[]
  includedOrigins: number[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  kind: string
}) {
  if (results.length === 0) return null
  const partial = includedOrigins.length < origins.length

  return (
    <div className="space-y-1.5">
      {results.map((r, i) => {
        const open = r.candidate.id === selectedId
        return (
          <div
            key={r.candidate.id}
            onClick={() => onSelect(open ? null : r.candidate.id)}
            className={`rounded-lg border p-2.5 cursor-pointer transition ${
              open ? 'border-[#4aa8ff] bg-[#16222f]' : 'border-[#1e2936] bg-[#111820] hover:border-[#2f3f50]'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className={`text-[11px] tabular-nums w-5 shrink-0 pt-0.5 ${
                i === 0 ? 'text-[#ffd166] font-semibold' : 'text-[#5f6f7e]'
              }`}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm truncate">{r.candidate.name}</span>
                  {i === 0 && (
                    <span className="text-[9px] uppercase tracking-wide text-[#ffd166] shrink-0">
                      best match
                    </span>
                  )}
                </div>
                {r.candidate.event && (
                  <div className="mt-0.5 text-[11px] text-[#9fb0c0]">{eventLine(r.candidate.event)}</div>
                )}
                <div className="mt-1.5"><ContributionBar r={r} /></div>
                <div className="mt-1.5 text-[11px] text-[#8b9aa9] leading-snug">
                  {explain(r, partial)}
                </div>
              </div>
            </div>

            {open && (
              <div className="mt-2.5 pt-2.5 border-t border-[#1e2936] space-y-2">
                <div className="space-y-1">
                  {includedOrigins.map((oi, k) => {
                    const t = r.travel.minutes[k]
                    const reachable = r.travel.reachableBy.includes(k)
                    return (
                      <div key={origins[oi].id} className="flex items-center gap-2 text-[11px]">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: ORIGIN_COLOURS[oi % ORIGIN_COLOURS.length] }}
                        />
                        <span className="flex-1 truncate text-[#9fb0c0]">{origins[oi].label}</span>
                        <span className={`tabular-nums ${reachable ? 'text-[#9fb0c0]' : 'text-[#ff8080]'}`}>
                          {mins(t)} min
                          {t !== null && !reachable && ' · over budget'}
                          {t === null && ' · no route'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {Object.keys(r.agenda.counts).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(r.agenda.counts).map(([key, n]) => (
                      <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded ${
                        n > 0 ? 'bg-[#f59e0b]/15 text-[#fbbf24]' : 'bg-[#1a232e] text-[#5f6f7e]'
                      }`}>
                        {n > 0 ? '✓' : '✗'} {CATEGORY_BY_KEY.get(key)?.label ?? key}{n > 0 ? ` (${n})` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {r.candidate.event && (
                  <div className="flex flex-wrap gap-1">
                    {r.candidate.event.genre && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#4aa8ff]/15 text-[#9ccfff]">
                        {r.candidate.event.genre}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a232e] text-[#9fb0c0]">
                      {eventPrice(r.candidate.event)}
                    </span>
                  </div>
                )}

                {r.candidate.address && (
                  <div className="text-[10px] text-[#5f6f7e]">{r.candidate.address}</div>
                )}
                {r.candidate.website && (
                  <a
                    href={r.candidate.website} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-[#4aa8ff] hover:underline inline-block"
                  >
                    Website ↗
                  </a>
                )}
                <div className="text-[10px] text-[#5f6f7e] pt-0.5">
                  {kind === 'hotel' ? 'Hotel' : kind === 'event' ? r.candidate.event?.segment ?? 'Event' : 'Venue'}
                  {' · score '}{r.total.toFixed(3)}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
