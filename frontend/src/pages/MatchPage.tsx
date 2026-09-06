import { Link, useParams } from 'react-router-dom'

import { useMatch } from '../api'
import { Card, ErrorState, PageSkeleton, PlayerLink, TeamLink } from '../components/ui'
import { disciplineName, formatDate, seasonLabel } from '../lib/format'
import type { MatchPlayer } from '../types'
import { usePageTitle } from '../hooks/usePageTitle'

function Players({ players, won, align }: { players: MatchPlayer[]; won: boolean; align: 'left' | 'right' }) {
  return (
    <div className={`game-side ${align === 'right' ? 'right' : ''}`.trim()}>
      {players.length === 0 && <span className="lost">–</span>}
      {players.map((p) => (
        <span key={p.slug} className={won ? 'won' : 'lost'}>
          {p.placeholder ? <span className="dim">{p.name}</span> : <PlayerLink player={p} className={won ? 'link' : 'link'} />}
        </span>
      ))}
    </div>
  )
}

export function MatchPage() {
  const params = useParams()
  const season = params.season ? Number(params.season) : null
  const groupId = params.groupId ? Number(params.groupId) : null
  const matchId = params.matchId ? Number(params.matchId) : null
  const { data, error, isLoading } = useMatch(season, groupId, matchId)
  usePageTitle(data ? `${data.home.name} – ${data.away.name}` : null)

  if (error) return <ErrorState error={error} />
  if (isLoading || !data) return <PageSkeleton />

  const homeWon = data.homeDisciplines > data.awayDisciplines
  const awayWon = data.awayDisciplines > data.homeDisciplines

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="eyebrow">
        <Link to={`/ligaer/${data.seasonId}`}>Ligaer {seasonLabel(data.seasonId)}</Link> ·{' '}
        <Link to={`/ligaer/${data.seasonId}/${data.groupId}`}>
          {data.division} · {data.groupName}
        </Link>
        {data.round && ` · Runde ${data.round}`}
      </div>

      <section className="hero-card">
        <div className="versus">
          <div className="versus-side">
            <span className="muted">Hjemme</span>
            <h2>
              <TeamLink team={data.home} className="link" />
            </h2>
            {data.homePoints !== null && <span className="text-2">{data.homePoints} point</span>}
          </div>
          <div className="versus-score num">
            {data.played || data.games.length ? (
              <>
                <span style={{ color: homeWon ? 'var(--accent)' : undefined }}>{data.homeDisciplines}</span>
                <span className="muted"> – </span>
                <span style={{ color: awayWon ? 'var(--accent)' : undefined }}>{data.awayDisciplines}</span>
              </>
            ) : (
              <span className="muted">–</span>
            )}
            <small>{data.played ? 'Vundne kampe' : 'Ikke spillet'}</small>
          </div>
          <div className="versus-side right">
            <span className="muted">Ude</span>
            <h2>
              <TeamLink team={data.away} className="link" />
            </h2>
            {data.awayPoints !== null && <span className="text-2">{data.awayPoints} point</span>}
          </div>
        </div>
        <div className="hero-meta" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <span>{data.date ? formatDate(data.date) : data.scheduled}</span>
          {data.time && <span>kl. {data.time}</span>}
          {data.venue && <span>{data.venue}</span>}
          {data.walkover && <span className="chip">Walkover i kampen</span>}
          <Link className="link" to={`/hold-mod-hold?a=${data.home.slug}&b=${data.away.slug}`}>
            Hold mod hold →
          </Link>
        </div>
      </section>

      <Card title="Kampene" subtitle={data.games.length ? `${data.games.length} enkeltkampe` : 'Ingen enkeltkampe registreret endnu'}>
        {data.games.map((g) => {
          const home = g.winner === 'home'
          return (
            <div className="game-row" key={`${g.code}-${g.number}`}>
              <div className="game-type" title={disciplineName(g.code)}>
                {g.matchType}
              </div>
              <Players players={g.homePlayers} won={home} align="left" />
              <div className="game-score">
                <strong>
                  {g.homeSets}–{g.awaySets}
                </strong>
                <small>{g.walkover ? `Walkover${g.walkoverCode ? ` (${g.walkoverCode})` : ''}` : g.setScores ?? ''}</small>
              </div>
              <Players players={g.awayPlayers} won={!home} align="right" />
            </div>
          )
        })}
      </Card>
    </div>
  )
}
