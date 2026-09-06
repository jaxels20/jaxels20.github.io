import { useQuery } from '@tanstack/react-query'

import type {
  GroupDetail,
  Leaderboards,
  LeaguesResponse,
  MatchDetail,
  PlayerComparison,
  PlayerProfile,
  SearchResponse,
  SeasonsResponse,
  TeamHeadToHead,
  TeamProfile,
} from './types'

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const LEGACY_BASE = configuredApiBase ? configuredApiBase.replace(/\/$/, '') : '/api'
export const API_BASE = `${LEGACY_BASE}/v2`

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(path: string, params?: Record<string, string | number | null | undefined>): Promise<T> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  const response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`)
  if (!response.ok) {
    let detail = `Forespørgslen fejlede (${response.status})`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as T
}

const STALE = 10 * 60 * 1000

export function useSeasons() {
  return useQuery({ queryKey: ['seasons'], queryFn: () => getJson<SeasonsResponse>('/seasons'), staleTime: Infinity })
}

export function useSearch(query: string, season: number | null) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['search', trimmed.toLowerCase(), season],
    queryFn: () => getJson<SearchResponse>('/search', { q: trimmed, season, limit: 6 }),
    enabled: trimmed.length >= 2,
    staleTime: STALE,
    placeholderData: (previous) => previous,
  })
}

export function useTeam(slug: string | undefined, season: number | null) {
  return useQuery({
    queryKey: ['team', slug, season],
    queryFn: () => getJson<TeamProfile>(`/teams/${encodeURIComponent(slug ?? '')}`, { season }),
    enabled: Boolean(slug),
    staleTime: STALE,
  })
}

export function usePlayer(slug: string | undefined, season: number | null) {
  return useQuery({
    queryKey: ['player', slug, season],
    queryFn: () => getJson<PlayerProfile>(`/players/${encodeURIComponent(slug ?? '')}`, { season }),
    enabled: Boolean(slug),
    staleTime: STALE,
  })
}

export function useTeamHeadToHead(a: string | null, b: string | null, season: number | null) {
  return useQuery({
    queryKey: ['h2h', a, b, season],
    queryFn: () => getJson<TeamHeadToHead>('/h2h/teams', { a, b, season }),
    enabled: Boolean(a && b && a !== b),
    staleTime: STALE,
  })
}

export function usePlayerComparison(a: string | null, b: string | null, season: number | null) {
  return useQuery({
    queryKey: ['compare', a, b, season],
    queryFn: () => getJson<PlayerComparison>('/compare/players', { a, b, season }),
    enabled: Boolean(a && b && a !== b),
    staleTime: STALE,
  })
}

export function useLeagues(season: number | null) {
  return useQuery({
    queryKey: ['leagues', season],
    queryFn: () => getJson<LeaguesResponse>('/leagues', { season }),
    enabled: season !== null,
    staleTime: STALE,
  })
}

export function useGroup(season: number | null, groupId: number | null) {
  return useQuery({
    queryKey: ['group', season, groupId],
    queryFn: () => getJson<GroupDetail>(`/groups/${groupId}`, { season }),
    enabled: season !== null && groupId !== null,
    staleTime: STALE,
  })
}

export function useMatch(season: number | null, groupId: number | null, matchId: number | null) {
  return useQuery({
    queryKey: ['match', season, groupId, matchId],
    queryFn: () => getJson<MatchDetail>(`/matches/${matchId}`, { season, group: groupId }),
    enabled: season !== null && groupId !== null && matchId !== null,
    staleTime: STALE,
  })
}

export function useLeaderboards(season: number | null, division: string | null, minMatches: number) {
  return useQuery({
    queryKey: ['leaderboards', season, division, minMatches],
    queryFn: () => getJson<Leaderboards>('/leaderboards', { season, division, min_matches: minMatches }),
    enabled: season !== null,
    staleTime: STALE,
    placeholderData: (previous) => previous,
  })
}
