import { formatNumber } from '../../lib/format'
import {
  CATEGORY_NAMES,
  pointsKeyFor,
  sexAllowed,
  slotLabel,
  type Assignment,
  type Issue,
  type SlotSpec,
} from '../../lib/lineupRules'

export type SlotOption = { id: number; label: string }

/** The slot-by-slot form for one team, in the official match-sheet order. */
export function LineupForm({
  slots,
  rawIds,
  assignment,
  issues,
  optionsFor,
  onChange,
}: {
  slots: SlotSpec[]
  rawIds: Record<string, number[]>
  assignment: Assignment
  issues: Issue[]
  optionsFor: (slot: SlotSpec, position: number) => SlotOption[]
  onChange: (slot: SlotSpec, position: number, id: number | null) => void
}) {
  return (
    <>
      {(['MD', 'DS', 'HS', 'DD', 'HD'] as const).map((category) => (
        <div className="lineup-category" key={category}>
          <h3>{CATEGORY_NAMES[category]}</h3>
          {slots
            .filter((s) => s.category === category)
            .map((slot) => {
              const flagged = issues.some((i) => i.severity === 'error' && i.slots?.includes(slot.key))
              const key = pointsKeyFor(slot.category)
              const players = assignment[slot.key] ?? []
              const sum = players.reduce((acc, p) => acc + (p?.points?.[key] ?? 0), 0)
              const complete = players.length === slot.size && players.every(Boolean)
              return (
                <div className={`lineup-slot ${flagged ? 'flagged' : ''}`.trim()} key={slot.key}>
                  <span className="lineup-slot-label">{slotLabel(slot)}</span>
                  <div className="lineup-slot-fields">
                    {Array.from({ length: slot.size }, (_, i) => {
                      const current = rawIds[slot.key]?.[i] ?? 0
                      const need = sexAllowed(slot.category, i)
                      return (
                        <select
                          key={i}
                          className="select"
                          value={current || ''}
                          aria-label={`${slotLabel(slot)} ${slot.size === 2 ? (i === 0 ? 'første spiller' : 'anden spiller') : ''}`}
                          onChange={(e) => onChange(slot, i, e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">{need === 'M' ? 'Vælg herre' : 'Vælg dame'}</option>
                          {optionsFor(slot, i).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )
                    })}
                  </div>
                  <span className="lineup-slot-points num">{complete && sum > 0 ? formatNumber(sum) : ''}</span>
                </div>
              )
            })}
        </div>
      ))}
    </>
  )
}
