import { Link, useSearchParams } from 'react-router-dom'

import { usePlayerComparison } from '../api'
import { ButterflyBars } from '../components/charts'
import { SearchBox } from '../components/SearchBox'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, PlayerLink, TeamLink } from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatPct, formatSigned, seasonLabel } from '../lib/format'
import type { PlayerMeeting } from '../types'

function CompareRow({ label, a, b, aText, bText }: { label: string; a: number | null; b: number | null; aText: string; bText: string }) {
  const aWins = a !== null && b !== null && a > b
  const bWins = a !== null && b !== null && b > a
  return (
    <div className="compare-row">
      <span className={`left ${aWins ? 'win' : ''}`.trim()}>{aText}</span>
      <span className="label">{label}</span>
      <span className={`right ${bWins ? 'win' : ''}`.trim()}>{bText}</span>
    </div>
  )
}

function MeetingTable({ rows, aName, bName }: { rows: PlayerMeeting[]; aName: string; bName: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Dato</th>
            <th>Kamp</th>
            <th>Hold</th>
            <th className="c">Vinder</th>
            <th className="r">Sæt</th>
            <th>Sætcifre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={`${m.matchId}-${i}`}>
              <td>
                <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                  {formatDate(m.date)}
                </Link>
              </td>
              <td className="primary">
                {m.matchType}
                {(m.aPartner || m.bPartner) && (
                  <div className="dim" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                    {m.aPartner && (
                      <>
                        {aName} m. <PlayerLink player={m.aPartner} />
                      </>
                    )}
                    {m.aPartner && m.bPartner && ' · '}
                    {m.bPartner && (
                      <>
                        {bName} m. <PlayerLink player={m.bPartner} />
                      </>
                    )}
                  </div>
                )}
              </td>
              <td className="dim">
                <TeamLink team={m.homeTeam} /> – <TeamLink team={m.awayTeam} />
              </td>
              <td className="c">
                <strong className={m.aWon ? 'result-W' : 'result-L'}>{m.aWon ? aName : bName}</strong>
              </td>
              <td className="r">
                {m.aSets}–{m.bSets}
              </td>
              <td className="dim">{m.walkover ? 'Walkover' : m.setScores || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlayerComparePage() {
  const [params, setParams] = useSearchParams()
  const a = params.get('a')
  const b = params.get('b')
  const { season, setSeason } = useSeasonParam('all')
  const { data, error, isLoading } = usePlayerComparison(a, b, season)

  const setSide = (key: 'a' | 'b', slug: string) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      copy.set(key, slug)
      return copy
    })
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Spiller mod spiller</div>
          <h1>Sammenlign to spillere</h1>
          <p className="page-sub">Nøgletal side om side, styrker pr. disciplin og alle indbyrdes kampe.</p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            Spiller A
          </div>
          <SearchBox mode="pick" restrict="player" placeholder="Vælg spiller A" defaultValue={data?.a.player.name ?? ''} onPick={(o) => setSide('a', o.entity.slug)} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            Spiller B
          </div>
          <SearchBox mode="pick" restrict="player" placeholder="Vælg spiller B" defaultValue={data?.b.player.name ?? ''} onPick={(o) => setSide('b', o.entity.slug)} />
        </div>
      </div>

      {!a || !b ? (
        <EmptyState>Vælg to spillere for at se sammenligningen.</EmptyState>
      ) : a === b ? (
        <EmptyState>Vælg to forskellige spillere.</EmptyState>
      ) : error ? (
        <ErrorState error={error} />
      ) : isLoading || !data ? (
        <PageSkeleton />
      ) : (
        <>
          <section className="hero-card">
            <div className="versus">
              <div className="versus-side">
                <h2>
                  <PlayerLink player={data.a.player} className="link" />
                </h2>
                <span className="text-2">
                  {data.a.currentTeam ? <TeamLink team={data.a.currentTeam} /> : 'Ukendt hold'} · {data.a.summary.wins}–{data.a.summary.losses}
                </span>
                <FormPills results={data.a.form} />
              </div>
              <div className="versus-score num">
                <span style={{ color: data.meetings.aWins > data.meetings.bWins ? 'var(--accent)' : undefined }}>{data.meetings.aWins}</span>
                <span className="muted"> – </span>
                <span style={{ color: data.meetings.bWins > data.meetings.aWins ? 'var(--accent)' : undefined }}>{data.meetings.bWins}</span>
                <small>
                  {data.meetings.played} indbyrdes {data.meetings.played === 1 ? 'kamp' : 'kampe'}
                </small>
              </div>
              <div className="versus-side right">
                <h2>
                  <PlayerLink player={data.b.player} className="link" />
                </h2>
                <span className="text-2">
                  {data.b.currentTeam ? <TeamLink team={data.b.currentTeam} /> : 'Ukendt hold'} · {data.b.summary.wins}–{data.b.summary.losses}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <FormPills results={data.b.form} />
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Nøgletal" subtitle={`${seasonLabel(season)} · alle kampe`}>
                <CompareRow label="Kampe" a={data.a.summary.matches} b={data.b.summary.matches} aText={String(data.a.summary.matches)} bText={String(data.b.summary.matches)} />
                <CompareRow label="Sejrsprocent" a={data.a.summary.winPct} b={data.b.summary.winPct} aText={formatPct(data.a.summary.winPct)} bText={formatPct(data.b.summary.winPct)} />
                <CompareRow label="Sæt" a={data.a.summary.setWinPct} b={data.b.summary.setWinPct} aText={formatPct(data.a.summary.setWinPct)} bText={formatPct(data.b.summary.setWinPct)} />
                <CompareRow label="Point" a={data.a.summary.pointWinPct} b={data.b.summary.pointWinPct} aText={formatPct(data.a.summary.pointWinPct)} bText={formatPct(data.b.summary.pointWinPct)} />
                <CompareRow
                  label="Point pr. kamp"
                  a={data.a.summary.avgPointMargin}
                  b={data.b.summary.avgPointMargin}
                  aText={formatSigned(data.a.summary.avgPointMargin)}
                  bText={formatSigned(data.b.summary.avgPointMargin)}
                />
                <CompareRow
                  label="3-sæts kampe"
                  a={data.a.summary.threeSetWinPct}
                  b={data.b.summary.threeSetWinPct}
                  aText={`${formatPct(data.a.summary.threeSetWinPct)} (${data.a.summary.threeSetWins}/${data.a.summary.threeSetMatches})`}
                  bText={`${formatPct(data.b.summary.threeSetWinPct)} (${data.b.summary.threeSetWins}/${data.b.summary.threeSetMatches})`}
                />
              </Card>

              <Card title="Styrke pr. disciplin" subtitle="Sejrsprocent mod alle modstandere. Den stærkeste side er fremhævet.">
                <ButterflyBars
                  names={[data.a.player.name, data.b.player.name]}
                  rows={mergeDisciplines(data.a.byDiscipline, data.b.byDiscipline).map((row) => ({
                    key: row.code,
                    label: row.code,
                    sub: disciplineName(row.code),
                    a: row.a ? { wins: row.a.wins, losses: row.a.losses, winPct: row.a.winPct } : null,
                    b: row.b ? { wins: row.b.wins, losses: row.b.losses, winPct: row.b.winPct } : null,
                  }))}
                />
                {data.meetings.played > 0 && (
                  <>
                    <div className="divider" style={{ margin: '0.9rem 0' }} />
                    <h3 style={{ marginBottom: '0.5rem' }}>Indbyrdes pr. disciplin</h3>
                    <ButterflyBars
                      names={[data.a.player.name, data.b.player.name]}
                      rows={meetingsByDiscipline(data.meetings.matches).map((row) => ({
                        key: row.code,
                        label: row.code,
                        sub: `${row.played} ${row.played === 1 ? 'kamp' : 'kampe'}`,
                        a: { wins: row.aWins, losses: row.played - row.aWins, winPct: (row.aWins / row.played) * 100 },
                        b: { wins: row.played - row.aWins, losses: row.aWins, winPct: ((row.played - row.aWins) / row.played) * 100 },
                      }))}
                      recordLabel={(side) => (side ? `${side.wins} ${side.wins === 1 ? 'sejr' : 'sejre'}` : '–')}
                    />
                  </>
                )}
              </Card>

              <Card title="Indbyrdes kampe" subtitle="Kampe hvor de to spillere stod på hver sin side af nettet">
                {data.meetings.matches.length === 0 ? (
                  <EmptyState>Spillerne har ikke mødt hinanden i {seasonLabel(season).toLowerCase()}.</EmptyState>
                ) : (
                  <MeetingTable rows={data.meetings.matches} aName={data.a.player.name} bName={data.b.player.name} />
                )}
              </Card>
            </div>

            <div className="stack">
              <Card title="Som makkere" subtitle="Doublekampe spillet sammen">
                {data.together.played === 0 ? (
                  <EmptyState>Har ikke spillet sammen.</EmptyState>
                ) : (
                  <>
                    <div className="stat-grid" style={{ marginBottom: '0.9rem' }}>
                      <div className="stat">
                        <div className="stat-label">Kampe sammen</div>
                        <div className="stat-value num">{data.together.played}</div>
                        <div className="stat-sub">
                          {data.together.wins}–{data.together.played - data.together.wins}
                        </div>
                      </div>
                      <div className="stat">
                        <div className="stat-label">Sejrsprocent</div>
                        <div className="stat-value num accent">{formatPct((data.together.wins / data.together.played) * 100)}</div>
                      </div>
                    </div>
                    <div className="list">
                      {data.together.matches.slice(0, 10).map((m, i) => (
                        <div className="list-row" key={`${m.matchId}-${i}`}>
                          <span className="name">
                            <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                              {formatDate(m.date)}
                            </Link>{' '}
                            <span className="dim">{m.matchType}</span>
                          </span>
                          <span className="meta">
                            mod {m.aHome ? m.awayTeam.name : m.homeTeam.name}
                          </span>
                          <strong className={m.aWon ? 'result-W' : 'result-L'}>{m.aWon ? 'V' : 'T'}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function meetingsByDiscipline(matches: PlayerMeeting[]) {
  const order = ['HS', 'DS', 'HD', 'DD', 'MD', 'S', 'D']
  const map = new Map<string, { code: string; played: number; aWins: number }>()
  for (const m of matches) {
    const row = map.get(m.code) ?? { code: m.code, played: 0, aWins: 0 }
    row.played += 1
    if (m.aWon) row.aWins += 1
    map.set(m.code, row)
  }
  return [...map.values()].sort((x, y) => order.indexOf(x.code) - order.indexOf(y.code))
}

function mergeDisciplines(
  a: { code: string; winPct: number | null; wins: number; losses: number }[],
  b: { code: string; winPct: number | null; wins: number; losses: number }[],
) {
  const order = ['HS', 'DS', 'HD', 'DD', 'MD', 'S', 'D']
  const codes = [...new Set([...a.map((d) => d.code), ...b.map((d) => d.code)])].sort(
    (x, y) => order.indexOf(x) - order.indexOf(y),
  )
  return codes.map((code) => ({ code, a: a.find((d) => d.code === code), b: b.find((d) => d.code === code) }))
}
