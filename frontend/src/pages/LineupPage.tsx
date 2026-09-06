import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useLineupPoints, useLineupSetup } from '../api'
import { SearchBox } from '../components/SearchBox'
import { Card, EmptyState, ErrorState, PageSkeleton, PlayerLink, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatNumber, seasonLabel } from '../lib/format'
import {
  CATEGORY_NAMES,
  checkLineup,
  pointsKeyFor,
  sexAllowed,
  slotLabel,
  slotsFor,
  verdict,
  type Assignment,
  type Format,
  type HigherTeamPlayer,
  type Issue,
  type LineupPlayer,
  type PointsKey,
  type Sex,
  type SlotSpec,
} from '../lib/lineupRules'
import type { LineupSetupPlayer } from '../types'

const SLOT_CATEGORIES: Record<string, PointsKey[]> = { MD: ['mix'], DS: ['single'], HS: ['single'], DD: ['double'], HD: ['double'] }

function categoriesFromSlots(slots: string[]): PointsKey[] {
  const out = new Set<PointsKey>()
  for (const s of slots) {
    const code = s.replace(/^\d+\.\s*/, '')
    for (const key of SLOT_CATEGORIES[code] ?? []) out.add(key)
  }
  return [...out]
}

function parseAssignment(params: URLSearchParams, slots: SlotSpec[]): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const slot of slots) {
    const raw = params.get(slot.key.toLowerCase())
    out[slot.key] = raw ? raw.split(',').map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : []
  }
  return out
}

function SexBadge({ sex }: { sex: Sex | null }) {
  if (!sex) return <span className="chip">?</span>
  return <span className={`chip sex-${sex}`}>{sex === 'M' ? 'H' : 'D'}</span>
}

function pointsCell(value: number | null | undefined, loading: boolean): ReactNode {
  if (loading) return <span className="dim">…</span>
  if (value === null || value === undefined) return <span className="dim">–</span>
  return formatNumber(value)
}

