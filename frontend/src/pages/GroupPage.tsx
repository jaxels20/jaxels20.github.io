import { Link, useParams } from 'react-router-dom'

import { useGroup } from '../api'
import { Card, ErrorState, PageSkeleton, TeamLink } from '../components/ui'
import { formatDate, formatSigned, formatWeekday, seasonLabel } from '../lib/format'
import { usePageTitle } from '../hooks/usePageTitle'

export function GroupPage() {
  const params = useParams()
  const season = params.season ? Number(params.season) : null
  const groupId = params.groupId ? Number(params.groupId) : null
  const { data, error, isLoading } = useGroup(season, groupId)
  usePageTitle(data ? `${data.division} ${data.name} ${seasonLabel(data.seasonId)}` : null)

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const playedRounds = data.rounds.filter((r) => r.matches.some((m) => m.played)).length

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to={`/ligaer/${data.seasonId}`}>Ligaer {seasonLabel(data.seasonId)}</Link> · {data.division}
          </div>
          <h1>{data.name}</h1>
          <p className="page-sub">
            {data.standings.length} hold · {playedRounds} af {data.rounds.length} runder spillet
          </p>
        </div>
      </div>

      <Card title="Stilling" subtitle="Point er de officielle matchpoint fra badmintonplayer.dk. Ved lighed sorteres på kampdifference.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="c">#</th>
                <th>Hold</th>
                <th className="r">K</th>
                <th className="r">V</th>
                <th className="r">U</th>
                <th className="r">T</th>
                <th className="r">Kampe</th>
                <th className="r">Diff.</th>
                <th className="r">Point</th>
              </tr>
            </thead>
            <tbody>
              {data.standings.map((row) => (
                <tr key={row.team.slug}>
                  <td className="c">
                    <span className={`rank ${row.rank === 1 ? 'rank-1' : ''}`.trim()}>{row.rank}</span>
                  </td>
                  <td className="primary">
                    <TeamLink team={row.team} />
                  </td>
                  <td className="r">{row.played}</td>
                  <td className="r">{row.wins}</td>
                  <td className="r">{row.draws}</td>
                  <td className="r">{row.losses}</td>
                  <td className="r dim">
                    {row.disciplinesFor}–{row.disciplinesAgainst}
                  </td>
                  <td className="r">{formatSigned(row.disciplineDiff, 0)}</td>
                  <td className="r">
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div>
        <h2 style={{ marginBottom: '0.75rem' }}>Runder</h2>
        <div className="grid grid-2">
          {data.rounds.map((round) => (
            <Card
              key={round.round ?? 'x'}
              className="card-tight"
              title={round.round ? `Runde ${round.round}` : 'Øvrige kampe'}
              subtitle={round.date ? formatDate(round.date) : undefined}
            >
              <div className="table-wrap">
                <table className="table table-compact">
                  <tbody>
                    {round.matches.map((m) => {
                      const homeWon = m.played && (m.homeDisciplines ?? 0) > (m.awayDisciplines ?? 0)
                      const awayWon = m.played && (m.awayDisciplines ?? 0) > (m.homeDisciplines ?? 0)
                      return (
                        <tr key={m.matchId}>
                          <td className="dim" style={{ width: '1%' }}>
                            {m.date && m.date !== round.date ? formatWeekday(m.date) : m.time ?? ''}
                          </td>
                          <td className="r primary" style={{ fontWeight: homeWon ? 700 : 500 }}>
                            <TeamLink team={m.home} />
                          </td>
                          <td className="c" style={{ width: '1%' }}>
                            <Link className="link" to={`/kampe/${data.seasonId}/${data.groupId}/${m.matchId}`}>
                              {m.played ? (
                                <strong>
                                  {m.homeDisciplines}–{m.awayDisciplines}
                                </strong>
                              ) : (
                                <span className="dim">–</span>
                              )}
                            </Link>
                          </td>
                          <td className="primary" style={{ fontWeight: awayWon ? 700 : 500 }}>
                            <TeamLink team={m.away} />
                          </td>
                          <td className="r dim" style={{ width: '1%' }}>
                            {m.played ? `${m.homePoints}–${m.awayPoints} p` : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
