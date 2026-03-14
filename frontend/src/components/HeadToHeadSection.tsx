import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { fetchSeasons, fetchTeamHeadToHeadReport, fetchTeamSuggestions } from '../api'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ReportBlock, ReportResponse, SearchResult } from '../types'

type TableBlock = Extract<ReportBlock, { type: 'table' }>

type TeamSummary = {
  name: string
  teamMatchWinPct: number
  individualWinPct: number
  setWinPct: number
  pointWinPct: number
}

type HeadToHeadOverview = {
  teamA: TeamSummary
  teamB: TeamSummary
}

type MatchTypeRadarDatum = {
  label: string
  teamAWinPct: number
  teamBWinPct: number
}

type DirectResult = {
  label: string
  resultA: 'W' | 'L' | 'D'
  resultB: 'W' | 'L' | 'D'
}

const MATCH_TYPE_ORDER = [
  '1.md',
  '2.md',
  '1.ds',
  '2.ds',
  '1.hs',
  '2.hs',
  '3.hs',
  '4.hs',
  '1.dd',
  '2.dd',
  '1.hd',
  '2.hd',
  '3.hd',
] as const

const MATCH_TYPE_ORDER_INDEX: Record<string, number> = MATCH_TYPE_ORDER.reduce<Record<string, number>>(
  (accumulator, value, index) => {
    accumulator[value] = index
    return accumulator
  },
  {},
)

function parseNumericCell(value: string): number | null {
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim()
  if (cleaned === '' || cleaned === '-') {
    return null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  const entries = headers.map((header, index) => [header, row[index] ?? ''])
  return Object.fromEntries(entries)
}

function findTableByHeading(blocks: ReportBlock[], headingMatcher: RegExp): TableBlock | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.type !== 'heading' || !headingMatcher.test(block.text)) {
      continue
    }

    for (let next = index + 1; next < blocks.length; next += 1) {
      const candidate = blocks[next]
      if (candidate.type === 'heading') {
        break
      }
      if (candidate.type === 'table') {
        return candidate
      }
    }
  }

  return null
}

function toMatchTypeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function extractOverview(report: ReportResponse | null, teamAName: string, teamBName: string): HeadToHeadOverview {
  const fallback: HeadToHeadOverview = {
    teamA: {
      name: teamAName || 'Team A',
      teamMatchWinPct: 0,
      individualWinPct: 0,
      setWinPct: 0,
      pointWinPct: 0,
    },
    teamB: {
      name: teamBName || 'Team B',
      teamMatchWinPct: 0,
      individualWinPct: 0,
      setWinPct: 0,
      pointWinPct: 0,
    },
  }

  if (!report) {
    return fallback
  }

  const table = findTableByHeading(report.blocks, /Overall Comparison/i)
  if (!table) {
    return fallback
  }

  const rows = table.rows.map((rawRow) => rowToObject(table.headers, rawRow))
  const rowA = rows.find((row) => (row.team_code || '').trim().toUpperCase() === 'A')
  const rowB = rows.find((row) => (row.team_code || '').trim().toUpperCase() === 'B')

  if (!rowA || !rowB) {
    return fallback
  }

  return {
    teamA: {
      name: (rowA.team_name || '').trim() || fallback.teamA.name,
      teamMatchWinPct: parseNumericCell(rowA.team_match_win_pct ?? '') ?? 0,
      individualWinPct: parseNumericCell(rowA.individual_win_pct ?? '') ?? 0,
      setWinPct: parseNumericCell(rowA.set_win_pct ?? '') ?? 0,
      pointWinPct: parseNumericCell(rowA.point_win_pct ?? '') ?? 0,
    },
    teamB: {
      name: (rowB.team_name || '').trim() || fallback.teamB.name,
      teamMatchWinPct: parseNumericCell(rowB.team_match_win_pct ?? '') ?? 0,
      individualWinPct: parseNumericCell(rowB.individual_win_pct ?? '') ?? 0,
      setWinPct: parseNumericCell(rowB.set_win_pct ?? '') ?? 0,
      pointWinPct: parseNumericCell(rowB.point_win_pct ?? '') ?? 0,
    },
  }
}

