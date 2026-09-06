import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { optimiseLineup, useLineupPoints, useLineupSetup, useResolveEntity } from '../api'
import { RankingListNotice } from '../components/RankingListNotice'
import { SearchBox } from '../components/SearchBox'
import { Card, EmptyState, ErrorState, PageSkeleton, PlayerLink, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatNumber, formatPct, seasonLabel } from '../lib/format'
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
import type { LineupSetupPlayer, OptimiseResult } from '../types'

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
      .filter((p) => p.team.slug === setup.team.slug && p.lastSeason === setup.seasonId)
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
      youth: Boolean(pts?.youth),
      ageGroup: pts?.ageGroup ?? null,
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

  const status = verdict(issues)

  // Two use cases on one page: checking a lineup by hand, or having one proposed
  // against an opponent. The tab lives in the URL; an opponent in the URL implies the latter.
  const requestedView = params.get('visning')
  const view: 'tjek' | 'optimer' = requestedView === 'optimer' || (!requestedView && params.get('mod')) ? 'optimer' : 'tjek'
  const setView = (next: 'tjek' | 'optimer') => setParam('visning', next)

  // Optimiser: opponent in the URL (mod=...), result in state.
  const opponentSlug = params.get('mod')
  const opponentName = useResolveEntity('team', opponentSlug, Boolean(opponentSlug))
  const [optimised, setOptimised] = useState<OptimiseResult | null>(null)
  const [optimising, setOptimising] = useState(false)
  const [optimiseError, setOptimiseError] = useState<string | null>(null)
  const [chosenCandidate, setChosenCandidate] = useState(0)

  const applyCandidate = (slotsToApply: Record<string, number[]>) => {
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev)
        for (const slot of slotsFor(13)) copy.delete(slot.key.toLowerCase())
        for (const [key, ids] of Object.entries(slotsToApply)) copy.set(key.toLowerCase(), ids.join(','))
        return copy
      },
      { replace: true },
    )
  }

  const chooseCandidate = (index: number) => {
    setChosenCandidate(index)
    const candidate = optimised?.candidates[index]
    if (candidate) applyCandidate(candidate.slots)
  }

  const chooseTeam = (slug: string) => {
    setParams(() => new URLSearchParams({ hold: slug }))
  }

  const runOptimiser = async () => {
    if (!setup || !format || !opponentSlug) return
    setOptimising(true)
    setOptimiseError(null)
    try {
      const sex: Record<string, 'M' | 'F'> = {}
      for (const [id, value] of Object.entries(sexOverride)) sex[id] = value
      const result = await optimiseLineup({
        team: setup.team.slug,
        opponent: opponentSlug,
        available: [...available],
        matches: format.matches,
        sex,
      })
      setOptimised(result)
      setChosenCandidate(0)
      if (result.candidates[0]) applyCandidate(result.candidates[0].slots)
    } catch (err) {
      setOptimiseError(err instanceof Error ? err.message : 'Beregningen fejlede.')
    } finally {
      setOptimising(false)
    }
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
            To værktøjer: tjek om en opstilling er lovlig efter DH-reglementets § 37 og § 38, eller få foreslået den
            opstilling der vinder flest kampe mod en bestemt modstander. Ranglistepoint hentes fra badmintonplayer.dk.
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
          <div className="view-tabs" role="tablist" aria-label="Værktøj">
            <button type="button" role="tab" aria-selected={view === 'tjek'} className={view === 'tjek' ? 'active' : ''} onClick={() => setView('tjek')}>
              <strong>Tjek en opstilling</strong>
              <span>Sæt holdet i hånden og se, om det er lovligt</span>
            </button>
            <button type="button" role="tab" aria-selected={view === 'optimer'} className={view === 'optimer' ? 'active' : ''} onClick={() => setView('optimer')}>
              <strong>Find den bedste opstilling</strong>
              <span>Mod en bestemt modstander, ud fra tidligere kampe</span>
            </button>
          </div>

          {points.data ? (
            <RankingListNotice status={points.data.rankingList} />
          ) : (
            <div className="ranking-notice muted">Henter ranglistepoint og ranglistens dato fra badmintonplayer.dk…</div>
          )}

          <section className={`lineup-verdict lineup-verdict-${status}`} aria-live="polite">
            <div>
              <strong>
                {status === 'legal'
                  ? issues.some((i) => i.severity === 'warning')
                    ? 'Lovlig på point, men kræver vurdering'
                    : 'Lovlig opstilling'
                  : status === 'illegal'
                    ? 'Opstillingen er ikke lovlig'
                    : 'Opstillingen er ikke komplet'}
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
              {view === 'optimer' ? (
                <>
              <Card
                title="Bedste opstilling mod en modstander"
                subtitle="Finder den lovlige opstilling med flest forventede vundne kampe mod modstanderens seneste opstilling. Bruger de spillere, der er markeret til rådighed."
              >
                <div className="optimise-controls">
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
                      Modstander
                    </div>
                    {opponentSlug ? (
                      <div className="picker-chosen">
                        <span className="picker-name">{optimised?.opponent.name ?? opponentName.data?.name ?? opponentSlug}</span>
                        <button
                          type="button"
                          className="picker-change"
                          onClick={() => {
                            setParam('mod', null)
                            setOptimised(null)
                          }}
                        >
                          Skift
                        </button>
                      </div>
                    ) : (
                      <SearchBox mode="pick" restrict="team" placeholder="Vælg modstanderhold" onPick={(o) => setParam('mod', o.entity.slug)} />
                    )}
                  </div>
                  <button type="button" className="btn btn-primary" disabled={!opponentSlug || optimising || points.isLoading} onClick={runOptimiser}>
                    {optimising ? 'Beregner…' : 'Beregn bedste opstilling'}
                  </button>
                </div>

                {optimiseError && (
                  <div className="error" role="alert" style={{ marginTop: '0.8rem' }}>
                    {optimiseError}
                  </div>
                )}

                {optimised && (
                  <div className="stack" style={{ marginTop: '1rem' }}>
                    {optimised.opponentLineup ? (
                      <p className="note">
                        Modstanderen antages at stille som i seneste kamp, {formatDate(optimised.opponentLineup.date)} mod{' '}
                        <TeamLink team={optimised.opponentLineup.against} />. {optimised.model}
                      </p>
                    ) : (
                      <p className="note">{optimised.model}</p>
                    )}
                    {optimised.notes.map((n) => (
                      <p className="note" key={n}>
                        {n}
                      </p>
                    ))}
                    {optimised.excluded.length > 0 && (
                      <p className="note">
                        Udeladt: {optimised.excluded.map((e) => `${e.player.name} (${e.reason})`).join(' · ')}
                      </p>
                    )}

                    <div className="tabs" role="tablist" aria-label="Forslag">
                      {optimised.candidates.map((c, i) => (
                        <button key={i} type="button" role="tab" aria-selected={chosenCandidate === i} className={chosenCandidate === i ? 'active' : ''} onClick={() => chooseCandidate(i)}>
                          Forslag {i + 1} · {c.expectedWins.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sejre
                        </button>
                      ))}
                    </div>

                    {optimised.candidates[chosenCandidate] && (
                      <>
                        <div className="optimise-summary">
                          <div className="stat">
                            <div className="stat-label">Forventede sejre</div>
                            <div className="stat-value num accent">
                              {optimised.candidates[chosenCandidate].expectedWins.toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                              <span className="muted" style={{ fontSize: '1rem' }}> af {optimised.format.matches}</span>
                            </div>
                          </div>
                          <div className="stack" style={{ gap: '0.4rem', alignItems: 'flex-end' }}>
                            <p className="note" style={{ maxWidth: '34ch', textAlign: 'right' }}>
                              Forslaget er sat ind som holdets opstilling, og regeltjekket nedenfor gælder det.
                            </p>
                            <button type="button" className="btn btn-sm" onClick={() => setView('tjek')}>
                              Ret opstillingen i hånden →
                            </button>
                          </div>
                        </div>
                        <div className="table-wrap">
                          <table className="table table-compact">
                            <thead>
                              <tr>
                                <th>Kamp</th>
                                <th>{optimised.team.name}</th>
                                <th className="c">Sejrschance</th>
                                <th>{optimised.opponent.name}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {optimised.candidates[chosenCandidate].details.map((row) => (
                                <tr key={row.slot}>
                                  <td className="primary">{row.slot}</td>
                                  <td className="primary">
                                    {row.ours.map((o, i) => (
                                      <span key={o.slug}>
                                        {i > 0 && ' / '}
                                        <PlayerLink player={o} />
                                        <span className="dim num" style={{ fontWeight: 400 }} title="Ranglistepoint i denne disciplin">
                                          {' '}
                                          {o.points ? formatNumber(o.points) : '–'}
                                        </span>
                                        {o.unusual && (
                                          <span className="chip" style={{ marginLeft: 4 }} title="Spiller normalt ikke denne disciplin ifølge kampdata">
                                            ny disciplin
                                          </span>
                                        )}
                                      </span>
                                    ))}
                                  </td>
                                  <td className="c">
                                    <span className={`pwin ${row.pWin >= 0.6 ? 'good' : row.pWin <= 0.4 ? 'bad' : ''}`.trim()}>{formatPct(row.pWin * 100)}</span>
                                  </td>
                                  <td>
                                    {row.theirs.length ? (
                                      row.theirs.map((t, i) => (
                                        <span key={t.slug}>
                                          {i > 0 && ' / '}
                                          <PlayerLink player={t} />
                                          <span className="dim num" title="Ranglistepoint i denne disciplin">
                                            {' '}
                                            {t.points ? formatNumber(t.points) : '–'}
                                          </span>
                                        </span>
                                      ))
                                    ) : (
                                      <span className="dim">ukendt</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="note">
                          Tallet ved navnet er ranglistepoint i den pågældende disciplin. Spillere sættes i de discipliner, de
                          normalt spiller; "ny disciplin" markerer, at forslaget flytter en spiller til noget uvant, fordi det tydeligt
                          giver flere sejre. Sejrschancen bygger på holdenes ligakampe i data, og modstanderens opstilling er et gæt.
                        </p>
                      </>
                    )}
                  </div>
                )}
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

                </>
              ) : (
                <>
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

                </>
              )}
            </div>

            <div className="stack">
              <Card
                title="Spillere"
                subtitle={`Spillere der har spillet for ${setup.team.name} i ${seasonLabel(setup.seasonId)} eller sæsonen før${setup.otherTeams.length ? ', plus klubbens andre hold' : ''}. Marker hvem der er til rådighed.`}
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
                              {(foreign || p.lastSeason !== setup.seasonId) && (
                                <div className="dim" style={{ fontWeight: 400, fontSize: '0.74rem' }}>
                                  {foreign ? p.team.name : ''}
                                  {foreign && p.lastSeason !== setup.seasonId ? ' · ' : ''}
                                  {p.lastSeason !== setup.seasonId ? `sidst ${seasonLabel(p.lastSeason)}` : ''}
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

              {view === 'optimer' && (
                <Card title="Sådan findes opstillingen">
                  <ul className="note-list">
                    <li>Modstanderen antages at stille som i sin seneste kamp. Kender du deres opstilling, kan du sammenligne under Tjek en opstilling.</li>
                    <li>Hver spillers styrke pr. disciplin bygger på alle ligakampe i data. Spillere sættes i de discipliner, de normalt spiller.</li>
                    <li>Kun lovlige opstillinger foreslås, og forslaget tjekkes efter de samme regler som en opstilling sat i hånden.</li>
                    <li>Tre forslag vises; forskellene er som regel små bytninger i doublerne.</li>
                  </ul>
                </Card>
              )}
              <Card title="Sådan tjekkes der">
                <ul className="note-list">
                  <li>Point er den seneste rangliste på badmintonplayer.dk; datoen og den gældende månedsliste står øverst på siden.</li>
                  <li>Singler skal stå i pointrækkefølge med højst 50 points spillerum; doubler efter parrets samlede point med højst 100 (§ 38 stk. 2 og 3).</li>
                  <li>Spillere på et lavere hold skal i mindst én af de kategorier, det højere holds spillere af samme køn spiller, ligge under eller højst 50 point over (§ 38 stk. 4).</li>
                  <li>U17/U19-spillere genkendes på ranglisten og markeres. Reglementet kræver, at de placeres efter vurderet styrke i seniorregi, ikke point (§ 38 stk. 5), så sammenligninger hvor de indgår vises som advarsler til klubbens egen vurdering.</li>
                  <li>Papirhold, reserver og karantæne (§ 38 stk. 7, § 43 og § 44) tjekkes ikke.</li>
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
