import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useClub } from '../api'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, PlayerLink, ResultBadge, Stat, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatPct, pluralize, record, seasonLabel } from '../lib/format'
import type { ClubPlayer, ClubTeam, ClubTeamAllTime } from '../types'

function placement(t: { position: number | null; groupSize: number; played: number }): string {
  if (t.position === null || t.played === 0) return 'Ikke spillet endnu'
  return `Nr. ${t.position} af ${t.groupSize}`
}

function PlayerRows({ players, seasonId, showTeams }: { players: ClubPlayer[]; seasonId: number | null; showTeams: boolean }) {
  return (
    <div className="list">
      {players.map((p, i) => (
        <div className="list-row" key={p.player.slug}>
          <span className="name">
            <span className="dim num" style={{ display: 'inline-block', width: '1.6em' }}>
              {i + 1}.
            </span>
            <PlayerLink player={p.player} />
          </span>
          <span className="meta">
            {showTeams
              ? p.teams.map((t) => t.team.name).join(' + ')
              : `${pluralize(p.seasons, 'sæson', 'sæsoner')}${seasonId && p.lastSeason !== seasonId ? ` · senest ${seasonLabel(p.lastSeason)}` : ''}`}
            {' · '}
            {p.wins}–{p.losses} · {formatPct(p.winPct)}
            {p.disciplines.length > 0 && <span className="hide-sm"> · {p.disciplines.map(disciplineName).join(', ')}</span>}
          </span>
          <strong className="num" title="Holdkampe">
            {p.teamMatches}
          </strong>
        </div>
      ))}
    </div>
  )
}

