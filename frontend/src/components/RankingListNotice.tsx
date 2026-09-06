import { formatDate } from '../lib/format'
import type { RankingListStatus } from '../types'

/**
 * States plainly which ranking list the points come from and which monthly list the
 * regulation applies today, since the two are not the same thing.
 */
export function RankingListNotice({ status, compact = false }: { status: RankingListStatus | null | undefined; compact?: boolean }) {
  if (!status) {
    return <div className="ranking-notice muted">Ranglistens dato kunne ikke hentes fra badmintonplayer.dk.</div>
  }
  const applicable = status.applicable
  const upcoming = status.upcoming
  return (
    <div className={`ranking-notice ${compact ? 'compact' : ''}`.trim()} role="note">
      <div>
        <span className="ranking-notice-label">Point fra</span>{' '}
        <strong>seneste rangliste på badmintonplayer.dk</strong>
        {status.latestUpdate && <>, opdateret {formatDate(status.latestUpdate)}</>}.
      </div>
      {applicable && (
        <div>
          <span className="ranking-notice-label">Gældende til holdsætning</span>{' '}
          <strong>{applicable.name}</strong>
          {applicable.published && <> (offentliggjort {formatDate(applicable.published)})</>}
          {applicable.validTo ? <>, gyldig til og med {formatDate(applicable.validTo)}</> : null}.
          {upcoming && (
            <>
              {' '}
              Fra {formatDate(upcoming.validFrom)} gælder {upcoming.name}
              {upcoming.published && <> ({formatDate(upcoming.published)})</>}.
            </>
          )}
        </div>
      )}
      {!compact && (
        <div className="muted">
          Reglementet (§ 38 stk. 1 a) bruger månedens første offentliggjorte liste fra den 10. i måneden. Den seneste liste
          opdateres løbende og kan derfor afvige lidt fra den gældende månedsliste.
        </div>
      )}
    </div>
  )
}