function extractMatchTypeRadar(report: ReportResponse | null): MatchTypeRadarDatum[] {
  if (!report) {
    return []
  }

  const table = findTableByHeading(report.blocks, /Winrate by Match Type/i)
  if (!table) {
    return []
  }

  const byType = new Map<string, MatchTypeRadarDatum>()
  for (const rawRow of table.rows) {
    const row = rowToObject(table.headers, rawRow)
    const rawLabel = (row.match_type || '').trim()
    if (!rawLabel) {
      continue
    }

    const label = toMatchTypeLabel(rawLabel)
    const teamAWinPct = parseNumericCell(row.team_a_win_pct ?? '')
    const teamBWinPct = parseNumericCell(row.team_b_win_pct ?? '')

    byType.set(label, {
      label,
      teamAWinPct: teamAWinPct ?? 0,
      teamBWinPct: teamBWinPct ?? 0,
    })
  }

  if (byType.size === 0) {
    return []
  }

  const ordered: MatchTypeRadarDatum[] = []
  for (const matchType of MATCH_TYPE_ORDER) {
    const item = byType.get(matchType)
    if (!item) {
      continue
    }
    ordered.push(item)
    byType.delete(matchType)
  }

  const rest = [...byType.values()].sort((left, right) => {
    const leftIndex = MATCH_TYPE_ORDER_INDEX[left.label] ?? 99
    const rightIndex = MATCH_TYPE_ORDER_INDEX[right.label] ?? 99
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }
    return left.label.localeCompare(right.label, undefined, { numeric: true })
  })

  return [...ordered, ...rest]
}

function extractDirectResults(report: ReportResponse | null): DirectResult[] {
  if (!report) {
    return []
  }

  const table = findTableByHeading(report.blocks, /Direct Head-to-Head Matches/i)
  if (!table) {
    return []
  }

  const results = table.rows
    .map((rawRow) => {
      const row = rowToObject(table.headers, rawRow)
      const resultA = (row.result_for_team_a || '').trim().toUpperCase()
      if (resultA !== 'W' && resultA !== 'L' && resultA !== 'D') {
        return null
      }

      const season = (row.season_id || '').trim()
      const round = (row.round_no || '').trim()
      const label = `${season ? `S${season}` : 'Season'}${round ? ` · R${round}` : ''}`

      const resultB = resultA === 'W' ? 'L' : resultA === 'L' ? 'W' : 'D'

      return {
        label,
        resultA,
        resultB,
      }
    })
    .filter((item): item is DirectResult => item !== null)

  return results.slice(0, 8)
}

function polarPoint(
  centerX: number,
  centerY: number,
  radius: number,
  index: number,
  total: number,
): { x: number; y: number } {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / total
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  }
}

function resultClassName(value: 'W' | 'L' | 'D'): string {
  if (value === 'W') {
    return 'form-pill form-pill-win'
  }
  if (value === 'L') {
    return 'form-pill form-pill-loss'
  }
  return 'form-pill form-pill-draw'
}

