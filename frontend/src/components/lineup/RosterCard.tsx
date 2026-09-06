import type { ReactNode } from 'react'

import { formatNumber, seasonLabel } from '../../lib/format'
import type { Sex } from '../../lib/lineupRules'
import type { LineupPoints, LineupSetupPlayer } from '../../types'
import { Card, PlayerLink } from '../ui'

export function SexBadge({ sex }: { sex: Sex | null }) {
  if (!sex) return <span className="chip">?</span>
  return <span className={`chip sex-${sex}`}>{sex === 'M' ? 'H' : 'D'}</span>
}

function pointsCell(value: number | null | undefined, loading: boolean): ReactNode {
  if (loading) return <span className="dim">…</span>
  if (value === null || value === undefined) return <span className="dim">–</span>
  return formatNumber(value)
}

/** The club's players with availability ticks, sex, and ranking points. */
export function RosterCard({
  title,
  subtitle,
  players,
  homeSlug,
  seasonId,
  available,
  onToggle,
  sexOverride,
  onSex,
  points,
  pointsLoading,
  usedBy,
}: {
  title: string
  subtitle: string
  players: LineupSetupPlayer[]
  /** When set, players from other teams show their team name. */
  homeSlug?: string
  seasonId: number
  available: Set<number>
  onToggle: (id: number, on: boolean) => void
  sexOverride: Record<number, Sex>
  onSex: (id: number, sex: Sex) => void
  points: LineupPoints | undefined
  pointsLoading: boolean
  /** Team name a player is currently placed on, for the club view. */
  usedBy?: Map<number, string[]>
}) {
  return (
    <Card title={title} subtitle={subtitle}>
      <div className="table-wrap">
        <table className="table table-compact lineup-roster">
          <thead>
            <tr>
              <th></th>
              <th>Spiller</th>
              <th></th>
              <th className="r" title="Ranglistepoint single">S</th>
              <th className="r" title="Ranglistepoint double">D</th>
              <th className="r" title="Ranglistepoint mix">M</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const id = p.id ?? 0
              const pts = points?.points[String(id)]
              const sex = sexOverride[id] ?? p.sex
              const foreign = homeSlug ? p.team.slug !== homeSlug : true
              const stale = p.lastSeason !== seasonId
              const used = usedBy?.get(id)
              return (
                <tr key={id} className={available.has(id) ? '' : 'dim'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={available.has(id)}
                      aria-label={`${p.name} til rådighed`}
                      onChange={(e) => onToggle(id, e.target.checked)}
                    />
                  </td>
                  <td className="primary">
                    <PlayerLink player={p} />
                    {(foreign || stale || used) && (
                      <div className="dim" style={{ fontWeight: 400, fontSize: '0.74rem' }}>
                        {[foreign ? p.team.name : '', stale ? `sidst ${seasonLabel(p.lastSeason)}` : '', used ? `sat på ${used.join(', ')}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>
                    {pts?.youth && (
                      <span className="chip chip-accent" title="U17/U19: placeres efter vurderet seniorstyrke (§ 38 stk. 5)" style={{ marginRight: 4 }}>
                        {pts.ageGroup}
                      </span>
                    )}
                    {sex ? (
                      <SexBadge sex={sex} />
                    ) : (
                      <span className="tabs" style={{ padding: 2 }}>
                        <button type="button" onClick={() => onSex(id, 'M')}>
                          H
                        </button>
                        <button type="button" onClick={() => onSex(id, 'F')}>
                          D
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="r">{pointsCell(pts?.single, pointsLoading)}</td>
                  <td className="r">{pointsCell(pts?.double, pointsLoading)}</td>
                  <td className="r">{pointsCell(pts?.mix, pointsLoading)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
