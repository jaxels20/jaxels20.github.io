import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { usePlayer, usePlayerRanking } from '../api'
import { TrendChart, WinLossBars } from '../components/charts'
import { RankingListNotice } from '../components/RankingListNotice'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, PlayerLink, ResultBadge, Skeleton, Stat, TeamLink } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatNumber, formatPct, seasonLabel } from '../lib/format'

export function PlayerPage() {
  const { slug } = useParams()
  const { season, setSeason, resolved, explicit } = useSeasonParam('latest')
  const { data, error, isLoading } = usePlayer(resolved ? slug : undefined, season)
  const ranking = usePlayerRanking(slug)
  const [showAll, setShowAll] = useState(false)
  usePageTitle(data ? `${data.player.name} · Spiller` : null)

  // Without an explicit season in the link, fall back to the latest season the player actually played.
  useEffect(() => {
    if (!data || explicit || season === null) return
    if (data.summary.matches === 0 && data.seasons.length > 0) setSeason(data.seasons[0].seasonId, true)
  }, [data, explicit, season, setSeason])

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const s = data.summary
  const hasData = s.matches > 0
  const seasonIds = [...new Set(data.seasons.map((e) => e.seasonId))]
  const best = [...data.byDiscipline].filter((d) => d.played >= 3).sort((a, b) => (b.winPct ?? 0) - (a.winPct ?? 0))[0]
  const matches = showAll ? data.matches : data.matches.slice(0, 10)
  const profileUrl = data.player.id ? `https://badmintonplayer.dk/DBF/Spiller/VisSpiller/#${data.player.id}` : null

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <section className="hero-card">
        <div className="hero-row">
          <div>
            <div className="eyebrow">
              Spiller
              {data.currentTeam && (
                <>
                  {' · '}
                  <TeamLink team={data.currentTeam} className="" />
                </>
              )}
              {ranking.data?.club && data.currentTeam?.name !== ranking.data.club && <> · {ranking.data.club}</>}
            </div>
            <h1>{data.player.name}</h1>
            <div className="hero-meta">
              <span>{seasonLabel(season)}</span>
              {hasData && (
                <span>
                  {s.wins} sejre, {s.losses} nederlag
                </span>
              )}
              <FormPills results={data.form} />
            </div>
          </div>
          <div className="page-tools">
            <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
            <Link className="btn" to={`/spiller-mod-spiller?a=${data.player.slug}`}>
              Sammenlign
            </Link>
            {profileUrl && (
              <a className="btn btn-ghost" href={profileUrl} target="_blank" rel="noreferrer noopener">
                badmintonplayer.dk ↗
              </a>
            )}
          </div>
        </div>
      </section>

      {!hasData ? (
        <EmptyState>
          {data.player.name} har ingen kampe i {seasonLabel(season)}.{' '}
          {seasonIds.length > 0 && (
            <>
              Spilleren har spillet i:{' '}
              {seasonIds.map((id, i) => (
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
            <Stat label="Kampe" value={s.matches} sub={`${s.wins}–${s.losses} i ${seasonLabel(season).toLowerCase()}`} />
            <Stat label="Sejrsprocent" value={formatPct(s.winPct)} sub={s.walkovers ? `${s.walkovers} walkover talt med` : 'Alle spillede kampe'} accent />
            <Stat label="Vundne sæt" value={formatPct(s.setWinPct)} sub={`${s.setsWon} vundet, ${s.setsLost} tabt`} />
            <Stat
              label="Bedste disciplin"
              value={best ? best.code : '–'}
              sub={best ? `${disciplineName(best.code)} · ${formatPct(best.winPct)} i ${best.played} kampe` : 'For få kampe'}
            />
          </div>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Discipliner" subtitle="Vundne og tabte kampe i hver disciplin. Stregen er 50 %.">
                <WinLossBars
                  rows={data.byDiscipline.map((d) => ({
                    key: d.code,
                    label: d.code,
                    sub: disciplineName(d.code),
                    wins: d.wins,
                    losses: d.losses,
                    winPct: d.winPct,
                  }))}
                />
              </Card>

              <Card
                title="Seneste kampe"
                subtitle="Nyeste øverst"
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
                        <th>Kamp</th>
                        <th>Modstander</th>
                        <th>Resultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m, i) => (
                        <tr key={`${m.matchId}-${m.matchType}-${i}`}>
                          <td>
                            <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                              {formatDate(m.date)}
                            </Link>
                          </td>
                          <td className="primary">
                            {m.matchType}
                            {m.partner && (
                              <div className="dim" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                                med <PlayerLink player={m.partner} />
                              </div>
                            )}
                          </td>
                          <td className="primary">
                            <TeamLink team={m.opponentTeam} />
                            {m.opponents.length > 0 && (
                              <div className="dim" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                                {m.opponents.map((o, j) => (
                                  <span key={o.slug}>
                                    {j > 0 && ' / '}
                                    <PlayerLink player={o} />
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <strong>
                              <ResultBadge result={m.result} />
                            </strong>{' '}
                            {m.setsWon}–{m.setsLost}
                            <div className="dim" style={{ fontSize: '0.78rem' }}>{m.walkover ? 'Walkover' : m.setScores}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {data.seasonTrend.length > 1 && (
                <Card title="Sæson for sæson" subtitle="Sejrsprocent pr. sæson">
                  <TrendChart
                    points={data.seasonTrend.map((t) => ({
                      x: seasonLabel(t.seasonId),
                      y: t.winPct,
                      detail: `${t.wins}–${t.losses} · ${t.divisions}`,
                    }))}
                    formatY={(v) => `${Math.round(v)} %`}
                    domain={[0, 100]}
                    baseline={50}
                  />
                </Card>
              )}
            </div>

            <div className="stack">
              <Card title="Rangliste" subtitle="Point og placering på badmintonplayer.dk">
                {ranking.isLoading ? (
                  <Skeleton height={140} />
                ) : ranking.data ? (
                  <>
                    {ranking.data.lists.length > 0 ? (
                      <div className="list">
                        {ranking.data.lists.map((row) => (
                          <div className="list-row" key={row.list}>
                            <span className="name">{row.list}</span>
                            <span className="meta">{row.place ? `nr. ${formatNumber(row.place)}` : ''}</span>
                            <strong className="num">{formatNumber(row.points)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="note">Ingen ranglistepoint i den igangværende sæson.</p>
                    )}
                    {ranking.data.levels.length > 1 && (
                      <>
                        <div className="divider" style={{ margin: '0.8rem 0' }} />
                        <h3 style={{ marginBottom: '0.4rem' }}>Niveau ved sæsonstart</h3>
                        <TrendChart
                          height={150}
                          points={ranking.data.levels.map((l) => ({ x: seasonLabel(l.seasonId), y: l.level }))}
                          formatY={(v) => formatNumber(Math.round(v))}
                        />
                      </>
                    )}
                    <div style={{ marginTop: '0.7rem' }}>
                      <RankingListNotice status={ranking.data.rankingList} compact />
                    </div>
                  </>
                ) : (
                  <p className="note">Point kunne ikke hentes fra badmintonplayer.dk lige nu.</p>
                )}
              </Card>

              {data.partners.length > 0 && (
                <Card title="Makkere" subtitle="Doublekampe spillet sammen">
                  <div className="list">
                    {data.partners.slice(0, 5).map((p) => (
                      <div className="list-row" key={p.player.slug}>
                        <span className="name">
                          <PlayerLink player={p.player} />
                        </span>
                        <span className="meta">
                          {p.wins}–{p.losses}
                        </span>
                        <strong className="num">{formatPct(p.winPct)}</strong>
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
