import { formatNumber, seasonLabel } from '../../lib/format'
import type { Sex } from '../../lib/lineupRules'
import type { LineupPoints, LineupSetupPlayer } from '../../types'

export function SexBadge({ sex }: { sex: Sex | null }) {
  if (!sex) return <span className="chip">?</span>
  return <span className={`chip sex-${sex}`}>{sex === 'M' ? 'H' : 'D'}</span>
}

export type PlayerGroup = { label: string; players: LineupSetupPlayer[]; collapsed?: boolean }

function pts(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : formatNumber(value)
}

/** Who is available this round: one tile per player, tick to allow them in the lineup. */
export function Availability({
  groups,
  seasonId,
  available,
  onToggle,
  onSetMany,
  sexOverride,
  onSex,
  points,
  pointsLoading,
  usedBy,
  showTeam,
}: {
  groups: PlayerGroup[]
  seasonId: number
  available: Set<number>
  onToggle: (id: number, on: boolean) => void
  onSetMany: (ids: number[], on: boolean) => void
  sexOverride: Record<number, Sex>
  onSex: (id: number, sex: Sex) => void
  points: LineupPoints | undefined
  pointsLoading: boolean
  /** Team name(s) a player is currently placed on. */
  usedBy?: Map<number, string[]>
  /** Show each player's team on the tile (club view, or players from other teams). */
  showTeam: (p: LineupSetupPlayer) => boolean
}) {
  const all = groups.flatMap((g) => g.players).map((p) => p.id).filter((id): id is number => typeof id === 'number')
  const primary = groups.filter((g) => !g.collapsed).flatMap((g) => g.players).map((p) => p.id).filter((id): id is number => typeof id === 'number')
  const selected = all.filter((id) => available.has(id)).length

  const tile = (p: LineupSetupPlayer) => {
    const id = p.id ?? 0
    const on = available.has(id)
    const info = points?.points[String(id)]
    const sex = sexOverride[id] ?? p.sex
    const notes = [showTeam(p) ? p.team.name : '', p.lastSeason !== seasonId ? `sidst ${seasonLabel(p.lastSeason)}` : '', usedBy?.get(id)?.length ? `sat på ${usedBy.get(id)!.join(', ')}` : '']
      .filter(Boolean)
      .join(' · ')
    return (
      <label key={id} className={`player-tile ${on ? 'on' : ''}`.trim()}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(id, e.target.checked)} aria-label={`${p.name} til rådighed`} />
        <span className="player-tile-body">
          <span className="player-tile-name">{p.name}</span>
          <span className="player-tile-meta">
            {sex ? (
              <SexBadge sex={sex} />
            ) : (
              <span className="tabs" style={{ padding: 2 }} title="Køn kunne ikke aflæses. Vælg herre eller dame.">
                <button type="button" onClick={() => onSex(id, 'M')}>
                  H
                </button>
                <button type="button" onClick={() => onSex(id, 'F')}>
                  D
                </button>
              </span>
            )}
            {info?.youth && (
              <span className="chip chip-accent" title="U17/U19: placeres efter vurderet seniorstyrke (§ 38 stk. 5)">
                {info.ageGroup}
              </span>
            )}
            {notes && <span>{notes}</span>}
          </span>
          <span className="player-tile-points num" title="Ranglistepoint: single · double · mix">
            {pointsLoading ? 'henter point…' : `S ${pts(info?.single)} · D ${pts(info?.double)} · M ${pts(info?.mix)}`}
          </span>
        </span>
      </label>
    )
  }

  return (
    <div className="stack" style={{ gap: '0.9rem' }}>
      <div className="player-toolbar">
        <strong>
          {selected} af {all.length} spillere markeret
        </strong>
        <div className="page-tools">
          <button type="button" className="btn btn-sm" onClick={() => onSetMany(primary, true)}>
            Marker alle fra {seasonLabel(seasonId)}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onSetMany(all, false)} disabled={selected === 0}>
            Fjern alle markeringer
          </button>
        </div>
      </div>
      {groups.map((g) =>
        g.players.length === 0 ? null : g.collapsed ? (
          <details key={g.label} className="player-group">
            <summary>
              {g.label} <span className="dim">({g.players.length})</span>
            </summary>
            <div className="player-tiles" style={{ marginTop: '0.6rem' }}>
              {g.players.map(tile)}
            </div>
          </details>
        ) : (
          <div key={g.label}>
            {groups.length > 1 && (
              <div className="eyebrow" style={{ marginBottom: '0.45rem' }}>
                {g.label} <span className="dim">({g.players.length})</span>
              </div>
            )}
            <div className="player-tiles">{g.players.map(tile)}</div>
          </div>
        ),
      )}
    </div>
  )
}
