import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useSeasons } from '../api'

/**
 * Season selection stored in the URL (`?saeson=2025`) so pages stay shareable.
 * `'all'` means no filter. When absent, `fallback` decides the default.
 */
export function useSeasonParam(fallback: 'latest' | 'all' = 'latest') {
  const [params, setParams] = useSearchParams()
  const { data } = useSeasons()
  const latest = data?.seasons[0]?.seasonId ?? null
  const raw = params.get('saeson')

  let season: number | null
  let resolved = true
  if (raw === 'alle') {
    season = null
  } else if (raw && /^\d{4}$/.test(raw)) {
    season = Number(raw)
  } else if (fallback === 'all') {
    season = null
  } else {
    season = latest
    resolved = latest !== null
  }

  const setSeason = useCallback(
    (next: number | null, replace = false) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev)
          copy.set('saeson', next === null ? 'alle' : String(next))
          return copy
        },
        { replace },
      )
    },
    [setParams],
  )

  return { season, setSeason, latest, resolved, explicit: raw !== null }
}
