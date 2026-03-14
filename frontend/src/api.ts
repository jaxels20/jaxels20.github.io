import type { ReportResponse, SearchResult, SeasonsResponse } from './types'

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const API_BASE = configuredApiBase ? configuredApiBase.replace(/\/$/, '') : '/api'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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

export function fetchTeamSuggestions(params: { query: string; seasonId: number | null; limit?: number }) {
  const searchParams = new URLSearchParams({
    q: params.query,
    limit: String(params.limit ?? 10),
  })

  if (params.seasonId !== null) {
    searchParams.set('season_id', String(params.seasonId))
  }

  return fetchJson<{ results: SearchResult[] }>(`${API_BASE}/search/teams?${searchParams.toString()}`)
}

export function fetchPlayerSuggestions(params: { query: string; seasonId: number | null; limit?: number }) {
  const searchParams = new URLSearchParams({
    q: params.query,
    limit: String(params.limit ?? 10),
  })

  if (params.seasonId !== null) {
    searchParams.set('season_id', String(params.seasonId))
  }

  return fetchJson<{ results: SearchResult[] }>(`${API_BASE}/search/players?${searchParams.toString()}`)
}

export function fetchTeamReport(params: { name: string; seasonId: number | null }) {
  return fetchJson<ReportResponse>(`${API_BASE}/reports/team`, {
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

export function fetchPlayerReport(params: { name: string; seasonId: number | null }) {
  return fetchJson<ReportResponse>(`${API_BASE}/reports/player`, {
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
