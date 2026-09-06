import { useQuery } from '@tanstack/react-query'

import type {
  ClubIndex,
  ClubProfile,
  Entity,
  GroupDetail,
  Leaderboards,
  LineupClub,
  LineupPoints,
  LineupSetup,
  OptimiseResult,
  LeaguesResponse,
  MatchDetail,
  PlayerComparison,
  PlayerProfile,
  PlayerRanking,
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

export function useClub(slug: string | undefined, season: number | null) {
  return useQuery({
    queryKey: ['club', slug, season],
    queryFn: () => getJson<ClubProfile>(`/clubs/${slug}`, { season }),
    enabled: Boolean(slug),
    staleTime: STALE,
  })
}

export function useClubs(season: number | null) {
  return useQuery({
    queryKey: ['clubs', season],
    queryFn: () => getJson<ClubIndex>('/clubs', { season }),
    enabled: season !== null,
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

/**
 * Ranking points from badmintonplayer.dk. Loaded on its own so a slow or failing
 * lookup never holds up the rest of the player page.
 */
export function usePlayerRanking(slug: string | undefined) {
  return useQuery({
    queryKey: ['ranking', slug],
    queryFn: () => getJson<PlayerRanking>(`/players/${encodeURIComponent(slug ?? '')}/ranking`),
    enabled: Boolean(slug),
    staleTime: 60 * 60 * 1000,
    retry: false,
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

/** Slug to display name, for a comparison page opened with only one side chosen. */
export function useResolveEntity(kind: 'team' | 'player', slug: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['resolve', kind, slug],
    queryFn: () => getJson<Entity>('/resolve', { kind, slug }),
    enabled: enabled && Boolean(slug),
    staleTime: Infinity,
    retry: false,
  })
}

export function useLineupSetup(teamSlug: string | null) {
  return useQuery({
    queryKey: ['lineup-setup', teamSlug],
    queryFn: () => getJson<LineupSetup>('/lineup/setup', { team: teamSlug }),
    enabled: Boolean(teamSlug),
    staleTime: STALE,
  })
}

export function useLineupClub(teamSlug: string | null) {
  return useQuery({
    queryKey: ['lineup-club', teamSlug],
    queryFn: () => getJson<LineupClub>('/lineup/club', { team: teamSlug }),
    enabled: Boolean(teamSlug),
    staleTime: STALE,
  })
}

/** Ranking points for a set of players, POSTed as one batch. */
export function useLineupPoints(ids: number[]) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['lineup-points', sorted],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/lineup/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: sorted }),
      })
      if (!response.ok) throw new ApiError(response.status, 'Kunne ikke hente ranglistepoint')
      return (await response.json()) as LineupPoints
    },
    enabled: sorted.length > 0,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
}

export async function optimiseLineup(body: {
  team: string
  opponent: string
  available: number[]
  matches: number
  sex: Record<string, 'M' | 'F'>
}): Promise<OptimiseResult> {
  const response = await fetch(`${API_BASE}/lineup/optimise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = `Beregningen fejlede (${response.status})`
    try {
      const data = (await response.json()) as { detail?: string }
      if (data.detail) detail = data.detail
    } catch {
      // keep generic
    }
    throw new ApiError(response.status, detail)
  }
  return (await response.json()) as OptimiseResult
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

export function useLeaderboards(season: number | null, division: string | null, minMatches: number | null) {
  return useQuery({
    queryKey: ['leaderboards', season, division, minMatches],
    queryFn: () => getJson<Leaderboards>('/leaderboards', { season, division, min_matches: minMatches }),
    enabled: season !== null,
    staleTime: STALE,
    placeholderData: (previous) => previous,
  })
}
