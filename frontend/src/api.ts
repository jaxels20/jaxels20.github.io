import type { ReportMode, ReportResponse, SearchResult, SeasonsResponse } from './types'

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE = configuredApiBase ? configuredApiBase.replace(/\/$/, '') : '/api'

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const maybeText = await response.text()
    try {
      const parsed = JSON.parse(maybeText) as { detail?: string }
      throw new Error(parsed.detail || `Request failed (${response.status})`)
    } catch {
      throw new Error(maybeText || `Request failed (${response.status})`)
    }
  }
  return (await response.json()) as T
}

export function fetchSeasons() {
  return fetchJson<SeasonsResponse>(`${API_BASE}/seasons`)
}

export function fetchSuggestions(params: {
  mode: ReportMode
  query: string
  seasonId: number | null
  limit?: number
}) {
  const searchParams = new URLSearchParams({
    q: params.query,
    limit: String(params.limit ?? 12),
  })

  if (params.seasonId !== null) {
    searchParams.set('season_id', String(params.seasonId))
  }

  return fetchJson<{ results: SearchResult[] }>(
    `${API_BASE}/search/${params.mode === 'player' ? 'players' : 'teams'}?${searchParams.toString()}`
  )
}

export function fetchReport(params: { mode: ReportMode; name: string; seasonId: number | null }) {
  return fetchJson<ReportResponse>(`${API_BASE}/reports/${params.mode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name,
      season_id: params.seasonId,
    }),
  })
}

export function fetchTeamHeadToHeadReport(params: {
  teamA: string
  teamB: string
  seasonId: number | null
}) {
  return fetchJson<ReportResponse>(`${API_BASE}/reports/team-h2h`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      team_a: params.teamA,
      team_b: params.teamB,
      season_id: params.seasonId,
    }),
  })
}
