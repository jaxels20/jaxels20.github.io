import { useSearchParams } from 'react-router-dom'

import { useLeaderboards } from '../api'
import { SeasonPicker } from '../components/SeasonPicker'
import { Card, ErrorState, PlayerLink, Skeleton, TeamLink } from '../components/ui'
import { useSeasonParam } from '../hooks/useSeasonParam'
import { formatPct, seasonLabel } from '../lib/format'
import type { LeaderboardEntry, LeaderboardPair } from '../types'

const MIN_OPTIONS = [5, 8, 12, 20]

function EntryList({ entries, format }: { entries: LeaderboardEntry[]; format: (e: LeaderboardEntry) => string }) {
  if (!entries.length) return <div className="empty">Ingen spillere opfylder kravet.</div>
  return (
    <div className="list">
      {entries.map((entry, i) => (
        <div className="list-row" key={entry.player.slug}>
          <span className={`rank ${i === 0 ? 'rank-1' : ''}`.trim()}>{i + 1}</span>
          <span className="name">
            <PlayerLink player={entry.player} />
          </span>
          <span className="meta">
            <TeamLink team={entry.team} /> · {entry.wins}–{entry.losses}
          </span>
          <strong className="num">{format(entry)}</strong>
        </div>
      ))}
    </div>
  )
}

function PairList({ entries }: { entries: LeaderboardPair[] }) {
  if (!entries.length) return <div className="empty">Ingen par opfylder kravet.</div>
  return (
    <div className="list">
      {entries.map((entry, i) => (
        <div className="list-row" key={`${entry.players[0].slug}-${entry.players[1].slug}`}>
          <span className={`rank ${i === 0 ? 'rank-1' : ''}`.trim()}>{i + 1}</span>
          <span className="name">
            <PlayerLink player={entry.players[0]} /> / <PlayerLink player={entry.players[1]} />
          </span>
          <span className="meta">
            <TeamLink team={entry.team} /> · {entry.disciplines.join('/')} · {entry.wins}–{entry.losses}
          </span>
          <strong className="num">{formatPct(entry.winPct)}</strong>
        </div>
      ))}
    </div>
  )
}

export function LeaderboardsPage() {
  const { season, setSeason, resolved } = useSeasonParam('latest')
  const [params, setParams] = useSearchParams()
  const division = params.get('raekke')
  const minMatches = Number(params.get('min') ?? 8) || 8
  const { data, error, isLoading, isFetching } = useLeaderboards(resolved ? season : null, division, minMatches)

  const update = (key: string, value: string | null) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      if (value === null) copy.delete(key)
      else copy.set(key, value)
      return copy
    })
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Toplister</div>
          <h1>Sæsonens bedste spillere {season ? seasonLabel(season) : ''}</h1>
          <p className="page-sub">
            Walkovers tæller ikke med. Mindst {minMatches} spillede kampe kræves for procentlisterne.
          </p>
        </div>
        <div className="page-tools">
          <SeasonPicker value={season} allowAll={false} onChange={(next) => next !== null && setSeason(next)} />
          <label>
            <span className="sr-only">Minimum antal kampe</span>
            <select className="select" value={minMatches} onChange={(e) => update('min', e.target.value)}>
              {MIN_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Min. {n} kampe
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {data && (
        <div className="pill-row" role="group" aria-label="Række">
          <button type="button" className={`pill-toggle ${division === null ? 'active' : ''}`.trim()} onClick={() => update('raekke', null)}>
            Alle rækker
          </button>
          {data.divisions.map((name) => (
            <button
              key={name}
              type="button"
              className={`pill-toggle ${division === name ? 'active' : ''}`.trim()}
              onClick={() => update('raekke', name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorState error={error} />}
      {isLoading && (
        <div className="grid grid-2">
          <Skeleton height={300} />
          <Skeleton height={300} />
          <Skeleton height={300} />
          <Skeleton height={300} />
        </div>
      )}
      {data && (
        <div className="grid grid-2" style={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <Card title="Højeste sejrsprocent" subtitle={`Alle discipliner · min. ${data.minMatches} kampe`}>
            <EntryList entries={data.lists.winPct} format={(e) => formatPct(e.value)} />
          </Card>
          <Card title="Flest sejre" subtitle="Alle discipliner">
            <EntryList entries={data.lists.mostWins} format={(e) => `${e.wins}`} />
          </Card>
          <Card title="Bedst i single" subtitle={`HS/DS · min. ${data.minMatches} singlekampe`}>
            <EntryList entries={data.lists.singles} format={(e) => formatPct(e.value)} />
          </Card>
          <Card title="Bedst i double" subtitle={`HD/DD/MD · min. ${data.minMatches} doublekampe`}>
            <EntryList entries={data.lists.doubles} format={(e) => formatPct(e.value)} />
          </Card>
          <Card title="Bedste doublepar" subtitle="Par der har spillet flest kampe sammen, sorteret på sejrsprocent">
            <PairList entries={data.lists.pairs} />
          </Card>
          <Card title="Stærkest i tredje sæt" subtitle="Sejrsprocent i kampe der gik i tre sæt">
            <EntryList entries={data.lists.threeSet} format={(e) => `${formatPct(e.value)} (${e.threeSetWins}/${e.threeSetMatches})`} />
          </Card>
          <Card title="Størst pointmargin" subtitle="Gennemsnitlig pointforskel pr. kamp">
            <EntryList entries={data.lists.pointMargin} format={(e) => `+${e.value}`} />
          </Card>
          <Card title="Flest kampe" subtitle="Mest brugte spillere">
            <EntryList entries={data.lists.mostMatches} format={(e) => `${e.matches}`} />
          </Card>
        </div>
      )}
    </div>
  )
}