function HeadToHeadRadarChart({
  data,
  teamAName,
  teamBName,
}: {
  data: MatchTypeRadarDatum[]
  teamAName: string
  teamBName: string
}) {
  const width = 760
  const height = 560
  const centerX = width / 2
  const centerY = height / 2 - 10
  const radius = 188
  const rings = [20, 40, 60, 80, 100]
  const axisCount = data.length

  if (axisCount === 0) {
    return (
      <div className="workspace-empty workspace-empty-inline">
        <h3>No match-type comparison available</h3>
        <p>Select two teams to generate the radar profile.</p>
      </div>
    )
  }

  const teamAPoints = data
    .map((item, index) => {
      const ratio = Math.max(0, Math.min(100, item.teamAWinPct)) / 100
      return polarPoint(centerX, centerY, radius * ratio, index, axisCount)
    })
    .map((point) => `${point.x},${point.y}`)
    .join(' ')

  const teamBPoints = data
    .map((item, index) => {
      const ratio = Math.max(0, Math.min(100, item.teamBWinPct)) / 100
      return polarPoint(centerX, centerY, radius * ratio, index, axisCount)
    })
    .map((point) => `${point.x},${point.y}`)
    .join(' ')

  return (
    <div className="h2h-radar-wrap">
      <svg className="h2h-radar-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Head-to-head radar chart by match type">
        <defs>
          <linearGradient id="h2h-radar-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1a9a6e" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#0f6d4d" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="h2h-radar-b" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e2aa33" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#bb7321" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {rings.map((ring) => {
          const ringRadius = (ring / 100) * radius
          const points = data
            .map((_, index) => polarPoint(centerX, centerY, ringRadius, index, axisCount))
            .map((point) => `${point.x},${point.y}`)
            .join(' ')
          return <polygon key={`ring-${ring}`} points={points} className="h2h-radar-ring" />
        })}

        {data.map((item, index) => {
          const outer = polarPoint(centerX, centerY, radius, index, axisCount)
          const labelPoint = polarPoint(centerX, centerY, radius + 24, index, axisCount)
          return (
            <g key={`axis-${item.label}`}>
              <line x1={centerX} y1={centerY} x2={outer.x} y2={outer.y} className="h2h-radar-axis" />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" className="h2h-radar-label">
                {item.label}
              </text>
            </g>
          )
        })}

        <polygon points={teamAPoints} className="h2h-radar-shape-a" />
        <polygon points={teamBPoints} className="h2h-radar-shape-b" />

        {data.map((item, index) => {
          const pointA = polarPoint(centerX, centerY, (Math.max(0, Math.min(100, item.teamAWinPct)) / 100) * radius, index, axisCount)
          const pointB = polarPoint(centerX, centerY, (Math.max(0, Math.min(100, item.teamBWinPct)) / 100) * radius, index, axisCount)

          return (
            <g key={`dot-${item.label}`}>
              <circle cx={pointA.x} cy={pointA.y} r={4} className="h2h-radar-dot-a">
                <title>{`${teamAName} · ${item.label}: ${item.teamAWinPct.toFixed(2)}%`}</title>
              </circle>
              <circle cx={pointB.x} cy={pointB.y} r={4} className="h2h-radar-dot-b">
                <title>{`${teamBName} · ${item.label}: ${item.teamBWinPct.toFixed(2)}%`}</title>
              </circle>
            </g>
          )
        })}
      </svg>

      <div className="h2h-radar-legend">
        <span>
          <i className="legend-dot legend-dot-a" />
          {teamAName}
        </span>
        <span>
          <i className="legend-dot legend-dot-b" />
          {teamBName}
        </span>
      </div>
    </div>
  )
}

