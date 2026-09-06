import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useTeam } from '../api'
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
  Stat,
  TeamLink,
} from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatNumber, formatPct, formatSigned, record, seasonLabel } from '../lib/format'

export function TeamPage() {
  const { slug } = useParams()
  const { season, setSeason, resolved, explicit } = useSeasonParam('latest')
  const { data, error, isLoading } = useTeam(resolved ? slug : undefined, season)

  // Without an explicit season in the URL, fall back to the latest season the team actually played.
  useEffect(() => {
    if (!data || explicit || season === null) return
    if (data.summary.teamMatches === 0 && data.seasons.length > 0) {
      setSeason(data.seasons[0].seasonId, true)
    }
  }, [data, explicit, season, setSeason])

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const s = data.summary
  const entries = data.seasons.filter((e) => season === null || e.seasonId === season)
  const context = entries[0]
  const hasData = s.teamMatches > 0

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
              {hasData && (
                <span>
                  {record(s.teamWins, s.teamDraws, s.teamLosses)} i holdkampe
                </span>
              )}
              <FormPills results={data.form} />
            </div>
          </div>
          <div className="page-tools">
            <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
            <Link className="btn" to={`/hold-mod-hold?a=${data.team.slug}`}>
              Sammenlign med et andet hold
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
            <Stat label="Holdkampe" value={s.teamMatches} sub={`${record(s.teamWins, s.teamDraws, s.teamLosses)} (V–U–T)`} />
            <PctStat label="Holdsejre" value={s.teamWinPct} sub={`${s.teamWins} af ${s.teamMatches}`} />
            <PctStat label="Vundne kampe" value={s.winPct} sub={`${s.wins}–${s.losses} i enkeltkampe`} />
            <PctStat label="Vundne sæt" value={s.setWinPct} sub={`${formatNumber(s.setsWon)}–${formatNumber(s.setsLost)}`} />
            <PctStat label="Vundne point" value={s.pointWinPct} sub={`${formatSigned(s.avgPointMargin)} point pr. kamp`} />
            <PctStat label="3-sæts kampe" value={s.threeSetWinPct} sub={`${s.threeSetWins} af ${s.threeSetMatches} vundet`} />
          </div>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Vundet og tabt pr. kamptype" subtitle="Enkeltkampe fordelt på plads i holdopstillingen. Stregen markerer 50 %.">
                <WinLossBars
                  rows={data.byMatchType.map((row) => ({
                    key: row.matchType,
                    label: row.matchType,
                    sub: disciplineName(row.code),
                    wins: row.wins,
                    losses: row.losses,
                    winPct: row.winPct,
                    detail: row.setsWon !== undefined ? `sæt ${row.setsWon}–${row.setsLost}` : undefined,
                  }))}
                />
              </Card>

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
                <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Sæson</th>
                        <th>Række</th>
                        <th className="r">Kampe</th>
                        <th className="r">V–U–T</th>
                        <th className="r">Enkeltkampe</th>
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
                          <td className="r">{t.teamMatches}</td>
                          <td className="r">{record(t.wins, t.draws, t.losses)}</td>
                          <td className="r">
                            {t.disciplinesWon}–{t.disciplinesLost}
                          </td>
                          <td className="r">{formatSigned(t.pointDelta, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Holdkampe" subtitle={`${data.matches.length} seneste kampe`}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dato</th>
                        <th>Modstander</th>
                        <th className="c">H/U</th>
                        <th className="c">Res.</th>
                        <th className="r">Kampe</th>
                        <th className="r">Sæt</th>
                        <th className="r">Point</th>
                        <th>Række</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.matches.map((m) => (
                        <tr key={m.matchId}>
                          <td>
                            <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                              {formatDate(m.date)}
                            </Link>
                          </td>
                          <td className="primary">
                            <TeamLink team={m.opponent} />
                          </td>
                          <td className="c dim">{m.home ? 'H' : 'U'}</td>
                          <td className="c">
                            <strong>
                              <ResultBadge result={m.result} />
                            </strong>
                          </td>
                          <td className="r">
                            {m.disciplinesWon}–{m.disciplinesLost}
                          </td>
                          <td className="r dim">
                            {m.setsWon}–{m.setsLost}
                          </td>
                          <td className="r dim">
                            {m.pointsWon}–{m.pointsLost}
                          </td>
                          <td className="dim">
                            <Link className="link" to={`/ligaer/${m.seasonId}/${m.groupId}`}>
                              {m.groupName}
                            </Link>
                          </td>
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
                    sub={data.homeAway.home ? record(data.homeAway.home.wins, data.homeAway.home.draws, data.homeAway.home.losses) : '–'}
                  />
                  <Stat
                    label="Ude"
                    value={formatPct(data.homeAway.away?.winPct ?? null)}
                    sub={data.homeAway.away ? record(data.homeAway.away.wins, data.homeAway.away.draws, data.homeAway.away.losses) : '–'}
                  />
                </div>
              </Card>

              <Card title="Spillere" subtitle="Sorteret efter antal holdkampe">
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Spiller</th>
                        <th className="r">Holdk.</th>
                        <th className="r">V–T</th>
                        <th className="r">Sejr %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.players.slice(0, 18).map((p) => (
                        <tr key={p.player.slug}>
                          <td className="primary">
                            <PlayerLink player={p.player} />
                            <span className="dim" style={{ fontWeight: 400 }}>
                              {' '}
                              {p.disciplines.join('/')}
                            </span>
                          </td>
                          <td className="r">{p.teamMatches}</td>
                          <td className="r">
                            {p.wins}–{p.losses}
                          </td>
                          <td className="r">{formatPct(p.winPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Bedste doubler" subtitle="Par med flest kampe sammen">
                {data.pairs.length === 0 ? (
                  <EmptyState>Ingen doubler.</EmptyState>
                ) : (
                  <div className="list">
                    {data.pairs.slice(0, 8).map((pair) => (
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
                )}
              </Card>

              <Card title="Modstandere" subtitle="Holdkampe mod hvert hold">
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th>Hold</th>
                        <th className="r">Kampe</th>
                        <th className="r">V–U–T</th>
                        <th className="r">Enkeltk.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.opponents.slice(0, 14).map((o) => (
                        <tr key={o.team.slug}>
                          <td className="primary">
                            <TeamLink team={o.team} />
                          </td>
                          <td className="r">{o.played}</td>
                          <td className="r">{record(o.wins, o.draws, o.losses)}</td>
                          <td className="r dim">
                            {o.disciplinesWon}–{o.disciplinesLost}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.opponents.length > 1 && (
                  <p className="note" style={{ marginTop: '0.6rem' }}>
                    <Link className="link" to={`/hold-mod-hold?a=${data.team.slug}&b=${data.opponents[0].team.slug}`}>
                      Se hold mod hold mod {data.opponents[0].team.name} →
                    </Link>
                  </p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
