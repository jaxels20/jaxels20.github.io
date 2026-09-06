import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { optimiseLineup, useLineupClub, useLineupPoints, useLineupSetup, useResolveEntity } from '../api'
import { IssueList, issueCounts } from '../components/lineup/IssueList'
import { LineupForm, type SlotOption } from '../components/lineup/LineupForm'
import { RosterCard, SexBadge } from '../components/lineup/RosterCard'
import { RankingListNotice } from '../components/RankingListNotice'
import { SearchBox } from '../components/SearchBox'
import { Card, EmptyState, ErrorState, PageSkeleton, PlayerLink, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatNumber, formatPct, seasonLabel } from '../lib/format'
import {
  checkClub,
  checkLineup,
  filledSlots,
  higherFromAssignment,
  pointsKeyFor,
  sexAllowed,
  slotCapacity,
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
import type { LineupFormat, LineupLatest, LineupPoints, LineupSetupPlayer, OptimiseResult } from '../types'

type SetParams = ReturnType<typeof useSearchParams>[1]
type View = 'tjek' | 'optimer'
type Verdict = ReturnType<typeof verdict>

const SLOT_CATEGORIES: Record<string, PointsKey[]> = { MD: ['mix'], DS: ['single'], HS: ['single'], DD: ['double'], HD: ['double'] }
const SLOT_PARAM = /^(h\d+_)?(md|ds|hs|dd|hd)\d$/

function categoriesFromSlots(slots: string[]): PointsKey[] {
  const out = new Set<PointsKey>()
  for (const s of slots) {
    const code = s.replace(/^\d+\.\s*/, '')
    for (const key of SLOT_CATEGORIES[code] ?? []) out.add(key)
  }
  return [...out]
}

/** Slot ids from the URL. Slots are `md1=idA,idB`; in club mode they carry a team prefix, `h2_md1`. */
function parseAssignment(params: URLSearchParams, slots: SlotSpec[], prefix = ''): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const slot of slots) {
    const raw = params.get(prefix + slot.key.toLowerCase())
    out[slot.key] = raw ? raw.split(',').map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0) : []
  }
  return out
}

/** Every player id placed anywhere in the URL, so a shared link ticks them as available. */
function idsInUrl(params: URLSearchParams): number[] {
  const ids: number[] = []
  for (const [key, value] of params.entries()) {
    if (!SLOT_PARAM.test(key)) continue
    for (const v of value.split(',')) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) ids.push(n)
    }
  }
  return ids
}

function withSlot(prev: URLSearchParams, slots: SlotSpec[], prefix: string, slot: SlotSpec, position: number, id: number | null) {
  const copy = new URLSearchParams(prev)
  const ids = [...(parseAssignment(prev, slots, prefix)[slot.key] ?? [])]
  while (ids.length < slot.size) ids.push(0)
  ids[position] = id ?? 0
  const value = ids.map((n) => (n > 0 ? String(n) : '')).join(',')
  const key = prefix + slot.key.toLowerCase()
  if (value.replace(/,/g, '') === '') copy.delete(key)
  else copy.set(key, value)
  return copy
}

function withoutSlots(prev: URLSearchParams, prefix: string) {
  const copy = new URLSearchParams(prev)
  for (const slot of slotsFor(13)) copy.delete(prefix + slot.key.toLowerCase())
  return copy
}

function readFormat(params: URLSearchParams, key: string): 9 | 13 | null {
  const v = params.get(key)
  return v === '9' ? 9 : v === '13' ? 13 : null
}

/** The team's own format unless the coach switched it, for instance when a team moves division. */
function formatFor(base: LineupFormat, override: 9 | 13 | null): Format {
  if (override && override !== base.matches) {
    return override === 9
      ? { matches: 9, minMen: 4, minWomen: 3, maxPerPlayer: null, division: '1. division' }
      : { matches: 13, minMen: 6, minWomen: 4, maxPerPlayer: 2, division: '2. division' }
  }
  return base
}

function makePlayerFactory(points: LineupPoints | undefined, sexOverride: Record<number, Sex>) {
  return (p: { id?: number | null; name: string; sex: Sex | null }): LineupPlayer => {
    const id = p.id ?? 0
    const pts = points?.points[String(id)]
    return {
      id,
      name: p.name,
      sex: sexOverride[id] ?? p.sex,
      points: pts ? { single: pts.single, double: pts.double, mix: pts.mix } : null,
      youth: Boolean(pts?.youth),
      ageGroup: pts?.ageGroup ?? null,
    }
  }
}