export function LineupPage() {
  const [params, setParams] = useSearchParams()
  const teamSlug = params.get('hold')
  const { data: setup, error, isLoading } = useLineupSetup(teamSlug)
  usePageTitle(setup ? `Holdopstilling · ${setup.team.name}` : teamSlug ? null : 'Holdopstilling')

  const formatOverride = params.get('format') === '9' ? 9 : params.get('format') === '13' ? 13 : null
  const compareHigher = params.get('sammenlign') !== '0'

  const format: Format | null = useMemo(() => {
    if (!setup) return null
    if (formatOverride && formatOverride !== setup.format.matches) {
      return formatOverride === 9
        ? { matches: 9, minMen: 4, minWomen: 3, maxPerPlayer: null, division: '1. division' }
        : { matches: 13, minMen: 6, minWomen: 4, maxPerPlayer: 2, division: '2. division' }
    }
    return setup.format
  }, [setup, formatOverride])

  const slots = useMemo(() => slotsFor(format?.matches ?? 13), [format])

  // Availability and sex overrides live in component state; the lineup itself lives in
  // the URL so a coach can share the exact setup with the club.
  const [available, setAvailable] = useState<Set<number>>(new Set())
  const [sexOverride, setSexOverride] = useState<Record<number, Sex>>({})
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!setup || initialisedFor === setup.team.slug) return
    const own = setup.players
      .filter((p) => p.team.slug === setup.team.slug)
      .map((p) => p.id)
      .filter((id): id is number => typeof id === 'number')
    const assigned = Object.values(parseAssignment(params, slotsFor(13))).flat()
    setAvailable(new Set<number>([...own, ...assigned]))
    setSexOverride({})
    setInitialisedFor(setup.team.slug)
  }, [setup, initialisedFor, params])

  const allIds = useMemo(() => {
    if (!setup) return []
    const ids = setup.players.map((p) => p.id).filter((id): id is number => typeof id === 'number')
    for (const p of setup.higherTeam?.lineup?.players ?? []) if (typeof p.id === 'number') ids.push(p.id)
    return ids
  }, [setup])
  const points = useLineupPoints(allIds)

  const toLineupPlayer = (p: { id?: number | null; name: string; sex: Sex | null }): LineupPlayer => {
    const id = p.id ?? 0
    const pts = points.data?.points[String(id)]
    return {
      id,
      name: p.name,
      sex: sexOverride[id] ?? p.sex,
      points: pts ? { single: pts.single, double: pts.double, mix: pts.mix } : null,
    }
  }

  const rosterById = useMemo(() => {
    const map = new Map<number, LineupSetupPlayer>()
    for (const p of setup?.players ?? []) if (p.id) map.set(p.id, p)
    return map
  }, [setup])

  const rawAssignment = useMemo(() => parseAssignment(params, slots), [params, slots])
  const assignment: Assignment = useMemo(() => {
    const out: Assignment = {}
    for (const slot of slots) {
      const ids = rawAssignment[slot.key] ?? []
      out[slot.key] = Array.from({ length: slot.size }, (_, i) => {
        const p = ids[i] ? rosterById.get(ids[i]) : undefined
        return p ? toLineupPlayer(p) : null
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAssignment, slots, rosterById, points.data, sexOverride])

  const higher = useMemo(() => {
    if (!setup?.higherTeam?.lineup || !compareHigher) return null
    const players: HigherTeamPlayer[] = setup.higherTeam.lineup.players.map((p) => ({
      player: toLineupPlayer(p),
      categories: categoriesFromSlots(p.slots),
      slots: p.slots,
    }))
    return { teamName: setup.higherTeam.team.name, players }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, compareHigher, points.data, sexOverride])

  const issues: Issue[] = useMemo(
    () => (format ? checkLineup(format, slots, assignment, higher) : []),
    [format, slots, assignment, higher],
  )
  const status = verdict(issues)

  const setSlot = (slot: SlotSpec, position: number, id: number | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      const ids = [...(parseAssignment(prev, slots)[slot.key] ?? [])]
      while (ids.length < slot.size) ids.push(0)
      ids[position] = id ?? 0
      const value = ids.map((n) => (n > 0 ? String(n) : '')).join(',')
      if (value.replace(/,/g, '') === '') copy.delete(slot.key.toLowerCase())
      else copy.set(slot.key.toLowerCase(), value)
      return copy
    })
  }

  const clearAll = () => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      for (const slot of slotsFor(13)) copy.delete(slot.key.toLowerCase())
      return copy
    })
  }

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      if (value === null) copy.delete(key)
      else copy.set(key, value)
      return copy
    })
  }

  const chooseTeam = (slug: string) => {
    setParams(() => new URLSearchParams({ hold: slug }))
  }

  const usedCount = useMemo(() => {
    const map = new Map<number, number>()
    for (const slot of slots) for (const p of assignment[slot.key] ?? []) if (p) map.set(p.id, (map.get(p.id) ?? 0) + 1)
    return map
  }, [assignment, slots])

  const optionsFor = (slot: SlotSpec, position: number) => {
    const need = sexAllowed(slot.category, position)
    const key = pointsKeyFor(slot.category)
    return (setup?.players ?? [])
      .filter((p) => p.id && available.has(p.id))
      .filter((p) => (sexOverride[p.id!] ?? p.sex) === need || (sexOverride[p.id!] ?? p.sex) === null)
      .map((p) => {
        const pts = points.data?.points[String(p.id)]?.[key]
        const used = usedCount.get(p.id!) ?? 0
        return { id: p.id!, label: `${p.name}${pts != null ? ` · ${formatNumber(pts)}` : ''}${used ? ` · (${used})` : ''}` }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'da'))
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Holdopstilling <span className="chip chip-accent">Beta</span>
          </div>
          <h1>Er holdet lovligt sat?</h1>
          <p className="page-sub">
            Vælg et hold, marker hvem der kan spille, og sæt holdet. Opstillingen tjekkes mod DH-reglementets § 37 og
            § 38 med ranglistepoint fra badmintonplayer.dk.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 520 }}>
        <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
          Hold
        </div>
        {setup ? (
          <div className="picker-chosen">
            <span className="picker-name">{setup.team.name}</span>
            <button type="button" className="picker-change" onClick={() => setParams(new URLSearchParams())}>
              Skift
            </button>
          </div>
        ) : (
          <SearchBox mode="pick" restrict="team" placeholder="Vælg det hold der skal sættes" onPick={(o) => chooseTeam(o.entity.slug)} />
        )}
      </div>

      {!teamSlug ? (
        <EmptyState>Vælg et hold for at komme i gang. Spillerne hentes fra holdets kampe i indeværende sæson.</EmptyState>
      ) : error ? (
        <ErrorState error={error} />
      ) : isLoading || !setup || !format ? (
        <PageSkeleton />
      ) : (
        <>
          <section className={`lineup-verdict lineup-verdict-${status}`} aria-live="polite">
            <div>
              <strong>
                {status === 'legal' ? 'Lovlig opstilling' : status === 'illegal' ? 'Opstillingen er ikke lovlig' : 'Opstillingen er ikke komplet'}
              </strong>
              <span className="lineup-verdict-sub">
                {format.division} · {format.matches} kampe · mindst {format.minMen} herrer og {format.minWomen} damer
                {points.isLoading && ' · henter point…'}
                {points.isError && ' · point kunne ikke hentes, alle tæller som 0'}
              </span>
            </div>
            <div className="page-tools">
              <div className="tabs" role="group" aria-label="Kampformat">
                {[13, 9].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={format.matches === m ? 'active' : ''}
                    onClick={() => setParam('format', m === setup.format.matches ? null : String(m))}
                  >
                    {m} kampe
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-sm" onClick={clearAll}>
                Ryd opstilling
              </button>
            </div>
          </section>

          <div className="grid grid-main lineup-grid">
            <div className="stack">
              <Card title="Opstilling" subtitle="Rækkefølgen følger det officielle holdskema. Point i parentes er for den pågældende rangliste.">
                {(['MD', 'DS', 'HS', 'DD', 'HD'] as const).map((category) => (
                  <div className="lineup-category" key={category}>
                    <h3>{CATEGORY_NAMES[category]}</h3>
                    {slots
                      .filter((s) => s.category === category)
                      .map((slot) => {
                        const flagged = issues.some((i) => i.severity === 'error' && i.slots?.includes(slot.key))
                        const key = pointsKeyFor(slot.category)
                        const sum = (assignment[slot.key] ?? []).reduce((acc, p) => acc + (p?.points?.[key] ?? 0), 0)
                        const complete = (assignment[slot.key] ?? []).every(Boolean)
                        return (
                          <div className={`lineup-slot ${flagged ? 'flagged' : ''}`.trim()} key={slot.key}>
                            <span className="lineup-slot-label">{slotLabel(slot)}</span>
                            <div className="lineup-slot-fields">
                              {Array.from({ length: slot.size }, (_, i) => {
                                const current = rawAssignment[slot.key]?.[i] ?? 0
                                const need = sexAllowed(slot.category, i)
                                return (
                                  <select
                                    key={i}
                                    className="select"
                                    value={current || ''}
                                    aria-label={`${slotLabel(slot)} ${slot.size === 2 ? (i === 0 ? 'første spiller' : 'anden spiller') : ''}`}
                                    onChange={(e) => setSlot(slot, i, e.target.value ? Number(e.target.value) : null)}
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
              </Card>

              <Card title="Regeltjek" subtitle={`${issues.filter((i) => i.severity === 'error').length} fejl · ${issues.filter((i) => i.severity === 'warning').length} advarsler`}>
                {issues.length === 0 ? (
                  <p className="text-2">Ingen problemer fundet.</p>
                ) : (
                  <ul className="issue-list">
                    {issues.map((issue, i) => (
                      <li key={i} className={`issue issue-${issue.severity}`}>
                        <span className="issue-rule">{issue.rule}</span>
                        <span>{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="stack">
              <Card
                title="Spillere"
                subtitle={`Fra ${setup.team.name}s kampe i ${seasonLabel(setup.seasonId)}${setup.otherTeams.length ? ', plus klubbens andre hold' : ''}. Marker hvem der er til rådighed.`}
              >
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
                      {setup.players.map((p) => {
                        const id = p.id ?? 0
                        const pts = points.data?.points[String(id)]
                        const sex = sexOverride[id] ?? p.sex
                        const foreign = p.team.slug !== setup.team.slug
                        return (
                          <tr key={id} className={available.has(id) ? '' : 'dim'}>
                            <td>
                              <input
                                type="checkbox"
                                checked={available.has(id)}
                                aria-label={`${p.name} til rådighed`}
                                onChange={(e) => {
                                  const next = new Set(available)
                                  if (e.target.checked) next.add(id)
                                  else next.delete(id)
                                  setAvailable(next)
                                }}
                              />
                            </td>
                            <td className="primary">
                              <PlayerLink player={p} />
                              {foreign && (
                                <div className="dim" style={{ fontWeight: 400, fontSize: '0.74rem' }}>
                                  {p.team.name}
                                </div>
                              )}
                            </td>
                            <td>
                              {sex ? (
                                <SexBadge sex={sex} />
                              ) : (
                                <span className="tabs" style={{ padding: 2 }}>
                                  <button type="button" onClick={() => setSexOverride({ ...sexOverride, [id]: 'M' })}>
                                    H
                                  </button>
                                  <button type="button" onClick={() => setSexOverride({ ...sexOverride, [id]: 'F' })}>
                                    D
                                  </button>
                                </span>
                              )}
                            </td>
                            <td className="r">{pointsCell(pts?.single, points.isLoading)}</td>
                            <td className="r">{pointsCell(pts?.double, points.isLoading)}</td>
                            <td className="r">{pointsCell(pts?.mix, points.isLoading)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {setup.higherTeam && (
                <Card
                  title={`Højere rangerende hold: ${setup.higherTeam.team.name}`}
                  subtitle={
                    setup.higherTeam.lineup
                      ? `Seneste opstilling ${formatDate(setup.higherTeam.lineup.date)} mod ${setup.higherTeam.lineup.opponent.name}. Bruges til § 38 stk. 4.`
                      : 'Ingen kampe fundet for holdet.'
                  }
                  actions={
                    <label className="pill-toggle" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={compareHigher}
                        onChange={(e) => setParam('sammenlign', e.target.checked ? null : '0')}
                        style={{ marginRight: 6 }}
                      />
                      Tjek
                    </label>
                  }
                >
                  {setup.higherTeam.lineup ? (
                    <div className="list">
                      {setup.higherTeam.lineup.players.map((p) => {
                        const pts = points.data?.points[String(p.id)]
                        return (
                          <div className="list-row" key={p.slug}>
                            <span className="name">
                              <SexBadge sex={p.sex} /> <PlayerLink player={p} />
                            </span>
                            <span className="meta">{p.slots.join(', ')}</span>
                            <span className="meta num">
                              {categoriesFromSlots(p.slots)
                                .map((c) => `${c === 'single' ? 'S' : c === 'double' ? 'D' : 'M'} ${pts?.[c] != null ? formatNumber(pts[c]) : '–'}`)
                                .join(' · ')}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <p className="note" style={{ marginTop: '0.6rem' }}>
                    Reglen sammenligner med det højere hold i samme spillerunde. Kender du dets opstilling, så brug den som
                    rettesnor; her bruges den seneste spillede.{' '}
                    <Link className="link" to={`/hold/${setup.higherTeam.team.slug}`}>
                      Se holdet →
                    </Link>
                  </p>
                </Card>
              )}

              <Card title="Sådan tjekkes der">
                <ul className="note-list">
                  <li>Point er den aktuelle rangliste på badmintonplayer.dk. Reglementet bruger månedens første offentliggjorte liste fra den 10. i måneden, så tallene kan afvige få dage om måneden.</li>
                  <li>Singler skal stå i pointrækkefølge med højst 50 points spillerum; doubler efter parrets samlede point med højst 100 (§ 38 stk. 2 og 3).</li>
                  <li>Spillere på et lavere hold skal i mindst én af de kategorier, det højere holds spillere af samme køn spiller, ligge under eller højst 50 point over (§ 38 stk. 4).</li>
                  <li>U17/U19-vurderinger, papirhold, reserver og karantæne (§ 38 stk. 5 og 7, § 43 og § 44) tjekkes ikke.</li>
                  <li>
                    Kilde:{' '}
                    <a className="link" href="https://badminton.dk/holdturneringsregler/" target="_blank" rel="noreferrer noopener">
                      badminton.dk/holdturneringsregler ↗
                    </a>
                  </li>
                </ul>
              </Card>
            </div>
          </div>
          <p className="note">
            Dette er en betafunktion. Klubben er selv ansvarlig for opstillingen (§ 38 stk. 1). Send gerne fejl til os via{' '}
            <TeamLink team={setup.team} className="link" />
            -siden.
          </p>
        </>
      )}
    </div>
  )
}