export function HeadToHeadSection() {
  const [teamAInput, setTeamAInput] = useState('')
  const [teamBInput, setTeamBInput] = useState('')
  const [selectedTeamA, setSelectedTeamA] = useState('')
  const [selectedTeamB, setSelectedTeamB] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [seasons, setSeasons] = useState<{ season_id: number; season_label: string }[]>([])
  const [suggestionsA, setSuggestionsA] = useState<SearchResult[]>([])
  const [suggestionsB, setSuggestionsB] = useState<SearchResult[]>([])
  const [activeSuggestionAIndex, setActiveSuggestionAIndex] = useState(-1)
  const [activeSuggestionBIndex, setActiveSuggestionBIndex] = useState(-1)
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [isLoadingSuggestionsA, setIsLoadingSuggestionsA] = useState(false)
  const [isLoadingSuggestionsB, setIsLoadingSuggestionsB] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedA = useDebouncedValue(teamAInput, 220)
  const debouncedB = useDebouncedValue(teamBInput, 220)

  const teamA = selectedTeamA.trim()
  const teamB = selectedTeamB.trim()
  const canCompare =
    teamA.length >= 2 && teamB.length >= 2 && teamA.toLowerCase() !== teamB.toLowerCase()
  const sameTeamSelected =
    teamA.length >= 2 && teamB.length >= 2 && teamA.toLowerCase() === teamB.toLowerCase()

  const suggestionsVisibleA = debouncedA.trim().length >= 2 && selectedTeamA !== debouncedA.trim()
  const suggestionsVisibleB = debouncedB.trim().length >= 2 && selectedTeamB !== debouncedB.trim()

  const resolvedActiveSuggestionAIndex =
    suggestionsA.length === 0
      ? -1
      : Math.min(Math.max(activeSuggestionAIndex, 0), suggestionsA.length - 1)
  const resolvedActiveSuggestionBIndex =
    suggestionsB.length === 0
      ? -1
      : Math.min(Math.max(activeSuggestionBIndex, 0), suggestionsB.length - 1)

  useEffect(() => {
    let active = true

    const loadSeasons = async () => {
      try {
        const response = await fetchSeasons()
        if (active) {
          setSeasons(response.results)
        }
      } catch {
        if (active) {
          setSeasons([])
        }
      }
    }

    void loadSeasons()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    if (!suggestionsVisibleA) {
      setSuggestionsA([])
      return () => {
        active = false
      }
    }

    const loadSuggestions = async () => {
      setIsLoadingSuggestionsA(true)
      try {
        const response = await fetchTeamSuggestions({ query: debouncedA, seasonId })
        if (active) {
          setSuggestionsA(response.results)
          setActiveSuggestionAIndex(response.results.length > 0 ? 0 : -1)
        }
      } catch {
        if (active) {
          setSuggestionsA([])
          setActiveSuggestionAIndex(-1)
        }
      } finally {
        if (active) {
          setIsLoadingSuggestionsA(false)
        }
      }
    }

    void loadSuggestions()

    return () => {
      active = false
    }
  }, [debouncedA, seasonId, suggestionsVisibleA])

  useEffect(() => {
    let active = true

    if (!suggestionsVisibleB) {
      setSuggestionsB([])
      return () => {
        active = false
      }
    }

    const loadSuggestions = async () => {
      setIsLoadingSuggestionsB(true)
      try {
        const response = await fetchTeamSuggestions({ query: debouncedB, seasonId })
        if (active) {
          setSuggestionsB(response.results)
          setActiveSuggestionBIndex(response.results.length > 0 ? 0 : -1)
        }
      } catch {
        if (active) {
          setSuggestionsB([])
          setActiveSuggestionBIndex(-1)
        }
      } finally {
        if (active) {
          setIsLoadingSuggestionsB(false)
        }
      }
    }

    void loadSuggestions()

    return () => {
      active = false
    }
  }, [debouncedB, seasonId, suggestionsVisibleB])

  useEffect(() => {
    let active = true

    if (!canCompare) {
      setReport(null)
      setError(null)
      return () => {
        active = false
      }
    }

    const loadReport = async () => {
      setError(null)
      setIsLoadingReport(true)
      try {
        const response = await fetchTeamHeadToHeadReport({ teamA, teamB, seasonId })
        if (active) {
          setReport(response)
        }
      } catch (unknownError) {
        const message =
          unknownError instanceof Error ? unknownError.message : 'Unable to load head-to-head report.'
        if (active) {
          setError(message)
        }
      } finally {
        if (active) {
          setIsLoadingReport(false)
        }
      }
    }

    void loadReport()

    return () => {
      active = false
    }
  }, [canCompare, seasonId, teamA, teamB])

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    suggestions: SearchResult[],
    activeIndex: number,
    setActiveIndex: (next: number | ((current: number) => number)) => void,
    applySuggestion: (suggestion: SearchResult) => void,
    applyTyped: () => void,
  ) => {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) {
        return
      }
      event.preventDefault()
      setActiveIndex((current) => (current < 0 ? 0 : (current + 1) % suggestions.length))
      return
    }

    if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) {
        return
      }
      event.preventDefault()
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        applySuggestion(suggestions[activeIndex])
      } else {
        applyTyped()
      }
      return
    }

    if (event.key === 'Escape') {
      setActiveIndex(-1)
    }
  }

  const activeSeasonLabel =
    seasonId === null
      ? 'All seasons'
      : (seasons.find((season) => season.season_id === seasonId)?.season_label ?? `Season ${seasonId}`)

  const overview = useMemo(() => extractOverview(report, teamA, teamB), [report, teamA, teamB])
  const radarData = useMemo(() => extractMatchTypeRadar(report), [report])
  const directResults = useMemo(() => extractDirectResults(report), [report])

  return (
    <section className="teams-section h2h-section" id="head-to-head" aria-label="Team head-to-head workspace">
      <div className="teams-head">
        <p className="eyebrow">Head-to-Head</p>
        <h2>Compare two teams with lineup-level win profile and direct form momentum.</h2>
      </div>

      <div className="teams-layout">
        <aside className="teams-controls" aria-label="Head-to-head controls">
          <div className="teams-search-form h2h-search-grid">
            <label className="teams-label" htmlFor="h2h-team-a-input">
              Team A
            </label>
            <div className="teams-search-wrap">
              <input
                id="h2h-team-a-input"
                value={teamAInput}
                onChange={(event) => {
                  setTeamAInput(event.target.value)
                  setSelectedTeamA('')
                }}
                onKeyDown={(event) =>
                  onKeyDown(
                    event,
                    suggestionsA,
                    resolvedActiveSuggestionAIndex,
                    setActiveSuggestionAIndex,
                    (suggestion) => {
                      setSelectedTeamA(suggestion.name)
                      setTeamAInput(suggestion.name)
                      setSuggestionsA([])
                      setActiveSuggestionAIndex(-1)
                    },
                    () => {
                      const typedValue = teamAInput.trim()
                      if (typedValue.length >= 2) {
                        setSelectedTeamA(typedValue)
                        setSuggestionsA([])
                        setActiveSuggestionAIndex(-1)
                      }
                    },
                  )
                }
                placeholder="Search first team"
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="h2h-team-a-suggestions"
              />
              {suggestionsVisibleA ? (
                <div className="teams-suggestions" id="h2h-team-a-suggestions">
                  {suggestionsA.length === 0 && !isLoadingSuggestionsA ? (
                    <p className="teams-empty">No team matches this search.</p>
                  ) : (
                    <ul>
                      {suggestionsA.map((suggestion, index) => {
                        const isActive =
                          index === resolvedActiveSuggestionAIndex || suggestion.name === selectedTeamA
                        return (
                          <li key={`h2h-a-${suggestion.name}`}>
                            <button
                              type="button"
                              className={isActive ? 'teams-suggestion-item active' : 'teams-suggestion-item'}
                              onMouseEnter={() => setActiveSuggestionAIndex(index)}
                              onClick={() => {
                                setSelectedTeamA(suggestion.name)
                                setTeamAInput(suggestion.name)
                                setSuggestionsA([])
                                setActiveSuggestionAIndex(-1)
                              }}
                            >
                              {suggestion.name}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
              {isLoadingSuggestionsA ? <p className="teams-search-status">Updating Team A...</p> : null}
            </div>

            <div className="h2h-vs-badge" aria-hidden>
              VS
            </div>

            <label className="teams-label" htmlFor="h2h-team-b-input">
              Team B
            </label>
            <div className="teams-search-wrap">
              <input
                id="h2h-team-b-input"
                value={teamBInput}
                onChange={(event) => {
                  setTeamBInput(event.target.value)
                  setSelectedTeamB('')
                }}
                onKeyDown={(event) =>
                  onKeyDown(
                    event,
                    suggestionsB,
                    resolvedActiveSuggestionBIndex,
                    setActiveSuggestionBIndex,
                    (suggestion) => {
                      setSelectedTeamB(suggestion.name)
                      setTeamBInput(suggestion.name)
                      setSuggestionsB([])
                      setActiveSuggestionBIndex(-1)
                    },
                    () => {
                      const typedValue = teamBInput.trim()
                      if (typedValue.length >= 2) {
                        setSelectedTeamB(typedValue)
                        setSuggestionsB([])
                        setActiveSuggestionBIndex(-1)
                      }
                    },
                  )
                }
                placeholder="Search second team"
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="h2h-team-b-suggestions"
              />
              {suggestionsVisibleB ? (
                <div className="teams-suggestions" id="h2h-team-b-suggestions">
                  {suggestionsB.length === 0 && !isLoadingSuggestionsB ? (
                    <p className="teams-empty">No team matches this search.</p>
                  ) : (
                    <ul>
                      {suggestionsB.map((suggestion, index) => {
                        const isActive =
                          index === resolvedActiveSuggestionBIndex || suggestion.name === selectedTeamB
                        return (
                          <li key={`h2h-b-${suggestion.name}`}>
                            <button
                              type="button"
                              className={isActive ? 'teams-suggestion-item active' : 'teams-suggestion-item'}
                              onMouseEnter={() => setActiveSuggestionBIndex(index)}
                              onClick={() => {
                                setSelectedTeamB(suggestion.name)
                                setTeamBInput(suggestion.name)
                                setSuggestionsB([])
                                setActiveSuggestionBIndex(-1)
                              }}
                            >
                              {suggestion.name}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
              {isLoadingSuggestionsB ? <p className="teams-search-status">Updating Team B...</p> : null}
            </div>

            <div className="teams-season-block">
              <label className="teams-label" htmlFor="h2h-season-select">
                Season Filter
              </label>
              <select
                id="h2h-season-select"
                value={seasonId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setSeasonId(value ? Number(value) : null)
                }}
              >
                <option value="">All seasons</option>
                {seasons.map((season) => (
                  <option key={season.season_id} value={season.season_id}>
                    {season.season_label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sameTeamSelected ? (
            <p className="teams-error" role="alert">
              Team A and Team B must be different.
            </p>
          ) : null}
          {error ? (
            <p className="teams-error" role="alert">
              {error}
            </p>
          ) : null}
          {isLoadingReport ? <p className="teams-search-status">Refreshing comparison...</p> : null}
        </aside>

        <div className="teams-dashboard">
          {canCompare ? (
            report ? (
              <>
                <article className="workspace-context">
                  <h3>
                    {overview.teamA.name} vs {overview.teamB.name}
                  </h3>
                  <p>{activeSeasonLabel}</p>
                </article>

                <div className="h2h-form-grid" aria-label="Team form comparison">
                  <article className="h2h-team-card">
                    <h4>{overview.teamA.name}</h4>
                    <dl>
                      <div>
                        <dt>Team Match Win %</dt>
                        <dd>{overview.teamA.teamMatchWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Individual Win %</dt>
                        <dd>{overview.teamA.individualWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Set Win %</dt>
                        <dd>{overview.teamA.setWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Point Win %</dt>
                        <dd>{overview.teamA.pointWinPct.toFixed(2)}%</dd>
                      </div>
                    </dl>
                    <div className="h2h-form-pills" aria-label="Recent direct form for Team A">
                      {directResults.length > 0 ? (
                        directResults.map((item) => (
                          <span key={`form-a-${item.label}`} className={resultClassName(item.resultA)} title={item.label}>
                            {item.resultA}
                          </span>
                        ))
                      ) : (
                        <p className="teams-search-status">No direct head-to-head form yet.</p>
                      )}
                    </div>
                  </article>

                  <article className="h2h-team-card">
                    <h4>{overview.teamB.name}</h4>
                    <dl>
                      <div>
                        <dt>Team Match Win %</dt>
                        <dd>{overview.teamB.teamMatchWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Individual Win %</dt>
                        <dd>{overview.teamB.individualWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Set Win %</dt>
                        <dd>{overview.teamB.setWinPct.toFixed(2)}%</dd>
                      </div>
                      <div>
                        <dt>Point Win %</dt>
                        <dd>{overview.teamB.pointWinPct.toFixed(2)}%</dd>
                      </div>
                    </dl>
                    <div className="h2h-form-pills" aria-label="Recent direct form for Team B">
                      {directResults.length > 0 ? (
                        directResults.map((item) => (
                          <span key={`form-b-${item.label}`} className={resultClassName(item.resultB)} title={item.label}>
                            {item.resultB}
                          </span>
                        ))
                      ) : (
                        <p className="teams-search-status">No direct head-to-head form yet.</p>
                      )}
                    </div>
                  </article>
                </div>

                <article className="teams-chart-card h2h-radar-card">
                  <header>
                    <h3>Match-Type Radar Comparison</h3>
                    <p>Football-style radar showing lineup-slot strength across all match types.</p>
                  </header>
                  <HeadToHeadRadarChart
                    data={radarData}
                    teamAName={overview.teamA.name}
                    teamBName={overview.teamB.name}
                  />
                </article>
              </>
            ) : (
              <article className="workspace-empty" aria-live="polite">
                <h3>Generating comparison...</h3>
                <p>We are loading head-to-head data for both selected teams.</p>
                <div className="workspace-empty-viz" aria-hidden>
                  <span className="empty-bar bar-one" />
                  <span className="empty-bar bar-two" />
                  <span className="empty-bar bar-three" />
                  <span className="empty-line" />
                </div>
              </article>
            )
          ) : (
            <article className="workspace-empty" aria-live="polite">
              <h3>Select two teams to start head-to-head analysis</h3>
              <p>
                Pick Team A and Team B to unlock side-by-side form cards and a large match-type
                radar chart.
              </p>
              <div className="workspace-empty-viz" aria-hidden>
                <span className="empty-bar bar-one" />
                <span className="empty-bar bar-two" />
                <span className="empty-bar bar-three" />
                <span className="empty-line" />
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  )
}
