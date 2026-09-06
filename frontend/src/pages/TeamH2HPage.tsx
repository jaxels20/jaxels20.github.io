import { Link, useSearchParams } from 'react-router-dom'

import { useTeamHeadToHead } from '../api'
import { PairedBars } from '../components/charts'
import { SearchBox } from '../components/SearchBox'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, FormPills, PageSkeleton, ResultBadge, TeamLink } from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { formatDate, formatPct, record, seasonLabel } from '../lib/format'

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
          <div className="eyebrow">Hold mod hold</div>
          <h1>Sammenlign to hold</h1>
          <p className="page-sub">Indbyrdes kampe, styrker pr. kamptype og resultater mod fælles modstandere.</p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            Hold A
          </div>
          <SearchBox mode="pick" restrict="team" placeholder="Vælg hold A" defaultValue={data?.a.team.name ?? ''} onPick={(o) => setSide('a', o.entity.slug)} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>
            Hold B
          </div>
          <SearchBox mode="pick" restrict="team" placeholder="Vælg hold B" defaultValue={data?.b.team.name ?? ''} onPick={(o) => setSide('b', o.entity.slug)} />
        </div>
      </div>

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

              <Card title="Sejrsprocent pr. kamptype" subtitle="Hvor hvert hold er stærkest">
                <PairedBars
                  names={[data.a.team.name, data.b.team.name]}
                  rows={mergeMatchTypes(data).map((row) => ({
                    key: row.matchType,
                    label: row.matchType,
                    a: row.a?.winPct ?? null,
                    b: row.b?.winPct ?? null,
                    aLabel: row.a ? `${formatPct(row.a.winPct)} (${row.a.wins}–${row.a.losses})` : '–',
                    bLabel: row.b ? `${formatPct(row.b.winPct)} (${row.b.wins}–${row.b.losses})` : '–',
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
                          <th>Række</th>
                          <th className="c">Hjemme</th>
                          <th className="c">Res. (A)</th>
                          <th className="r">Kampe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.direct.matches.map((m) => (
                          <tr key={m.matchId}>
                            <td>
                              <Link className="link" to={`/kampe/${m.seasonId}/${m.groupId}/${m.matchId}`}>
                                {formatDate(m.date)}
                              </Link>
                            </td>
                            <td className="dim">
                              {m.division} · {m.groupName}
                            </td>
                            <td className="c dim">{m.aHome ? data.a.team.name : data.b.team.name}</td>
                            <td className="c">
                              <strong>
                                <ResultBadge result={m.result} />
                              </strong>
                            </td>
                            <td className="r">
                              {m.aDisciplines}–{m.bDisciplines}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.direct.byMatchType.length > 0 && (
                  <>
                    <div className="divider" style={{ margin: '0.9rem 0' }} />
                    <h3 style={{ marginBottom: '0.5rem' }}>Indbyrdes pr. kamptype</h3>
                    <PairedBars
                      names={[data.a.team.name, data.b.team.name]}
                      rows={data.direct.byMatchType.map((t) => ({
                        key: t.matchType,
                        label: t.matchType,
                        a: t.played ? (t.aWins / t.played) * 100 : null,
                        b: t.played ? (t.bWins / t.played) * 100 : null,
                        aLabel: `${t.aWins} sejre`,
                        bLabel: `${t.bWins} sejre`,
                      }))}
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
                          <th className="r">A</th>
                          <th className="r">B</th>
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
                  A = {data.a.team.name}, B = {data.b.team.name}. Vundne–tabte holdkampe.
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
      a: data.a.byMatchType.find((r) => r.matchType === k.matchType),
      b: data.b.byMatchType.find((r) => r.matchType === k.matchType),
    }))
}