function TeamRow({ t }: { t: ClubTeam }) {
  return (
    <>
      <tr>
        <td className="primary">
          <TeamLink team={t.team} />
        </td>
        <td>
          <Link className="link" to={`/ligaer/${t.seasonId}/${t.groupId}`}>
            {t.division}
          </Link>
          <div className="dim" style={{ fontSize: '0.78rem' }}>
            {t.groupName}
          </div>
        </td>
        <td>
          {t.position !== null && t.played > 0 ? (
            <span className={`chip ${t.position === 1 ? 'chip-accent' : ''}`.trim()}>{placement(t)}</span>
          ) : (
            <span className="dim">{placement(t)}</span>
          )}
        </td>
        <td className="r num hide-sm">{t.played}</td>
        <td className="num">{record(t.wins, t.draws, t.losses)}</td>
        <td className="r num hide-sm">{t.points}</td>
        <td>{t.form.length > 0 ? <FormPills results={t.form} label="Seneste fem" /> : <span className="dim">–</span>}</td>
      </tr>
      {t.alsoIn.length > 0 && (
        <tr className="table-note">
          <td></td>
          <td colSpan={6} className="dim" style={{ fontSize: '0.78rem', paddingTop: 0 }}>
            Også med i{' '}
            {t.alsoIn.map((g, i) => (
              <span key={g.groupId}>
                {i > 0 && ', '}
                <Link className="link" to={`/ligaer/${t.seasonId}/${g.groupId}`}>
                  {g.groupName}
                </Link>{' '}
                ({g.played > 0 ? `${placement(g).toLowerCase()} · ${record(g.wins, g.draws, g.losses)}` : 'ikke spillet endnu'})
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}

function AllTimeTeamRow({ t, onSeason }: { t: ClubTeamAllTime; onSeason: (season: number) => void }) {
  return (
    <tr>
      <td className="primary">
        <TeamLink team={t.team} />
      </td>
      <td className="num">
        {t.seasons}
        <div className="dim" style={{ fontSize: '0.78rem', fontWeight: 400 }}>
          {t.firstSeason === t.lastSeason ? seasonLabel(t.firstSeason) : `${seasonLabel(t.firstSeason)} – ${seasonLabel(t.lastSeason)}`}
        </div>
      </td>
      <td>
        {t.divisions.map((d, i) => (
          <span key={d.division}>
            {i > 0 && ', '}
            {d.division} <span className="dim">({d.seasons})</span>
          </span>
        ))}
      </td>
      <td>
        {t.best ? (
          <>
            <span className={`chip ${t.best.position === 1 ? 'chip-accent' : ''}`.trim()}>
              Nr. {t.best.position} af {t.best.groupSize}
            </span>
            <div className="dim" style={{ fontSize: '0.78rem' }}>
              {t.best.division},{' '}
              <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => onSeason(t.best!.seasonId)}>
                {seasonLabel(t.best.seasonId)}
              </button>
            </div>
          </>
        ) : (
          <span className="dim">–</span>
        )}
      </td>
      <td className="r num hide-sm">{t.played}</td>
      <td className="num">{record(t.wins, t.draws, t.losses)}</td>
      <td className="r num">{formatPct(t.winPct)}</td>
    </tr>
  )
}

export function ClubPage() {
  const { slug } = useParams()
  const { season, setSeason, resolved, explicit } = useSeasonParam('latest')
  const { data, error, isLoading } = useClub(resolved ? slug : undefined, season)
  const [playerScope, setPlayerScope] = useState<'season' | 'all'>('season')
  const [showAllPlayers, setShowAllPlayers] = useState(false)
  const [showAllMatches, setShowAllMatches] = useState(false)
  usePageTitle(data ? `${data.club.name} · Klub` : null)

  // Without an explicit season in the link, follow the latest season the club actually played.
  useEffect(() => {
    if (!data || explicit || season === null || data.seasonId === null) return
    if (data.seasonId !== season) setSeason(data.seasonId, true)
  }, [data, explicit, season, setSeason])

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const s = data.summary
  const allSeasons = data.seasonId === null
  const shownSeason = data.seasonId
  const seasonSpan =
    data.seasons.length > 0
      ? data.seasons.length === 1
        ? seasonLabel(data.seasons[0].seasonId)
        : `${seasonLabel(data.seasons[data.seasons.length - 1].seasonId)} – ${seasonLabel(data.seasons[0].seasonId)}`
      : ''
  const players = allSeasons || playerScope === 'all' ? (allSeasons ? data.players : data.allTimePlayers) : data.players
  const visiblePlayers = showAllPlayers ? players : players.slice(0, 12)
  const matches = showAllMatches ? data.matches : data.matches.slice(0, 10)
  const firstTeam = allSeasons ? data.teamsAllTime[0]?.team : data.teams[0]?.team
  const hasTeams = allSeasons ? data.teamsAllTime.length > 0 : data.teams.length > 0
  const divisionsNow = (allSeasons ? data.teamsAllTime.map((t) => t.latestDivision) : data.teams.map((t) => t.division)).filter((d, i, arr) => arr.indexOf(d) === i)

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <section className="hero-card">
        <div className="hero-row">
          <div>
            <div className="eyebrow">Klub</div>
            <h1>{data.club.name}</h1>
            <div className="hero-meta">
              <span>{allSeasons ? `Alle sæsoner · ${seasonSpan}` : seasonLabel(shownSeason)}</span>
              <span className="chip chip-accent">{pluralize(s.teams, 'hold', 'hold')}</span>
              {s.teamMatches > 0 && <span>{record(s.teamWins, s.teamDraws, s.teamLosses)} i holdkampe</span>}
              {s.players > 0 && <span>{s.players} spillere brugt</span>}
            </div>
          </div>
          <div className="page-tools">
            <SeasonPicker value={shownSeason} onChange={(next) => setSeason(next)} />
            {firstTeam && (
              <Link className="btn" to={`/holdopstilling?klub=${firstTeam.slug}`}>
                Sæt holdene
              </Link>
            )}
          </div>
        </div>
      </section>

      {!hasTeams ? (
        <EmptyState>
          {data.club.name} har ingen hold i {seasonLabel(shownSeason)}.{' '}
          {data.seasons.length > 0 && (
            <>
              Klubben har spillet i:{' '}
              {data.seasons.map((e, i) => (
                <span key={e.seasonId}>
                  {i > 0 && ', '}
                  <button type="button" className="link link-accent" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setSeason(e.seasonId)}>
                    {seasonLabel(e.seasonId)}
                  </button>
                </span>
              ))}
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label={allSeasons ? 'Hold i alt' : 'Hold'} value={s.teams} sub={allSeasons ? `Senest i ${divisionsNow.join(', ')}` : divisionsNow.join(', ')} />
            <Stat
              label="Holdkampe"
              value={s.teamMatches}
              sub={s.teamMatches > 0 ? `${s.teamWins} vundet, ${s.teamDraws ? `${s.teamDraws} uafgjort, ` : ''}${s.teamLosses} tabt${allSeasons ? ` i ${pluralize(data.seasons.length, 'sæson', 'sæsoner')}` : ''}` : 'Ingen spillet endnu'}
            />
            <Stat label="Vundne holdkampe" value={formatPct(s.teamWinPct)} sub={allSeasons ? 'Alle klubbens hold, alle sæsoner' : 'På tværs af alle klubbens hold'} accent />
            <Stat label="Spillere brugt" value={s.players} sub={s.multiTeamPlayers > 0 ? `${s.multiTeamPlayers} har spillet for flere hold` : 'Alle på ét hold'} />
          </div>

          {allSeasons ? (
            <Card title="Holdene gennem alle sæsoner" subtitle="Hvert hold klubben har stillet, med de rækker det har spillet i, den bedste placering og det samlede resultat. Bedste nuværende række øverst.">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Hold</th>
                      <th>Sæsoner</th>
                      <th>Rækker (sæsoner)</th>
                      <th>Bedste placering</th>
                      <th className="r hide-sm">Kampe</th>
                      <th>V–U–T</th>
                      <th className="r">Vundet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamsAllTime.map((t) => (
                      <AllTimeTeamRow key={t.team.slug} t={t} onSeason={(id) => setSeason(id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title={`Holdene i ${seasonLabel(shownSeason)}`} subtitle="Bedste række øverst. Klik på rækken for stillingen i puljen.">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Hold</th>
                      <th>Række</th>
                      <th>Placering</th>
                      <th className="r hide-sm">Kampe</th>
                      <th>V–U–T</th>
                      <th className="r hide-sm">Point</th>
                      <th>Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.map((t) => (
                      <TeamRow key={t.team.slug} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="grid grid-main">
            <div className="stack">
              <Card
                title="Flest holdkampe"
                subtitle={
                  allSeasons || playerScope === 'all'
                    ? 'Spillere sorteret efter antal holdkampe for klubben i alle sæsoner i data.'
                    : `Spillere sorteret efter antal holdkampe for klubben i ${seasonLabel(shownSeason)}.`
                }
                actions={
                  !allSeasons && (
                    <div className="tabs" role="tablist" aria-label="Periode">
                      <button type="button" role="tab" aria-selected={playerScope === 'season'} className={playerScope === 'season' ? 'active' : ''} onClick={() => setPlayerScope('season')}>
                        Denne sæson
                      </button>
                      <button type="button" role="tab" aria-selected={playerScope === 'all'} className={playerScope === 'all' ? 'active' : ''} onClick={() => setPlayerScope('all')}>
                        Alle sæsoner
                      </button>
                    </div>
                  )
                }
              >
                {players.length === 0 ? (
                  <p className="text-2">Ingen spillere registreret endnu.</p>
                ) : (
                  <>
                    <PlayerRows players={visiblePlayers} seasonId={shownSeason} showTeams={!allSeasons && playerScope === 'season'} />
                    {players.length > 12 && (
                      <button type="button" className="btn btn-sm" style={{ marginTop: '0.8rem' }} onClick={() => setShowAllPlayers((v) => !v)}>
                        {showAllPlayers ? 'Vis færre' : `Vis alle ${players.length}`}
                      </button>
                    )}
                    <p className="note" style={{ marginTop: '0.6rem' }}>
                      Tallet til højre er holdkampe. Sejrsprocenten gælder spillerens enkeltkampe på holdskemaet.
                    </p>
                  </>
                )}
              </Card>

              <Card title="Holdene sæson for sæson" subtitle="Hvilke rækker klubbens hold har spillet i, og hvor de endte. Klik på en sæson for at se den.">
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Sæson</th>
                        <th>Hold</th>
                        <th>Række</th>
                        <th>Placering</th>
                        <th className="hide-sm">V–U–T</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history.map((h) =>
                        h.teams.map((t, i) => (
                          <tr key={`${h.seasonId}-${t.team.slug}`} className={i === 0 ? 'row-group-start' : ''}>
                            <td className="num">
                              {i === 0 ? (
                                <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => setSeason(h.seasonId)}>
                                  {seasonLabel(h.seasonId)}
                                </button>
                              ) : (
                                ''
                              )}
                            </td>
                            <td className="primary">
                              <TeamLink team={t.team} />
                            </td>
                            <td>
                              <Link className="link" to={`/ligaer/${h.seasonId}/${t.groupId}`}>
                                {t.division}
                              </Link>
                            </td>
                            <td className={t.position === 1 && t.played > 0 ? 'accent' : ''}>{placement(t)}</td>
                            <td className="num hide-sm">{t.played > 0 ? record(t.wins, t.draws, t.losses) : '–'}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="stack">
              <Card
                title="Seneste holdkampe"
                subtitle={allSeasons ? 'Alle klubbens hold, nyeste øverst, på tværs af sæsoner.' : 'Alle klubbens hold, nyeste øverst.'}
                actions={
                  data.matches.length > 10 && (
                    <button type="button" className="btn btn-sm" onClick={() => setShowAllMatches((v) => !v)}>
                      {showAllMatches ? 'Vis færre' : `Vis alle ${data.matches.length}`}
                    </button>
                  )
                }
              >
                {matches.length === 0 ? (
                  <p className="text-2">Ingen spillede holdkampe endnu.</p>
                ) : (
                  <div className="list">
                    {matches.map((m) => (
                      <div className="list-row" key={m.matchId}>
                        <span className="name">
                          <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                            {formatDate(m.date)}
                          </Link>{' '}
                          <span className="dim" style={{ fontWeight: 400 }}>
                            {m.team.name}
                          </span>
                        </span>
                        <span className="meta">
                          {m.home ? 'hjemme mod' : 'ude mod'} <TeamLink team={m.opponent} className="link" />
                        </span>
                        <span className="num">
                          {m.result && <ResultBadge result={m.result} />} {m.disciplinesWon}–{m.disciplinesLost}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
