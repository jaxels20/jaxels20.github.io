import { Link } from 'react-router-dom'

import { useLeaderboards, useLeagues, useSeasons } from '../api'
import { SearchBox } from '../components/SearchBox'
import { Card, PlayerLink, Skeleton, TeamLink } from '../components/ui'
import { formatPct, seasonLabel } from '../lib/format'
import { usePageTitle } from '../hooks/usePageTitle'

export function HomePage() {
  const { data: seasonsData } = useSeasons()
  const latest = seasonsData?.seasons[0]?.seasonId ?? null
  const { data: leagues } = useLeagues(latest)
  const { data: boards } = useLeaderboards(latest, null, null)
  usePageTitle('Statistik for dansk holdbadminton')

  const mainDivisions = (leagues?.divisions ?? []).filter((d) => d.tier <= 5)

  return (
    <div className="stack" style={{ gap: '2rem' }}>
      <section className="home-hero">
        <div className="eyebrow">Dansk holdbadminton · {latest ? seasonLabel(latest) : ''}</div>
        <h1>Statistik for hvert hold og hver spiller i holdturneringen</h1>
        <p>
          Søg et hold eller en spiller og få sejrsprocenter, form, makkere, modstandere og kamphistorik fra
          Badmintonligaen til Danmarksserien.
        </p>
        <div className="home-search">
          <SearchBox size="hero" autoFocus placeholder="Søg fx “Vendsyssel” eller “Anders Antonsen”" />
        </div>
        <div className="home-quick">
          <span>Genveje:</span>
          <Link to={`/ligaer/${latest ?? ''}`}>Stillinger &amp; resultater</Link>
          <Link to="/klubber">Klubber</Link>
          <Link to="/toplister">Toplister</Link>
          <Link to="/hold-mod-hold">Hold mod hold</Link>
          <Link to="/spiller-mod-spiller">Spiller mod spiller</Link>
        </div>
      </section>

      <section>
        <div className="page-head" style={{ marginBottom: '0.9rem' }}>
          <div>
            <div className="eyebrow">Ligaer {latest ? seasonLabel(latest) : ''}</div>
            <h2 style={{ fontSize: '1.4rem' }}>Stillinger og resultater</h2>
          </div>
          <Link className="btn btn-sm" to={`/ligaer/${latest ?? ''}`}>
            Alle puljer
          </Link>
        </div>
        {!leagues ? (
          <div className="grid grid-3">
            <Skeleton height={90} />
            <Skeleton height={90} />
            <Skeleton height={90} />
          </div>
        ) : (
          <div className="stack">
            {mainDivisions.map((division) => (
              <div className="division-block" key={division.name}>
                <h2>{division.name}</h2>
                <div className="division-grid">
                  {division.groups.map((group) => (
                    <Link key={group.groupId} className="league-card" to={`/ligaer/${latest}/${group.groupId}`}>
                      <strong>{group.name}</strong>
                      <span>
                        {group.teams} hold · {group.played}/{group.matches} kampe spillet
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-2">
        <Card
          title="Højeste sejrsprocent"
          subtitle={`${latest ? seasonLabel(latest) : ''}${boards ? ` · mindst ${boards.minMatches} kampe` : ''}`}
          actions={
            <Link className="btn btn-sm" to="/toplister">
              Alle toplister
            </Link>
          }
        >
          {!boards ? (
            <Skeleton height={220} />
          ) : (
            <div className="list">
              {boards.lists.winPct.slice(0, 6).map((entry, i) => (
                <div className="list-row" key={entry.player.slug}>
                  <span className={`rank ${i === 0 ? 'rank-1' : ''}`.trim()}>{i + 1}</span>
                  <span className="name">
                    <PlayerLink player={entry.player} />
                  </span>
                  <span className="meta">
                    <TeamLink team={entry.team} className="link" /> · {entry.wins}–{entry.losses}
                  </span>
                  <strong className="num">{formatPct(entry.value)}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Flest sejre" subtitle={`${latest ? seasonLabel(latest) : ''} · alle divisioner`}>
          {!boards ? (
            <Skeleton height={220} />
          ) : (
            <div className="list">
              {boards.lists.mostWins.slice(0, 6).map((entry, i) => (
                <div className="list-row" key={entry.player.slug}>
                  <span className={`rank ${i === 0 ? 'rank-1' : ''}`.trim()}>{i + 1}</span>
                  <span className="name">
                    <PlayerLink player={entry.player} />
                  </span>
                  <span className="meta">
                    <TeamLink team={entry.team} className="link" /> · {formatPct(entry.winPct)}
                  </span>
                  <strong className="num">{entry.wins}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="grid grid-3">
        <Card title="Datagrundlag">
          <p className="text-2">
            Alle kampe fra Badminton Danmarks holdturnering: Badmintonligaen, 1.–3. division og Danmarksserien, sæson
            2020/21 til i dag. Hver enkelt kamp med sæt og point.
          </p>
        </Card>
        <Card title="Sådan læses tallene">
          <p className="text-2">
            Sejrsprocenter er baseret på spillede kampe. Walkovers tælles med i kampantal, men ikke i sæt- og
            pointstatistik. Toplister kræver et minimum antal kampe.
          </p>
        </Card>
        <Card title="Del en side">
          <p className="text-2">
            Alle hold-, spiller- og puljesider har deres egen adresse og kan deles direkte. Sæsonvalget gemmes i
            linket.
          </p>
        </Card>
      </section>
    </div>
  )
}