function buildAssignment(
  slots: SlotSpec[],
  raw: Record<string, number[]>,
  rosterById: Map<number, LineupSetupPlayer>,
  toPlayer: ReturnType<typeof makePlayerFactory>,
): Assignment {
  const out: Assignment = {}
  for (const slot of slots) {
    const ids = raw[slot.key] ?? []
    out[slot.key] = Array.from({ length: slot.size }, (_, i) => {
      const p = ids[i] ? rosterById.get(ids[i]) : undefined
      return p ? toPlayer(p) : null
    })
  }
  return out
}

function higherFromLatest(latest: LineupLatest, toPlayer: ReturnType<typeof makePlayerFactory>): HigherTeamPlayer[] {
  return latest.players.map((p) => ({ player: toPlayer(p), categories: categoriesFromSlots(p.slots), slots: p.slots }))
}

/** Availability ticks and sex fixes live in state; they reset when the chosen team or club changes. */
function useAvailability(key: string | null, initialIds: number[] | null) {
  const [available, setAvailable] = useState<Set<number>>(new Set())
  const [sexOverride, setSexOverride] = useState<Record<number, Sex>>({})
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!key || !initialIds || initialisedFor === key) return
    setAvailable(new Set(initialIds))
    setSexOverride({})
    setInitialisedFor(key)
  }, [key, initialIds, initialisedFor])
  const toggle = (id: number, on: boolean) => {
    setAvailable((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const setSex = (id: number, sex: Sex) => setSexOverride((prev) => ({ ...prev, [id]: sex }))
  return { available, toggle, sexOverride, setSex }
}

function useOptions(
  players: LineupSetupPlayer[],
  available: Set<number>,
  sexOverride: Record<number, Sex>,
  points: LineupPoints | undefined,
  usedLabel: (id: number) => string,
) {
  return (slot: SlotSpec, position: number): SlotOption[] => {
    const need = sexAllowed(slot.category, position)
    const key = pointsKeyFor(slot.category)
    return players
      .filter((p) => p.id && available.has(p.id))
      .filter((p) => (sexOverride[p.id!] ?? p.sex) === need || (sexOverride[p.id!] ?? p.sex) === null)
      .map((p) => {
        const pts = points?.points[String(p.id)]?.[key]
        return { id: p.id!, label: `${p.name}${pts != null ? ` · ${formatNumber(pts)}` : ''}${usedLabel(p.id!)}` }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'da'))
  }
}

function verdictTitle(status: Verdict, hasWarnings: boolean): string {
  if (status === 'legal') return hasWarnings ? 'Lovlig på point, men kræver vurdering' : 'Lovlig opstilling'
  if (status === 'illegal') return 'Opstillingen er ikke lovlig'
  return 'Opstillingen er ikke komplet'
}

function StatusChip({ status, filled, capacity }: { status: Verdict; filled: number; capacity: number }) {
  if (filled === 0) return <span className="chip">ikke sat</span>
  const label = status === 'legal' ? 'lovlig' : status === 'illegal' ? 'ulovlig' : `${filled} af ${capacity} pladser`
  return <span className={`chip lineup-status-${status}`}>{label}</span>
}

function FormatTabs({ current, base, onChange }: { current: number; base: number; onChange: (value: string | null) => void }) {
  return (
    <div className="tabs" role="group" aria-label="Kampformat">
      {[13, 9].map((m) => (
        <button key={m} type="button" className={current === m ? 'active' : ''} onClick={() => onChange(m === base ? null : String(m))}>
          {m} kampe
        </button>
      ))}
    </div>
  )
}

function ViewTabs({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
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
  )
}

function PointsNotice({ points }: { points: { data?: LineupPoints } }) {
  return points.data ? (
    <RankingListNotice status={points.data.rankingList} />
  ) : (
    <div className="ranking-notice muted">Henter ranglistepoint og ranglistens dato fra badmintonplayer.dk…</div>
  )
}

function ChosenBar({ name, scope, onScope, onClear, single }: { name: string; scope: 'hold' | 'klub'; onScope: (s: 'hold' | 'klub') => void; onClear: () => void; single: boolean }) {
  return (
    <div className="lineup-chosen">
      <div className="picker-chosen">
        <span className="picker-name">{name}</span>
        <button type="button" className="picker-change" onClick={onClear}>
          Skift
        </button>
      </div>
      {!single && (
        <div className="tabs" role="group" aria-label="Omfang">
          <button type="button" className={scope === 'hold' ? 'active' : ''} onClick={() => onScope('hold')}>
            Ét hold
          </button>
          <button type="button" className={scope === 'klub' ? 'active' : ''} onClick={() => onScope('klub')}>
            Hele klubben
          </button>
        </div>
      )}
    </div>
  )
}

function HowItChecks({ club }: { club: boolean }) {
  return (
    <Card title="Sådan tjekkes der">
      <ul className="note-list">
        <li>Point er den seneste rangliste på badmintonplayer.dk; datoen og den gældende månedsliste står øverst på siden.</li>
        <li>Singler skal stå i pointrækkefølge med højst 50 points spillerum; doubler efter parrets samlede point med højst 100 (§ 38 stk. 2 og 3).</li>
        <li>Spillere på et lavere hold skal i mindst én af de kategorier, det højere holds spillere af samme køn spiller, ligge under eller højst 50 point over (§ 38 stk. 4).</li>
        {club && (
          <>
            <li>Når flere hold er sat, sammenlignes hvert hold med det hold, der står lige over det. Er det højere hold ikke sat, bruges dets seneste spillede opstilling.</li>
            <li>En spiller må kun stå på ét hold i samme spillerunde (§ 45), og holdene skal fyldes op fra oven (§ 38 stk. 1 c).</li>
          </>
        )}
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
  )
}

function BetaNote({ children }: { children: ReactNode }) {
  return (
    <p className="note">
      Dette er en betafunktion. Klubben er selv ansvarlig for opstillingen (§ 38 stk. 1). {children}
    </p>
  )
}

// --- page ------------------------------------------------------------------------

export function LineupPage() {
  const [params, setParams] = useSearchParams()
  const teamSlug = params.get('hold')
  const clubSlug = params.get('klub')

  // Two use cases on one page: checking a lineup by hand, or having one proposed
  // against an opponent. The tab lives in the URL; an opponent in the URL implies the latter.
  const requestedView = params.get('visning')
  const view: View = requestedView === 'optimer' || (!requestedView && params.get('mod')) ? 'optimer' : 'tjek'
  const setView = (next: View) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      copy.set('visning', next)
      return copy
    })
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
            To værktøjer: tjek om en opstilling er lovlig efter DH-reglementets § 37 og § 38, for ét hold eller for hele
            klubben på én gang, eller få foreslået den opstilling der vinder flest kampe mod en bestemt modstander.
            Ranglistepoint hentes fra badmintonplayer.dk.
          </p>
        </div>
      </div>

      {clubSlug ? (
        <ClubLineup clubSlug={clubSlug} view={view} setView={setView} setParams={setParams} />
      ) : teamSlug ? (
        <TeamLineup teamSlug={teamSlug} view={view} setView={setView} params={params} setParams={setParams} />
      ) : (
        <>
          <div style={{ maxWidth: 520 }}>
            <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
              Hold
            </div>
            <SearchBox mode="pick" restrict="team" placeholder="Vælg det hold der skal sættes" onPick={(o) => setParams(new URLSearchParams({ hold: o.entity.slug }))} />
          </div>
          <EmptyState>
            Vælg et hold for at komme i gang. Spillerne hentes fra holdets kampe i indeværende sæson. Har klubben flere hold,
            kan du bagefter skifte til at sætte hele klubben.
          </EmptyState>
        </>
      )}
    </div>
  )
}

