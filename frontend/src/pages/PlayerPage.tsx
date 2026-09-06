import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'

import { usePlayer, usePlayerRanking } from '../api'
import { TrendChart, WinLossBars } from '../components/charts'
import { SeasonPicker } from '../components/SeasonPicker'
import {
  Card,
  EmptyState,
  ErrorState,
  FormPills,
  PageSkeleton,
  PctStat,
  PlayerLink,
  ResultBadge,
  Skeleton,
  Stat,
  TeamLink,
} from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatNumber, formatPct, formatSigned, seasonLabel } from '../lib/format'
import { usePageTitle } from '../hooks/usePageTitle'

export function PlayerPage() {
  const { slug } = useParams()
  const { season, setSeason, resolved, explicit } = useSeasonParam('latest')
  const { data, error, isLoading } = usePlayer(resolved ? slug : undefined, season)
  const ranking = usePlayerRanking(slug)
  usePageTitle(data ? `${data.player.name} · Spiller` : null)

  useEffect(() => {
    if (!data || explicit || season === null) return
    if (data.summary.matches === 0 && data.seasons.length > 0) {
      setSeason(data.seasons[0].seasonId, true)
    }
  }, [data, explicit, season, setSeason])

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const s = data.summary
  const hasData = s.matches > 0
  const seasonIds = [...new Set(data.seasons.map((e) => e.seasonId))]

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
            </div>
            <h1>{data.player.name}</h1>
            <div className="hero-meta">
              <span>{seasonLabel(season)}</span>
              {hasData && (
                <span>
                  {s.wins}–{s.losses} i {s.matches} kampe
                </span>
              )}
              {hasData && data.byDiscipline.length > 0 && <span>{data.byDiscipline.map((d) => d.code).join(' · ')}</span>}
              {ranking.data?.club && <span>{ranking.data.club}</span>}
              <FormPills results={data.form} />
              {data.player.id && (
                <a
                  className="link"
                  href={`https://badmintonplayer.dk/DBF/Spiller/VisSpiller/#${data.player.id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Profil på badmintonplayer.dk ↗
                </a>
              )}
            </div>
          </div>
          <div className="page-tools">
            <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
            <Link className="btn" to={`/spiller-mod-spiller?a=${data.player.slug}`}>
              Sammenlign med en anden spiller
            </Link>
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
            <Stat label="Kampe" value={s.matches} sub={`${s.wins}–${s.losses} · ${s.teamMatches} holdkampe`} />
            <PctStat label="Sejrsprocent" value={s.winPct} sub={s.walkovers ? `${formatPct(s.nonWalkoverWinPct)} uden walkover` : 'Ingen walkovers'} />
            <PctStat label="Vundne sæt" value={s.setWinPct} sub={`${s.setsWon}–${s.setsLost}`} />
            <PctStat label="Vundne point" value={s.pointWinPct} sub={`${formatSigned(s.avgPointMargin)} point pr. kamp`} />
            <PctStat label="3-sæts kampe" value={s.threeSetWinPct} sub={`${s.threeSetWins} af ${s.threeSetMatches} vundet`} />
            <Stat label="I to sæt" value={`${s.straightSetWins}–${s.straightSetLosses}`} sub="Vundet–tabt uden tredje sæt" />
          </div>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Vundet og tabt pr. disciplin" subtitle="Stregen markerer 50 %.">
                <WinLossBars
                  rows={data.byDiscipline.map((d) => ({
                    key: d.code,
                    label: d.code,
                    sub: disciplineName(d.code),
                    wins: d.wins,
                    losses: d.losses,
                    winPct: d.winPct,
                    detail: `sæt ${formatPct(d.setWinPct)} · point ${formatPct(d.pointWinPct)}`,
                  }))}
                />
                {data.byMatchType.length > data.byDiscipline.length && (
                  <>
                    <div className="divider" style={{ margin: '0.9rem 0' }} />
                    <h3 style={{ marginBottom: '0.5rem' }}>Pr. plads i opstillingen</h3>
                    <WinLossBars
                      rows={data.byMatchType.map((row) => ({
                        key: row.matchType,
                        label: row.matchType,
                        wins: row.wins,
                        losses: row.losses,
                        winPct: row.winPct,
                      }))}
                    />
                  </>
                )}
              </Card>

              {(ranking.data || ranking.isLoading) && (
                <Card
                  title="Rangliste og niveau"
                  subtitle="Point fra badmintonplayer.dk. Niveauet er spillerens tilmeldingsniveau ved hver sæsonstart."
                  actions={
                    ranking.data && (
                      <a className="btn btn-sm" href={ranking.data.profileUrl} target="_blank" rel="noreferrer noopener">
                        Se profil ↗
                      </a>
                    )
                  }
                >
                  {ranking.isLoading ? (
                    <Skeleton height={200} />
                  ) : ranking.data ? (
                    <>
                      {ranking.data.lists.length > 0 ? (
                        <div className="table-wrap">
                          <table className="table table-compact">
                            <thead>
                              <tr>
                                <th>Rangliste</th>
                                <th>Række</th>
                                <th className="r">Point</th>
                                <th className="r">Kampe</th>
                                <th className="r">Placering</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ranking.data.lists.map((row) => (
                                <tr key={row.list}>
                                  <td className="primary">{row.list}</td>
                                  <td className="dim">{row.group ?? '–'}</td>
                                  <td className="r">
                                    <strong>{formatNumber(row.points)}</strong>
                                  </td>
                                  <td className="r">{row.matches ?? '–'}</td>
                                  <td className="r">{row.place ? `nr. ${formatNumber(row.place)}` : '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="note" style={{ marginTop: '0.5rem' }}>
                            Ranglistepoint for {seasonLabel(ranking.data.currentSeasonId)}. Ranglisterne opgøres kun for
                            den igangværende sæson.
                          </p>
                        </div>
                      ) : (
                        <p className="note">Ingen ranglistepoint i den igangværende sæson.</p>
                      )}

                      {ranking.data.levels.length > 1 && (
                        <>
                          <div className="divider" style={{ margin: '0.9rem 0' }} />
                          <h3 style={{ marginBottom: '0.5rem' }}>Niveau ved sæsonstart</h3>
                          <TrendChart
                            points={ranking.data.levels.map((l) => ({
                              x: seasonLabel(l.seasonId),
                              y: l.level,
                              detail: 'niveau',
                            }))}
                            formatY={(v) => formatNumber(Math.round(v))}
                          />
                        </>
                      )}
                    </>
                  ) : null}
                </Card>
              )}

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
                <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Sæson</th>
                        <th>Række</th>
                        <th className="r">Kampe</th>
                        <th className="r">V–T</th>
                        <th className="r">Sejr %</th>
                        <th className="r">Point ±</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.seasonTrend].reverse().map((t) => (
                        <tr key={t.seasonId} className={t.seasonId === season ? 'hl' : ''}>
                          <td>
                            <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setSeason(t.seasonId)}>
                              {seasonLabel(t.seasonId)}
                            </button>
                          </td>
                          <td className="dim">{t.divisions}</td>
                          <td className="r">{t.played}</td>
                          <td className="r">
                            {t.wins}–{t.losses}
                          </td>
                          <td className="r">{formatPct(t.winPct)}</td>
                          <td className="r">{formatSigned(t.pointDelta, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Kampe" subtitle={`${data.matches.length} seneste kampe`}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dato</th>
                        <th>Kamp</th>
                        <th>Modstander</th>
                        <th className="c">Res.</th>
                        <th className="r">Sæt</th>
                        <th>Sætcifre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.matches.map((m, i) => (
                        <tr key={`${m.matchId}-${m.matchType}-${i}`}>
                          <td>
                            <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                              {formatDate(m.date)}
                            </Link>
                          </td>
                          <td className="primary">
                            {m.matchType}
                            {m.partner && (
                              <span className="dim" style={{ fontWeight: 400 }}>
                                {' '}
                                m. <PlayerLink player={m.partner} />
                              </span>
                            )}
                            <div className="dim" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                              {m.home ? 'hjemme' : 'ude'} mod <TeamLink team={m.opponentTeam} />
                            </div>
                          </td>
                          <td className="primary">
                            {m.opponents.length ? (
                              m.opponents.map((o, j) => (
                                <span key={o.slug}>
                                  {j > 0 && ' / '}
                                  <PlayerLink player={o} />
                                </span>
                              ))
                            ) : (
                              <span className="dim">–</span>
                            )}
                          </td>
                          <td className="c">
                            <strong>
                              <ResultBadge result={m.result} />
                            </strong>
                          </td>
                          <td className="r">
                            {m.setsWon}–{m.setsLost}
                          </td>
                          <td className="dim">{m.walkover ? `Walkover${m.walkoverCode ? ` (${m.walkoverCode})` : ''}` : m.setScores || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="stack">
              <Card title="Hjemme og ude">
                <div className="stat-grid">
                  <Stat
                    label="Hjemme"
                    value={formatPct(data.homeAway.home?.winPct ?? null)}
                    sub={data.homeAway.home ? `${data.homeAway.home.wins}–${data.homeAway.home.losses}` : '–'}
                  />
                  <Stat
                    label="Ude"
                    value={formatPct(data.homeAway.away?.winPct ?? null)}
                    sub={data.homeAway.away ? `${data.homeAway.away.wins}–${data.homeAway.away.losses}` : '–'}
                  />
                </div>
              </Card>

              <Card title="Makkere" subtitle="Doublekampe sammen">
                {data.partners.length === 0 ? (
                  <EmptyState>Ingen doublekampe.</EmptyState>
                ) : (
                  <div className="list">
                    {data.partners.slice(0, 8).map((p) => (
                      <div className="list-row" key={p.player.slug}>
                        <span className="name">
                          <PlayerLink player={p.player} />
                        </span>
                        <span className="meta">
                          {p.disciplines.join('/')} · {p.wins}–{p.losses}
                        </span>
                        <strong className="num">{formatPct(p.winPct)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Modstandere" subtitle="Spillere mødt flest gange">
                <div className="list">
                  {data.rivals.slice(0, 8).map((r) => (
                    <div className="list-row" key={r.player.slug}>
                      <span className="name">
                        <PlayerLink player={r.player} />
                      </span>
                      <span className="meta">
                        {r.wins}–{r.losses}
                      </span>
                      <Link className="btn btn-sm btn-ghost" to={`/spiller-mod-spiller?a=${data.player.slug}&b=${r.player.slug}`}>
                        Sammenlign
                      </Link>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Hold" subtitle="Hold spilleren har repræsenteret">
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Hold</th>
                        <th>Sæsoner</th>
                        <th className="r">Kampe</th>
                        <th className="r">Sejr %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.teams.map((t) => (
                        <tr key={t.team.slug}>
                          <td className="primary">
                            <TeamLink team={t.team} />
                          </td>
                          <td className="dim">
                            {t.firstSeason === t.lastSeason ? seasonLabel(t.firstSeason) : `${seasonLabel(t.firstSeason)} – ${seasonLabel(t.lastSeason)}`}
                          </td>
                          <td className="r">{t.played}</td>
                          <td className="r">{formatPct(t.winPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Modstanderhold" subtitle="Kampe mod hvert hold">
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Hold</th>
                        <th className="r">Kampe</th>
                        <th className="r">Sejr %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.opponentTeams.slice(0, 10).map((o) => (
                        <tr key={o.team.slug}>
                          <td className="primary">
                            <TeamLink team={o.team} />
                          </td>
                          <td className="r">{o.played}</td>
                          <td className="r">{formatPct(o.winPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
