import { Link, useSearchParams } from 'react-router-dom'

import { useTeamHeadToHead } from '../api'
import { ButterflyBars } from '../components/charts'
import { VersusPicker } from '../components/VersusPicker'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, TeamLink } from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { disciplineName, formatDate, formatPct, record, seasonLabel } from '../lib/format'

function CompareRow({
  label,
  a,
  b,
  higherIsBetter = true,
}: {
  label: string
  a: number | null
  b: number | null
  higherIsBetter?: boolean
}) {
  const aWins = a !== null && b !== null && (higherIsBetter ? a > b : a < b)
  const bWins = a !== null && b !== null && (higherIsBetter ? b > a : b < a)
  return (
    <div className="compare-row">
      <span className={`left ${aWins ? 'win' : ''}`.trim()}>{formatPct(a)}</span>
      <span className="label">{label}</span>
      <span className={`right ${bWins ? 'win' : ''}`.trim()}>{formatPct(b)}</span>
    </div>
  )
}

export function TeamH2HPage() {
  const [params, setParams] = useSearchParams()
  const a = params.get('a')
  const b = params.get('b')
  const { season, setSeason } = useSeasonParam('all')
  const { data, error, isLoading } = useTeamHeadToHead(a, b, season)

  const setSide = (key: 'a' | 'b', slug: string | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      if (slug === null) copy.delete(key)
      else copy.set(key, slug)
      return copy
    })
  }

  const swap = () => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      const first = copy.get('a')
      const second = copy.get('b')
      if (second) copy.set('a', second)
      else copy.delete('a')
      if (first) copy.set('b', first)
      else copy.delete('b')
      return copy
    })
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Hold mod hold</div>
          <h1>Sammenlign to hold</h1>
          <p className="page-sub">Indbyrdes kampe, styrker pr. kamptype og resultater mod fælles modstandere.</p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
        </div>
      </div>

      <VersusPicker
        kind="team"
        a={data?.a.team ?? null}
        b={data?.b.team ?? null}
        slugs={[a, b]}
        onPick={setSide}
        onSwap={swap}
      />

      {!a || !b ? (
        <EmptyState>Vælg to hold for at se sammenligningen.</EmptyState>
      ) : a === b ? (
        <EmptyState>Vælg to forskellige hold.</EmptyState>
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
                  <TeamLink team={data.a.team} className="link" />
                </h2>
                <span className="text-2">{record(data.a.summary.teamWins, data.a.summary.teamDraws, data.a.summary.teamLosses)} i {seasonLabel(season)}</span>
                <FormPills results={data.a.form} />
              </div>
              <div className="versus-score num">
                <span style={{ color: data.direct.aWins > data.direct.bWins ? 'var(--accent)' : undefined }}>{data.direct.aWins}</span>
                <span className="muted"> – </span>
                <span style={{ color: data.direct.bWins > data.direct.aWins ? 'var(--accent)' : undefined }}>{data.direct.bWins}</span>
                <small>
                  {data.direct.played} indbyrdes {data.direct.played === 1 ? 'kamp' : 'kampe'}
                  {data.direct.draws ? ` · ${data.direct.draws} uafgjort` : ''}
                </small>
              </div>
              <div className="versus-side right">
                <h2>
                  <TeamLink team={data.b.team} className="link" />
                </h2>
                <span className="text-2">{record(data.b.summary.teamWins, data.b.summary.teamDraws, data.b.summary.teamLosses)} i {seasonLabel(season)}</span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <FormPills results={data.b.form} />
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-main">
            <div className="stack">
              <Card title="Nøgletal" subtitle={`Hele ${seasonLabel(season).toLowerCase()} mod alle modstandere`}>
                <CompareRow label="Holdsejre" a={data.a.summary.teamWinPct} b={data.b.summary.teamWinPct} />
                <CompareRow label="Enkeltkampe" a={data.a.summary.winPct} b={data.b.summary.winPct} />
                <CompareRow label="Sæt" a={data.a.summary.setWinPct} b={data.b.summary.setWinPct} />
                <CompareRow label="Point" a={data.a.summary.pointWinPct} b={data.b.summary.pointWinPct} />
                <CompareRow label="3-sæts kampe" a={data.a.summary.threeSetWinPct} b={data.b.summary.threeSetWinPct} />
              </Card>

              <Card title="Styrke pr. kamptype" subtitle={`Sejrsprocent i enkeltkampe mod alle modstandere i ${seasonLabel(season).toLowerCase()}. Den stærkeste side er fremhævet.`}>
                <ButterflyBars
                  names={[data.a.team.name, data.b.team.name]}
                  rows={mergeMatchTypes(data).map((row) => ({
                    key: row.matchType,
                    label: row.matchType,
                    sub: disciplineName(row.code),
                    a: row.a ? { wins: row.a.wins, losses: row.a.losses, winPct: row.a.winPct } : null,
                    b: row.b ? { wins: row.b.wins, losses: row.b.losses, winPct: row.b.winPct } : null,
                  }))}
                />
              </Card>

              <Card title="Indbyrdes kampe" subtitle={data.direct.played ? `${data.direct.aDisciplines}–${data.direct.bDisciplines} i enkeltkampe samlet` : undefined}>
                {data.direct.matches.length === 0 ? (
                  <EmptyState>Holdene har ikke mødt hinanden i {seasonLabel(season).toLowerCase()}.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Dato</th>
                          <th>Kamp</th>
                          <th className="c">Resultat</th>
                          <th>Vinder</th>
                          <th>Række</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.direct.matches.map((m) => {
                          const home = m.aHome ? data.a.team : data.b.team
                          const away = m.aHome ? data.b.team : data.a.team
                          const homeWon = m.aHome ? m.aDisciplines : m.bDisciplines
                          const awayWon = m.aHome ? m.bDisciplines : m.aDisciplines
                          const winner = m.result === 'D' ? null : m.result === 'W' ? data.a.team : data.b.team
                          return (
                            <tr key={m.matchId}>
                              <td>
                                <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                                  {formatDate(m.date)}
                                </Link>
                              </td>
                              <td className="primary">
                                <TeamLink team={home} /> <span className="dim">–</span> <TeamLink team={away} />
                              </td>
                              <td className="c">
                                <strong>
                                  {homeWon}–{awayWon}
                                </strong>
                              </td>
                              <td className={winner ? 'primary' : 'dim'}>{winner ? winner.name : 'Uafgjort'}</td>
                              <td className="dim">
                                {m.division} · {m.groupName}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.direct.byMatchType.length > 0 && (
                  <>
                    <div className="divider" style={{ margin: '0.9rem 0' }} />
                    <h3 style={{ marginBottom: '0.5rem' }}>Indbyrdes pr. kamptype</h3>
                    <ButterflyBars
                      names={[data.a.team.name, data.b.team.name]}
                      rows={data.direct.byMatchType.map((t) => ({
                        key: t.matchType,
                        label: t.matchType,
                        sub: `${t.played} ${t.played === 1 ? 'kamp' : 'kampe'}`,
                        a: { wins: t.aWins, losses: t.bWins, winPct: t.played ? (t.aWins / t.played) * 100 : null },
                        b: { wins: t.bWins, losses: t.aWins, winPct: t.played ? (t.bWins / t.played) * 100 : null },
                      }))}
                      recordLabel={(side) => (side ? `${side.wins} ${side.wins === 1 ? 'sejr' : 'sejre'}` : '–')}
                    />
                  </>
                )}
              </Card>
            </div>

            <div className="stack">
              <Card title="Fælles modstandere" subtitle="Holdkampe mod hold begge har mødt">
                {data.commonOpponents.length === 0 ? (
                  <EmptyState>Ingen fælles modstandere.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th>Hold</th>
                          <th className="r wrap">{data.a.team.name}</th>
                          <th className="r wrap">{data.b.team.name}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.commonOpponents.slice(0, 16).map((c) => (
                          <tr key={c.team.slug}>
                            <td className="primary">
                              <TeamLink team={c.team} />
                            </td>
                            <td className="r">
                              {c.a.wins}–{c.a.played - c.a.wins}
                              <span className="dim"> ({formatPct(c.a.winPct)})</span>
                            </td>
                            <td className="r">
                              {c.b.wins}–{c.b.played - c.b.wins}
                              <span className="dim"> ({formatPct(c.b.winPct)})</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="note" style={{ marginTop: '0.6rem' }}>
                  Vundne–tabte holdkampe mod hver fælles modstander.
                </p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function mergeMatchTypes(data: NonNullable<ReturnType<typeof useTeamHeadToHead>['data']>) {
  const keys = new Map<string, { matchType: string; number: number; order: number }>()
  const order = ['HS', 'DS', 'HD', 'DD', 'MD', 'S', 'D']
  for (const row of [...data.a.byMatchType, ...data.b.byMatchType]) {
    if (!keys.has(row.matchType)) {
      keys.set(row.matchType, { matchType: row.matchType, number: row.number ?? 0, order: order.indexOf(row.code) })
    }
  }
  return [...keys.values()]
    .sort((x, y) => x.number - y.number || x.order - y.order)
    .map((k) => ({
      matchType: k.matchType,
      code: order[k.order] ?? '',
      a: data.a.byMatchType.find((r) => r.matchType === k.matchType),
      b: data.b.byMatchType.find((r) => r.matchType === k.matchType),
    }))
}