// --- one team ---------------------------------------------------------------------

function TeamLineup({ teamSlug, view, setView, params, setParams }: { teamSlug: string; view: View; setView: (v: View) => void; params: URLSearchParams; setParams: SetParams }) {
  const { data: setup, error, isLoading } = useLineupSetup(teamSlug)
  usePageTitle(setup ? `Holdopstilling · ${setup.team.name}` : null)

  const compareHigher = params.get('sammenlign') !== '0'
  const format = useMemo(() => (setup ? formatFor(setup.format, readFormat(params, 'format')) : null), [setup, params])
  const slots = useMemo(() => slotsFor(format?.matches ?? 13), [format])

  const initialIds = useMemo(() => {
    if (!setup) return null
    const own = setup.players
      .filter((p) => p.team.slug === setup.team.slug && p.lastSeason === setup.seasonId)
      .map((p) => p.id)
      .filter((id): id is number => typeof id === 'number')
    return [...own, ...idsInUrl(params)]
    // The URL only seeds the ticks once, when the team loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup])
  const { available, toggle, sexOverride, setSex } = useAvailability(setup?.team.slug ?? null, initialIds)

  const allIds = useMemo(() => {
    if (!setup) return []
    const ids = setup.players.map((p) => p.id).filter((id): id is number => typeof id === 'number')
    for (const p of setup.higherTeam?.lineup?.players ?? []) if (typeof p.id === 'number') ids.push(p.id)
    return ids
  }, [setup])
  const points = useLineupPoints(allIds)
  const toPlayer = useMemo(() => makePlayerFactory(points.data, sexOverride), [points.data, sexOverride])

  const rosterById = useMemo(() => {
    const map = new Map<number, LineupSetupPlayer>()
    for (const p of setup?.players ?? []) if (p.id) map.set(p.id, p)
    return map
  }, [setup])

  const rawAssignment = useMemo(() => parseAssignment(params, slots), [params, slots])
  const assignment = useMemo(() => buildAssignment(slots, rawAssignment, rosterById, toPlayer), [slots, rawAssignment, rosterById, toPlayer])

  const higher = useMemo(() => {
    if (!setup?.higherTeam?.lineup || !compareHigher) return null
    return { teamName: setup.higherTeam.team.name, players: higherFromLatest(setup.higherTeam.lineup, toPlayer) }
  }, [setup, compareHigher, toPlayer])

  const issues: Issue[] = useMemo(() => (format ? checkLineup(format, slots, assignment, higher) : []), [format, slots, assignment, higher])
  const status = verdict(issues)

  const setSlot = (slot: SlotSpec, position: number, id: number | null) => setParams((prev) => withSlot(prev, slots, '', slot, position, id))
  const clearAll = () => setParams((prev) => withoutSlots(prev, ''))
  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      if (value === null) copy.delete(key)
      else copy.set(key, value)
      return copy
    })
  }

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
        const copy = withoutSlots(prev, '')
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

  const runOptimiser = async () => {
    if (!setup || !format || !opponentSlug) return
    setOptimising(true)
    setOptimiseError(null)
    try {
      const sex: Record<string, 'M' | 'F'> = {}
      for (const [id, value] of Object.entries(sexOverride)) sex[id] = value
      const result = await optimiseLineup({ team: setup.team.slug, opponent: opponentSlug, available: [...available], matches: format.matches, sex })
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

  const optionsFor = useOptions(setup?.players ?? [], available, sexOverride, points.data, (id) => {
    const used = usedCount.get(id) ?? 0
    return used ? ` · (${used})` : ''
  })

  if (error) return <ErrorState error={error} />
  if (isLoading || !setup || !format) return <PageSkeleton />

  const chosenBar = (
    <ChosenBar
      name={setup.team.name}
      scope="hold"
      single={setup.otherTeams.length === 0}
      onScope={(s) => {
        if (s === 'klub') setParams(new URLSearchParams({ klub: setup.team.slug, ...(view === 'optimer' ? { visning: 'tjek' } : {}) }))
      }}
      onClear={() => setParams(new URLSearchParams())}
    />
  )

  return (
    <>
      {chosenBar}
      <ViewTabs view={view} setView={setView} />
      <PointsNotice points={points} />

      <section className={`lineup-verdict lineup-verdict-${status}`} aria-live="polite">
        <div>
          <strong>{verdictTitle(status, issues.some((i) => i.severity === 'warning'))}</strong>
          <span className="lineup-verdict-sub">
            {format.division} · {format.matches} kampe · mindst {format.minMen} herrer og {format.minWomen} damer
            {points.isLoading && ' · henter point…'}
            {points.isError && ' · point kunne ikke hentes, alle tæller som 0'}
          </span>
        </div>
        <div className="page-tools">
          <FormatTabs current={format.matches} base={setup.format.matches} onChange={(v) => setParam('format', v)} />
          <button type="button" className="btn btn-sm" onClick={clearAll}>
            Ryd opstilling
          </button>
        </div>
      </section>

      <div className="grid grid-main lineup-grid">
        <div className="stack">
          {view === 'optimer' ? (
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
                    <p className="note">Udeladt: {optimised.excluded.map((e) => `${e.player.name} (${e.reason})`).join(' · ')}</p>
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
                            <span className="muted" style={{ fontSize: '1rem' }}>
                              {' '}
                              af {optimised.format.matches}
                            </span>
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
                        Tallet ved navnet er ranglistepoint i den pågældende disciplin. Spillere sættes i de discipliner, de normalt spiller; "ny
                        disciplin" markerer, at forslaget flytter en spiller til noget uvant, fordi det tydeligt giver flere sejre. Sejrschancen bygger
                        på holdenes ligakampe i data, og modstanderens opstilling er et gæt.
                      </p>
                    </>
                  )}
                </div>
              )}
            </Card>
          ) : (
            <Card title="Opstilling" subtitle="Rækkefølgen følger det officielle holdskema. Tallet ved en plads er de samlede ranglistepoint for den pågældende rangliste.">
              <LineupForm slots={slots} rawIds={rawAssignment} assignment={assignment} issues={issues} optionsFor={optionsFor} onChange={setSlot} />
            </Card>
          )}

          <Card title="Regeltjek" subtitle={issueCounts(issues)}>
            <IssueList issues={issues} />
          </Card>
        </div>

        <div className="stack">
          <RosterCard
            title="Spillere"
            subtitle={`Spillere der har spillet for ${setup.team.name} i ${seasonLabel(setup.seasonId)} eller sæsonen før${setup.otherTeams.length ? ', plus klubbens andre hold' : ''}. Marker hvem der er til rådighed.`}
            players={setup.players}
            homeSlug={setup.team.slug}
            seasonId={setup.seasonId}
            available={available}
            onToggle={toggle}
            sexOverride={sexOverride}
            onSex={setSex}
            points={points.data}
            pointsLoading={points.isLoading}
          />

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
                  <input type="checkbox" checked={compareHigher} onChange={(e) => setParam('sammenlign', e.target.checked ? null : '0')} style={{ marginRight: 6 }} />
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
                Reglen sammenligner med det højere hold i samme spillerunde. Kender du dets opstilling, så sæt hele klubben på én gang; her
                bruges den seneste spillede.{' '}
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
          <HowItChecks club={false} />
        </div>
      </div>
      <BetaNote>
        Send gerne fejl til os via <TeamLink team={setup.team} className="link" />
        -siden.
      </BetaNote>
    </>
  )
}

