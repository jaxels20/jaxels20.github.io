import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { useLeagues, useSeasons } from '../api'
import { SeasonPicker } from '../components/SeasonPicker'
import { ErrorState, Skeleton } from '../components/ui'
import { formatShortDate, seasonLabel } from '../lib/format'

export function LeaguesPage() {
  const params = useParams()
  const navigate = useNavigate()
  const { data: seasonsData } = useSeasons()
  const latest = seasonsData?.seasons[0]?.seasonId ?? null
  const season = params.season ? Number(params.season) : null
  const { data, error, isLoading } = useLeagues(season)

  if (season === null) {
    if (latest === null) return <Skeleton height={200} />
    return <Navigate to={`/ligaer/${latest}`} replace />
  }

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ligaer</div>
          <h1>Stillinger og resultater {seasonLabel(season)}</h1>
          <p className="page-sub">Vælg en pulje for at se stillingen, alle runder og hver enkelt holdkamp.</p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} allowAll={false} onChange={(next) => next !== null && navigate(`/ligaer/${next}`)} />
        </div>
      </div>

      {error && <ErrorState error={error} />}
      {isLoading && (
        <div className="stack">
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      )}
      {data &&
        data.divisions.map((division) => (
          <section className="division-block" key={division.name}>
            <h2>{division.name}</h2>
            <div className="division-grid">
              {division.groups.map((group) => (
                <Link key={group.groupId} className="league-card" to={`/ligaer/${season}/${group.groupId}`}>
                  <strong>{group.name}</strong>
                  <span>
                    {group.teams} hold · {group.played}/{group.matches} kampe
                    {group.firstDate && ` · ${formatShortDate(group.firstDate)} – ${formatShortDate(group.lastDate)}`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}
