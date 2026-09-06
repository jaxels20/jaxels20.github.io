import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useGroup, useTeam } from '../api'
import { TrendChart, WinLossBars } from '../components/charts'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, PlayerLink, ResultBadge, Stat, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatPct, record, seasonLabel } from '../lib/format'

export function TeamPage() {
  const { slug } = useParams()
  const { season, setSeason, resolved, explicit } = useSeasonParam('latest')
  const { data, error, isLoading } = useTeam(resolved ? slug : undefined, season)
  const [showAll, setShowAll] = useState(false)
  usePageTitle(data ? `${data.team.name} · Hold` : null)

  const context = data?.seasons.find((e) => season === null || e.seasonId === season)
  const group = useGroup(context && season !== null ? context.seasonId : null, context && season !== null ? context.groupId : null)
  const standing = group.data?.standings.find((row) => row.team.slug === data?.team.slug)

  // Without an explicit season in the link, fall back to the latest season the team actually played.
  useEffect(() => {
    if (!data || explicit || season === null) return
    if (data.summary.teamMatches === 0 && data.seasons.length > 0) setSeason(data.seasons[0].seasonId, true)
  }, [data, explicit, season, setSeason])

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const s = data.summary
  const hasData = s.teamMatches > 0
  const matches = showAll ? data.matches : data.matches.slice(0, 10)

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <section className="hero-card">
        <div className="hero-row">
          <div>
            <div className="eyebrow">
              Hold
              {context && (
                <>
                  {' · '}
                  <Link to={`/ligaer/${context.seasonId}/${context.groupId}`}>
                    {context.division} · {context.groupName}
                  </Link>
                </>
              )}
            </div>
            <h1>{data.team.name}</h1>
            <div className="hero-meta">
              <span>{seasonLabel(season)}</span>
              {standing && group.data && (
                <span className="chip chip-accent">
                  Nr. {standing.rank} af {group.data.standings.length}
                </span>
              )}
              {hasData && <span>{record(s.teamWins, s.teamDraws, s.teamLosses)} i holdkampe</span>}
              <FormPills results={data.form} />
            </div>
          </div>
          <div className="page-tools">
            <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
            <Link className="btn" to={`/hold-mod-hold?a=${data.team.slug}`}>
              Hold mod hold
            </Link>
            <Link className="btn btn-ghost" to={`/holdopstilling?hold=${data.team.slug}`}>
              Sæt holdet
            </Link>
          </div>
        </div>
      </section>

      {!hasData ? (
        <EmptyState>
          {data.team.name} har ingen kampe i {seasonLabel(season)}.{' '}
          {data.seasons.length > 0 && (
            <>
              Holdet har spillet i:{' '}
              {[...new Set(data.seasons.map((e) => e.seasonId))].map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <button type="button" className="link link-accent" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setSeason(id)}>
                    {seasonLabel(id)}
                  </button>
                </span>
              ))}
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Holdkampe" value={s.teamMatches} sub={`${s.teamWins} vundet, ${s.teamDraws ? `${s.teamDraws} uafgjort, ` : ''}${s.teamLosses} tabt`} />
            <Stat label="Vundne holdkampe" value={formatPct(s.teamWinPct)} sub="Andel af holdkampe vundet" accent />
            <Stat label="Vundne enkeltkampe" value={formatPct(s.winPct)} sub={`${s.wins}–${s.losses} af alle kampe på holdskemaet`} />
            <Stat label="Vundne sæt" value={formatPct(s.setWinPct)} sub={`${s.setsWon} vundet, ${s.setsLost} tabt`} />
          </div>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Kamptyper" subtitle="Vundne og tabte kampe på hver plads i holdopstillingen. Stregen er 50 %.">
                <WinLossBars
                  rows={data.byMatchType.map((row) => ({
                    key: row.matchType,
                    label: row.matchType,
                    sub: disciplineName(row.code),
                    wins: row.wins,
                    losses: row.losses,
                    winPct: row.winPct,
                  }))}
                />
              </Card>

              <Card
                title="Seneste holdkampe"
                subtitle="Nyeste øverst. Klik på datoen for alle enkeltkampe."
                actions={
                  data.matches.length > 10 && (
                    <button type="button" className="btn btn-sm" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Vis færre' : `Vis alle ${data.matches.length}`}
                    </button>
                  )
                }
              >
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dato</th>
                        <th>Modstander</th>
                        <th>Resultat</th>
                        <th>Række</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m) => (
                        <tr key={m.matchId}>
                          <td>
                            <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                              {formatDate(m.date)}
                            </Link>
                          </td>
                          <td className="primary">
                            <TeamLink team={m.opponent} />
                            <span className="dim" style={{ fontWeight: 400 }}>
                              {' '}
                              {m.home ? 'hjemme' : 'ude'}
                            </span>
                          </td>
                          <td>
                            <strong>
                              <ResultBadge result={m.result} />
                            </strong>{' '}
                            {m.disciplinesWon}–{m.disciplinesLost}
                          </td>
                          <td className="dim">{m.groupName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {data.seasonTrend.length > 1 && (
                <Card title="Sæson for sæson" subtitle="Andel vundne holdkampe pr. sæson">
                  <TrendChart
                    points={data.seasonTrend.map((t) => ({
                      x: seasonLabel(t.seasonId),
                      y: t.teamWinPct,
                      detail: `${record(t.wins, t.draws, t.losses)} · ${t.divisions}`,
                    }))}
                    formatY={(v) => `${Math.round(v)} %`}
                    domain={[0, 100]}
                    baseline={50}
                  />
                </Card>
              )}
            </div>

            <div className="stack">
              <Card title="Spillere" subtitle="Flest holdkampe øverst">
                <div className="list">
                  {data.players.slice(0, 10).map((p) => (
                    <div className="list-row" key={p.player.slug}>
                      <span className="name">
                        <PlayerLink player={p.player} />
                      </span>
                      <span className="meta">
                        {p.teamMatches} {p.teamMatches === 1 ? 'holdkamp' : 'holdkampe'} · {p.wins}–{p.losses}
                      </span>
                      <strong className="num">{formatPct(p.winPct)}</strong>
                    </div>
                  ))}
                </div>
              </Card>

              {data.pairs.length > 0 && (
                <Card title="Bedste doubler" subtitle="Par med flest kampe sammen">
                  <div className="list">
                    {data.pairs.slice(0, 4).map((pair) => (
                      <div className="list-row" key={`${pair.players[0].slug}-${pair.players[1].slug}-${pair.code}`}>
                        <span className="name">
                          <PlayerLink player={pair.players[0]} /> / <PlayerLink player={pair.players[1]} />
                        </span>
                        <span className="meta">
                          {pair.code} · {pair.wins}–{pair.losses}
                        </span>
                        <strong className="num">{formatPct(pair.winPct)}</strong>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
