import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useClubs } from '../api'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, EmptyState, ErrorState, PageSkeleton } from '../components/ui'
import { usePageTitle } from '../hooks/usePageTitle'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { formatPct, record, seasonLabel } from '../lib/format'

export function ClubsPage() {
  const { season, setSeason, resolved } = useSeasonParam('latest')
  const { data, error, isLoading } = useClubs(season, resolved)
  const [filter, setFilter] = useState('')
  usePageTitle('Klubber')

  const clubs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (data?.clubs ?? []).filter((c) => !q || c.club.name.toLowerCase().includes(q))
  }, [data, filter])

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Klubber · {season === null ? 'Alle sæsoner' : seasonLabel(season)}</div>
          <h1>Alle klubber i holdturneringen</h1>
          <p className="page-sub">
            {season === null
              ? 'Hver klub med alle de hold, den har stillet i data, den bedste række klubben har været med i, og resultaterne på tværs af holdene og sæsonerne.'
              : 'Hver klub med sine hold, den bedste række klubben er med i, og resultaterne på tværs af holdene.'}{' '}
            Klik på en klub for hold, spillere og historik.
          </p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} onChange={(next) => setSeason(next)} />
          <input className="input" type="search" placeholder="Filtrer klubber…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer klubber" style={{ minWidth: 200 }} />
        </div>
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : isLoading || !data ? (
        <PageSkeleton />
      ) : clubs.length === 0 ? (
        <EmptyState>Ingen klubber matcher.</EmptyState>
      ) : (
        <Card title={`${clubs.length} klubber`} subtitle={season === null ? 'Sorteret efter den bedste række klubben har spillet i, derefter antal hold i alt.' : 'Sorteret efter bedste række, derefter antal hold.'}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klub</th>
                  <th className="r">Hold</th>
                  <th>Bedste række</th>
                  <th className="r hide-sm">Holdkampe</th>
                  <th className="hide-sm">V–U–T</th>
                  <th className="r">Vundet</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((c) => (
                  <tr key={c.club.slug}>
                    <td className="primary">
                      <Link className="link" to={`/klubber/${c.club.slug}`}>
                        {c.club.name}
                      </Link>
                    </td>
                    <td className="r num">{c.teams}</td>
                    <td className="dim">{c.topDivision ?? '–'}</td>
                    <td className="r num hide-sm">{c.played}</td>
                    <td className="num hide-sm">{record(c.wins, c.draws, c.losses)}</td>
                    <td className="r num">{formatPct(c.winPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