// --- the whole club ----------------------------------------------------------------

function ClubLineup({ clubSlug, view, setView, setParams }: { clubSlug: string; view: View; setView: (v: View) => void; setParams: SetParams }) {
  const [params] = useSearchParams()
  const { data: club, error, isLoading } = useLineupClub(clubSlug)
  usePageTitle(club ? `Holdopstilling · ${club.club}` : null)

  const compareHigher = params.get('sammenlign') !== '0'

  const initialIds = useMemo(() => {
    if (!club) return null
    const own = club.players
      .filter((p) => p.lastSeason === club.seasonId)
      .map((p) => p.id)
      .filter((id): id is number => typeof id === 'number')
    return [...own, ...idsInUrl(params)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club])
  const { available, toggle, sexOverride, setSex } = useAvailability(club ? `klub:${club.club}` : null, initialIds)

  const allIds = useMemo(() => {
    if (!club) return []
    const ids = new Set<number>()
    for (const p of club.players) if (typeof p.id === 'number') ids.add(p.id)
    for (const t of club.teams) for (const p of t.latestLineup?.players ?? []) if (typeof p.id === 'number') ids.add(p.id)
    return [...ids]
  }, [club])
  const points = useLineupPoints(allIds)
  const toPlayer = useMemo(() => makePlayerFactory(points.data, sexOverride), [points.data, sexOverride])

  const rosterById = useMemo(() => {
    const map = new Map<number, LineupSetupPlayer>()
    for (const p of club?.players ?? []) if (p.id) map.set(p.id, p)
    return map
  }, [club])

  // One entry per team, first team downwards. Each team is checked against the team
  // right above it: the lineup entered here if there is one, else its latest played lineup.
  const teams = useMemo(() => {
    if (!club) return []
    const sorted = [...club.teams].sort((a, b) => a.rank - b.rank)
    const built = sorted.map((t) => {
      const prefix = `h${t.rank}_`
      const format = formatFor(t.format, readFormat(params, `${prefix}format`))
      const slots = slotsFor(format.matches)
      const raw = parseAssignment(params, slots, prefix)
      const assignment = buildAssignment(slots, raw, rosterById, toPlayer)
      return { data: t, prefix, format, slots, raw, assignment, filled: filledSlots(slots, assignment), capacity: slotCapacity(slots) }
    })
    return built.map((t, i) => {
      const above = i > 0 ? built[i - 1] : null
      let higher: { teamName: string; players: HigherTeamPlayer[] } | null = null
      let higherSource: 'entered' | 'latest' | 'none' = 'none'
      if (above && compareHigher) {
        if (above.filled > 0) {
          higher = { teamName: above.data.team.name, players: higherFromAssignment(above.slots, above.assignment) }
          higherSource = 'entered'
        } else if (above.data.latestLineup) {
          higher = { teamName: above.data.team.name, players: higherFromLatest(above.data.latestLineup, toPlayer) }
          higherSource = 'latest'
        }
      }
      const issues = checkLineup(t.format, t.slots, t.assignment, higher)
      if (above && higherSource === 'latest' && t.filled > 0) {
        issues.push({
          severity: 'info',
          rule: '§ 38 stk. 4',
          message: `${above.data.team.name} er ikke sat her, så der sammenlignes med holdets seneste spillede opstilling (${formatDate(above.data.latestLineup!.date)} mod ${above.data.latestLineup!.opponent.name}).`,
        })
      }
      return { ...t, above, higher, higherSource, issues, status: verdict(issues) }
    })
  }, [club, params, rosterById, toPlayer, compareHigher])

  const clubIssues = useMemo(
    () => checkClub(teams.map((t) => ({ name: t.data.team.name, rank: t.data.rank, format: t.format, slots: t.slots, assignment: t.assignment }))),
    [teams],
  )

  const usedBy = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const t of teams) {
      const seen = new Set<number>()
      for (const slot of t.slots) for (const p of t.assignment[slot.key] ?? []) if (p && !seen.has(p.id)) { seen.add(p.id); map.set(p.id, [...(map.get(p.id) ?? []), t.data.team.name]) }
    }
    return map
  }, [teams])

  const entered = teams.filter((t) => t.filled > 0)
  const allIssues = [...clubIssues, ...teams.flatMap((t) => t.issues)]
  const overall: Verdict =
    entered.length === 0
      ? 'incomplete'
      : entered.some((t) => t.status === 'illegal') || clubIssues.some((i) => i.severity === 'error')
        ? 'illegal'
        : entered.some((t) => t.status === 'incomplete')
          ? 'incomplete'
          : 'legal'
  const overallTitle =
    entered.length === 0
      ? 'Ingen hold sat endnu'
      : overall === 'legal'
        ? allIssues.some((i) => i.severity === 'warning')
          ? entered.length === teams.length
            ? 'Alle hold er lovlige på point, men kræver vurdering'
            : 'De satte hold er lovlige på point, men kræver vurdering'
          : entered.length === teams.length
            ? 'Alle hold er lovligt sat'
            : 'De satte hold er lovlige'
        : overall === 'illegal'
          ? 'Mindst ét hold er ikke lovligt'
          : 'Mindst ét hold er ikke komplet'

  const setSlotFor = (t: (typeof teams)[number]) => (slot: SlotSpec, position: number, id: number | null) =>
    setParams((prev) => withSlot(prev, t.slots, t.prefix, slot, position, id))
  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      if (value === null) copy.delete(key)
      else copy.set(key, value)
      return copy
    })
  }
  const clearTeam = (prefix: string) => setParams((prev) => withoutSlots(prev, prefix))
  const clearAll = () =>
    setParams((prev) => {
      let copy = new URLSearchParams(prev)
      for (const t of teams) copy = withoutSlots(copy, t.prefix)
      return copy
    })

  const optionsFor = useOptions(club?.players ?? [], available, sexOverride, points.data, (id) => {
    const on = usedBy.get(id)
    return on ? ` · (${on.join(', ')})` : ''
  })

  if (error) return <ErrorState error={error} />
  if (isLoading || !club) return <PageSkeleton />

  const firstSlug = teams.find((t) => t.data.team.slug === clubSlug)?.data.team.slug ?? teams[0]?.data.team.slug ?? clubSlug

  return (
    <>
      <ChosenBar
        name={`${club.club} · ${teams.length} hold`}
        scope="klub"
        single={false}
        onScope={(s) => {
          if (s === 'hold') setParams(new URLSearchParams({ hold: firstSlug }))
        }}
        onClear={() => setParams(new URLSearchParams())}
      />
      <ViewTabs view={view} setView={setView} />
      <PointsNotice points={points} />

      {view === 'optimer' ? (
        <Card title="Find den bedste opstilling gælder ét hold ad gangen" subtitle="Vælg hvilket af klubbens hold der skal sættes mod en modstander. Du kan bagefter skifte tilbage til hele klubben.">
          <div className="lineup-team-buttons">
            {teams.map((t) => (
              <button key={t.data.team.slug} type="button" className="btn" onClick={() => setParams(new URLSearchParams({ hold: t.data.team.slug, visning: 'optimer' }))}>
                {t.data.team.name} <span className="dim">· {t.format.division}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <>
          <section className={`lineup-verdict lineup-verdict-${overall}`} aria-live="polite">
            <div>
              <strong>{overallTitle}</strong>
              <span className="lineup-verdict-sub">
                {entered.length} af {teams.length} hold sat · {issueCounts(allIssues)}
                {points.isLoading && ' · henter point…'}
                {points.isError && ' · point kunne ikke hentes, alle tæller som 0'}
              </span>
            </div>
            <div className="page-tools">
              <label className="pill-toggle" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={compareHigher} onChange={(e) => setParam('sammenlign', e.target.checked ? null : '0')} style={{ marginRight: 6 }} />
                Tjek mod højere hold
              </label>
              <button type="button" className="btn btn-sm" onClick={clearAll}>
                Ryd alle
              </button>
            </div>
          </section>

          <div className="grid grid-main lineup-grid">
            <div className="stack">
              {teams.map((t) => (
                <Card
                  key={t.data.team.slug}
                  title={
                    <span className="lineup-team-title">
                      {t.data.rank}. {t.data.team.name} <StatusChip status={t.status} filled={t.filled} capacity={t.capacity} />
                    </span>
                  }
                  subtitle={`${t.format.division} · ${t.format.matches} kampe · mindst ${t.format.minMen} herrer og ${t.format.minWomen} damer${
                    t.above
                      ? t.higherSource === 'entered'
                        ? ` · sammenlignes med ${t.above.data.team.name} som sat ovenfor`
                        : t.higherSource === 'latest'
                          ? ` · sammenlignes med ${t.above.data.team.name}s seneste kamp`
                          : ''
                      : ''
                  }`}
                  actions={
                    <div className="page-tools">
                      <FormatTabs current={t.format.matches} base={t.data.format.matches} onChange={(v) => setParam(`${t.prefix}format`, v)} />
                      <button type="button" className="btn btn-sm" onClick={() => clearTeam(t.prefix)} disabled={t.filled === 0}>
                        Ryd
                      </button>
                    </div>
                  }
                >
                  <LineupForm slots={t.slots} rawIds={t.raw} assignment={t.assignment} issues={t.issues} optionsFor={optionsFor} onChange={setSlotFor(t)} />
                  {t.filled > 0 && (
                    <div className="lineup-team-issues">
                      <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
                        Regeltjek · {issueCounts(t.issues)}
                      </div>
                      <IssueList issues={t.issues} />
                    </div>
                  )}
                </Card>
              ))}

              <Card title="På tværs af holdene" subtitle={`§ 45 og § 38 stk. 1 c · ${issueCounts(clubIssues)}`}>
                <IssueList issues={clubIssues} empty={entered.length < 2 ? 'Sæt mindst to hold for at tjekke reglerne på tværs af holdene.' : 'Ingen problemer på tværs af holdene.'} />
              </Card>
            </div>

            <div className="stack">
              <RosterCard
                title="Spillere"
                subtitle={`Alle der har spillet for ${club.club} i ${seasonLabel(club.seasonId)} eller sæsonen før. Marker hvem der er til rådighed i runden; navnet viser det hold, spilleren senest spillede for.`}
                players={club.players}
                seasonId={club.seasonId}
                available={available}
                onToggle={toggle}
                sexOverride={sexOverride}
                onSex={setSex}
                points={points.data}
                pointsLoading={points.isLoading}
                usedBy={usedBy}
              />
              <HowItChecks club />
            </div>
          </div>
          <BetaNote>Opstillingerne ligger i adressen, så du kan dele linket med klubbens andre holdledere.</BetaNote>
        </>
      )}
    </>
  )
}
