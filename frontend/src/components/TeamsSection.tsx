import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AxisLeft } from '@visx/axis'
import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { scaleBand, scaleLinear, scalePoint } from '@visx/scale'
import { BarRounded, LinePath } from '@visx/shape'

import { fetchSeasons, fetchTeamReport, fetchTeamSuggestions } from '../api'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ReportBlock, ReportResponse, SearchResult } from '../types'

type TableBlock = Extract<ReportBlock, { type: 'table' }>

type SnapshotMetric = {
  label: string
  value: number
}

type WinRateDatum = {
  label: string
  winPct: number
  wins: number
  losses: number
}

type TrendDatum = {
  label: string
  pointDelta: number
  result: string
  opponent: string
}

type PlayerSummary = {
  name: string
  teamMatches: number
  individualMatches: number
  winPct: number
}

type OpponentSummary = {
  name: string
  teamMatches: number
  winPct: number
}

type SpotlightInsights = {
  mostGamesPlayer: PlayerSummary
  highestWinPctPlayer: PlayerSummary
  bestOpponent: OpponentSummary
  worstOpponent: OpponentSummary
  participationPct: number
}

const FALLBACK_SNAPSHOT: SnapshotMetric[] = [
  { label: 'Team Match Win %', value: 55.56 },
  { label: 'Individual Win %', value: 50.43 },
  { label: 'Set Win %', value: 48.82 },
  { label: 'Point Win %', value: 50.08 },
]

const FALLBACK_WIN_RATE: WinRateDatum[] = [
  { label: '2.md', winPct: 33.33, wins: 3, losses: 6 },
  { label: '1.ds', winPct: 55.56, wins: 5, losses: 4 },
  { label: '1.hs', winPct: 77.78, wins: 7, losses: 2 },
  { label: '2.hs', winPct: 22.22, wins: 2, losses: 7 },
  { label: '1.dd', winPct: 44.44, wins: 4, losses: 5 },
  { label: '1.hd', winPct: 100, wins: 9, losses: 0 },
]

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

const FALLBACK_TREND: TrendDatum[] = [
  { label: 'R1', pointDelta: -41, result: 'L', opponent: 'Opponent' },
  { label: 'R2', pointDelta: -133, result: 'L', opponent: 'Opponent' },
  { label: 'R3', pointDelta: 56, result: 'W', opponent: 'Opponent' },
  { label: 'R4', pointDelta: 131, result: 'W', opponent: 'Opponent' },
  { label: 'R5', pointDelta: -124, result: 'L', opponent: 'Opponent' },
  { label: 'R6', pointDelta: -55, result: 'L', opponent: 'Opponent' },
  { label: 'R7', pointDelta: 54, result: 'W', opponent: 'Opponent' },
  { label: 'R8', pointDelta: 114, result: 'W', opponent: 'Opponent' },
  { label: 'R9', pointDelta: 12, result: 'W', opponent: 'Opponent' },
]

const FALLBACK_INSIGHTS: SpotlightInsights = {
  mostGamesPlayer: {
    name: 'Rune Christtreu',
    teamMatches: 9,
    individualMatches: 18,
    winPct: 83.33,
  },
  highestWinPctPlayer: {
    name: 'Zvonimir Durkinjak (EU)',
    teamMatches: 6,
    individualMatches: 8,
    winPct: 100,
  },
  bestOpponent: {
    name: 'Aarhus Akademisk',
    teamMatches: 1,
    winPct: 100,
  },
  worstOpponent: {
    name: 'abc Aalborg 2',
    teamMatches: 1,
    winPct: 0,
  },
  participationPct: 100,
}

function parseNumericCell(value: string): number | null {
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').trim()
  if (cleaned === '' || cleaned === '-') {
    return null
  }

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function toMatchTypeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
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

function extractOverallSummaryRow(report: ReportResponse | null): Record<string, string> | null {
  if (!report) {
    return null
  }

  const overallTable = findTableByHeading(report.blocks, /Overall Summary/i)
  if (!overallTable || overallTable.rows.length === 0) {
    return null
  }

  return rowToObject(overallTable.headers, overallTable.rows[0])
}

function extractSnapshot(report: ReportResponse | null): SnapshotMetric[] {
  if (!report) {
    return FALLBACK_SNAPSHOT
  }

  const overallTable = findTableByHeading(report.blocks, /Overall Summary/i)
  if (!overallTable || overallTable.rows.length === 0) {
    return FALLBACK_SNAPSHOT
  }

  const row = rowToObject(overallTable.headers, overallTable.rows[0])
  const metricConfig = [
    ['team_match_win_pct', 'Team Match Win %'],
    ['individual_win_pct', 'Individual Win %'],
    ['set_win_pct', 'Set Win %'],
    ['point_win_pct', 'Point Win %'],
  ] as const

  const metrics: SnapshotMetric[] = []
  for (const [key, label] of metricConfig) {
    const value = parseNumericCell(row[key] ?? '')
    if (value !== null) {
      metrics.push({ label, value })
    }
  }

  return metrics.length > 0 ? metrics : FALLBACK_SNAPSHOT
}

function extractWinRateByType(report: ReportResponse | null): WinRateDatum[] {
  if (!report) {
    return FALLBACK_WIN_RATE
  }

  const table = findTableByHeading(report.blocks, /Winrate by Match Type/i)
  if (!table) {
    return FALLBACK_WIN_RATE
  }

  const rows = table.rows
    .map((rawRow) => {
      const row = rowToObject(table.headers, rawRow)
      const winPct = parseNumericCell(row.win_pct ?? '')
      const wins = parseNumericCell(row.wins ?? '')
      const losses = parseNumericCell(row.losses ?? '')
      if (winPct === null || wins === null || losses === null) {
        return null
      }

      const labelSource = (row.match_type || row.discipline_label || '').trim()
      const label = toMatchTypeLabel(labelSource)
      if (!label) {
        return null
      }

      return {
        label,
        winPct: Math.max(0, Math.min(100, winPct)),
        wins,
        losses,
      }
    })
    .filter((item): item is WinRateDatum => item !== null)
    .sort((left, right) => {
      const leftIndex = MATCH_TYPE_ORDER_INDEX[left.label]
      const rightIndex = MATCH_TYPE_ORDER_INDEX[right.label]

      if (leftIndex !== undefined && rightIndex !== undefined) {
        return leftIndex - rightIndex
      }
      if (leftIndex !== undefined) {
        return -1
      }
      if (rightIndex !== undefined) {
        return 1
      }

      return left.label.localeCompare(right.label, undefined, { numeric: true })
    })

  return rows.length > 0 ? rows : FALLBACK_WIN_RATE
}

function parsePointScore(score: string): number | null {
  const match = score.trim().match(/^(\d+)\s*-\s*(\d+)$/)
  if (!match) {
    return null
  }

  return Number(match[1]) - Number(match[2])
}

function extractTrend(report: ReportResponse | null, seasonId: number | null): TrendDatum[] {
  if (!report) {
    return FALLBACK_TREND
  }

  if (seasonId === null) {
    const seasonTable = findTableByHeading(report.blocks, /Season Point Differential/i)
    if (seasonTable) {
      const seasonRows = seasonTable.rows
        .map((rawRow) => {
          const row = rowToObject(seasonTable.headers, rawRow)
          const season = parseNumericCell(row.season_id ?? '')
          const explicitDelta = parseNumericCell(row.point_delta ?? '')
          const pointsWon = parseNumericCell(row.points_won ?? '')
          const pointsLost = parseNumericCell(row.points_lost ?? '')
          const pointDelta =
            explicitDelta ??
            (pointsWon !== null && pointsLost !== null ? pointsWon - pointsLost : null)

          if (season === null || pointDelta === null) {
            return null
          }

          return {
            label: `S${season}`,
            pointDelta,
            result: pointDelta >= 0 ? 'W' : 'L',
            opponent: 'Season aggregate across opponents',
          }
        })
        .filter((item): item is TrendDatum => item !== null)
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))

      if (seasonRows.length > 0) {
        return seasonRows
      }
    }
  }

  const table = findTableByHeading(report.blocks, /Recent Team Matches/i)
  if (!table) {
    return FALLBACK_TREND
  }

  const rows = table.rows
    .map((rawRow) => {
      const row = rowToObject(table.headers, rawRow)
      const pointDelta = parsePointScore(row.points_score ?? '')
      if (pointDelta === null) {
        return null
      }

      const seasonValue = parseNumericCell(row.season_id ?? '')
      const roundValue = parseNumericCell(row.round_no ?? '')

      return {
        season: seasonValue,
        round: roundValue,
        pointDelta,
        opponent: (row.opponent_team_name || '').trim() || 'Unknown opponent',
      }
    })
    .filter(
      (item): item is { season: number | null; round: number | null; pointDelta: number; opponent: string } =>
        item !== null,
    )

  if (rows.length === 0) {
    return FALLBACK_TREND
  }

  const byRound = new Map<number, { pointDelta: number; opponents: Set<string> }>()
  for (const row of rows) {
    const roundKey = row.round ?? 0
    const entry = byRound.get(roundKey)
    if (entry) {
      entry.pointDelta += row.pointDelta
      entry.opponents.add(row.opponent)
    } else {
      byRound.set(roundKey, {
        pointDelta: row.pointDelta,
        opponents: new Set([row.opponent]),
      })
    }
  }

  const aggregated = [...byRound.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([round, value]) => ({
      label: round > 0 ? `R${round}` : 'Match',
      pointDelta: value.pointDelta,
      result: value.pointDelta >= 0 ? 'W' : 'L',
      opponent:
        value.opponents.size === 1
          ? [...value.opponents][0]
          : `${value.opponents.size} opponents in this round`,
    }))

  return aggregated.length > 0 ? aggregated.slice(-10) : FALLBACK_TREND
}

function extractSpotlightInsights(report: ReportResponse | null): SpotlightInsights {
  if (!report) {
    return FALLBACK_INSIGHTS
  }

  const playersTable = findTableByHeading(report.blocks, /Top Players/i)
  const opponentTable = findTableByHeading(report.blocks, /Opponent Breakdown/i)
  const overallSummary = extractOverallSummaryRow(report)

  if (!playersTable || !opponentTable) {
    return FALLBACK_INSIGHTS
  }

  const playerRows = playersTable.rows
    .map((rawRow) => {
      const row = rowToObject(playersTable.headers, rawRow)
      const name = (row.player_name || '').trim()
      const teamMatches = parseNumericCell(row.team_matches_played ?? row.matches_played ?? '')
      const individualMatches = parseNumericCell(row.individual_matches_played ?? row.matches_played ?? '')
      const winPct = parseNumericCell(row.win_pct ?? '')
      if (!name || teamMatches === null || individualMatches === null || winPct === null) {
        return null
      }

      return {
        name,
        teamMatches,
        individualMatches,
        winPct: Math.max(0, Math.min(100, winPct)),
      }
    })
    .filter((item): item is PlayerSummary => item !== null)

  const opponentRows = opponentTable.rows
    .map((rawRow) => {
      const row = rowToObject(opponentTable.headers, rawRow)
      const name = (row.opponent_team_name || '').trim()
      const teamMatches = parseNumericCell(row.team_matches ?? '')
      const winPct = parseNumericCell(row.team_match_win_pct ?? '')
      if (!name || teamMatches === null || winPct === null) {
        return null
      }

      return {
        name,
        teamMatches,
        winPct: Math.max(0, Math.min(100, winPct)),
      }
    })
    .filter((item): item is OpponentSummary => item !== null)

  if (playerRows.length === 0 || opponentRows.length === 0) {
    return FALLBACK_INSIGHTS
  }

  const mostGamesPlayer = playerRows.reduce((best, current) => {
    if (current.teamMatches > best.teamMatches) {
      return current
    }
    if (current.teamMatches === best.teamMatches && current.individualMatches > best.individualMatches) {
      return current
    }
    return best
  })

  const winPctEligiblePlayers = playerRows.filter((player) => player.individualMatches >= 4)
  const highestWinPctSource = winPctEligiblePlayers.length > 0 ? winPctEligiblePlayers : playerRows
  const highestWinPctPlayer = highestWinPctSource.reduce((best, current) => {
    if (current.winPct > best.winPct) {
      return current
    }
    if (current.winPct === best.winPct && current.individualMatches > best.individualMatches) {
      return current
    }
    return best
  })

  const bestOpponent = opponentRows.reduce((best, current) =>
    current.winPct > best.winPct ? current : best
  )

  const worstOpponent = opponentRows.reduce((best, current) =>
    current.winPct < best.winPct ? current : best
  )

  const totalTeamMatches = overallSummary
    ? parseNumericCell(overallSummary.team_matches_played ?? '')
    : null
  const participationPct =
    totalTeamMatches && totalTeamMatches > 0
      ? Math.max(0, Math.min(100, (mostGamesPlayer.teamMatches / totalTeamMatches) * 100))
      : FALLBACK_INSIGHTS.participationPct

  return {
    mostGamesPlayer,
    highestWinPctPlayer,
    bestOpponent,
    worstOpponent,
    participationPct,
  }
}

function SpotlightMeter({
  value,
  fill,
  label,
}: {
  value: number
  fill: string
  label: string
}) {
  const width = 250
  const height = 28
  const innerWidth = 214
  const xScale = scaleLinear<number>({
    domain: [0, 100],
    range: [0, innerWidth],
    clamp: true,
  })

  return (
    <svg className="teams-meter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <text x={0} y={10} className="teams-meter-label">
        0
      </text>
      <text x={innerWidth + 14} y={10} className="teams-meter-label">
        100
      </text>
      <rect x={0} y={14} width={innerWidth} height={10} rx={999} fill="rgba(14, 53, 38, 0.11)" />
      <rect x={0} y={14} width={xScale(value)} height={10} rx={999} fill={fill} />
    </svg>
  )
}

function MatchTypeWinRateChart({ data }: { data: WinRateDatum[] }) {
  const width = 620
  const height = 300
  const margin = { top: 24, right: 14, bottom: 76, left: 44 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const xScale = scaleBand<string>({
    domain: data.map((item) => item.label),
    range: [0, innerWidth],
    padding: 0.34,
  })

  const yScale = scaleLinear<number>({
    domain: [0, 100],
    range: [innerHeight, 0],
    nice: true,
  })

  return (
    <svg className="teams-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Win rate by match type">
      <defs>
        <linearGradient id="teams-bars-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1ea777" />
          <stop offset="100%" stopColor="#0d6c4b" />
        </linearGradient>
      </defs>
      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke="rgba(18, 42, 32, 0.1)"
          strokeDasharray="3 4"
          pointerEvents="none"
        />

        {data.map((item) => {
          const x = xScale(item.label) ?? 0
          const y = yScale(item.winPct)
          const barHeight = innerHeight - y
          return (
            <BarRounded
              key={item.label}
              x={x}
              y={y}
              width={xScale.bandwidth()}
              height={barHeight}
              fill="url(#teams-bars-gradient)"
              radius={7}
              top
            />
          )
        })}

        <AxisLeft
          scale={yScale}
          numTicks={5}
          tickFormat={(value) => `${value}%`}
          stroke="rgba(18, 42, 32, 0.25)"
          tickStroke="rgba(18, 42, 32, 0.25)"
          tickLabelProps={() => ({
            fill: '#466358',
            fontSize: 11,
            textAnchor: 'end',
            dy: '0.33em',
          })}
        />

        {data.map((item) => {
          const x = (xScale(item.label) ?? 0) + xScale.bandwidth() / 2
          return (
            <g key={`label-${item.label}`}>
              <text x={x} y={innerHeight + 18} textAnchor="middle" className="teams-axis-label">
                {item.label}
              </text>
              <text x={x} y={innerHeight + 34} textAnchor="middle" className="teams-axis-subtle">
                {item.wins}W-{item.losses}L
              </text>
            </g>
          )
        })}
      </Group>
    </svg>
  )
}

function TeamFormTrendChart({ data }: { data: TrendDatum[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const width = 620
  const height = 300
  const margin = { top: 20, right: 16, bottom: 56, left: 48 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const labels = data.map((item) => item.label)
  const maxAbs = Math.max(20, ...data.map((item) => Math.abs(item.pointDelta)))
  const xScale = scalePoint<string>({
    domain: labels,
    range: [0, innerWidth],
  })

  const yScale = scaleLinear<number>({
    domain: [-maxAbs, maxAbs],
    range: [innerHeight, 0],
    nice: true,
  })

  const baselineY = yScale(0)
  const hoveredDatum = hoveredIndex === null ? null : data[hoveredIndex] ?? null

  return (
    <div className="trend-chart-wrap">
      <svg className="teams-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent point differential trend">
        <defs>
          <linearGradient id="teams-line-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0d6e4d" />
            <stop offset="100%" stopColor="#e3a72c" />
          </linearGradient>
        </defs>
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="rgba(18, 42, 32, 0.1)"
            strokeDasharray="3 4"
            pointerEvents="none"
          />

          <line x1={0} x2={innerWidth} y1={baselineY} y2={baselineY} stroke="rgba(18, 42, 32, 0.34)" strokeWidth={1.2} />

          <LinePath
            data={data}
            x={(item) => xScale(item.label) ?? 0}
            y={(item) => yScale(item.pointDelta)}
            curve={curveMonotoneX}
            stroke="url(#teams-line-gradient)"
            strokeWidth={3.5}
          />

          {data.map((item, index) => {
            const x = xScale(item.label) ?? 0
            const y = yScale(item.pointDelta)
            const positive = item.pointDelta >= 0
            const isHovered = hoveredIndex === index
            return (
              <g key={`trend-${item.label}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 6.2 : 4.8}
                  fill={positive ? '#19a673' : '#de8b2f'}
                  stroke="rgba(255, 255, 255, 0.95)"
                  strokeWidth={1.8}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={12}
                  fill="transparent"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
                <text x={x} y={innerHeight + 18} textAnchor="middle" className="teams-axis-label">
                  {item.label}
                </text>
              </g>
            )
          })}

          <AxisLeft
            scale={yScale}
            numTicks={5}
            tickFormat={(value) => `${value}`}
            stroke="rgba(18, 42, 32, 0.25)"
            tickStroke="rgba(18, 42, 32, 0.25)"
            tickLabelProps={() => ({
              fill: '#466358',
              fontSize: 11,
              textAnchor: 'end',
              dy: '0.33em',
            })}
          />
        </Group>
      </svg>
      <p className="trend-hover-readout" aria-live="polite">
        {hoveredDatum
          ? `${hoveredDatum.label}: ${hoveredDatum.pointDelta >= 0 ? '+' : ''}${hoveredDatum.pointDelta} points vs ${hoveredDatum.opponent}`
          : 'Hover a point to see opponent details.'}
      </p>
    </div>
  )
}

export function TeamsSection() {
  const [queryText, setQueryText] = useState('')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [seasons, setSeasons] = useState<{ season_id: number; season_label: string }[]>([])
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(queryText, 220)

  const activeTeamName = selectedTeam.trim()
  const hasTeamSelection = activeTeamName.length >= 2
  const suggestionsVisible = debouncedSearch.trim().length >= 2 && selectedTeam !== debouncedSearch.trim()
  const resolvedActiveSuggestionIndex =
    suggestions.length === 0 ? -1 : Math.min(Math.max(activeSuggestionIndex, 0), suggestions.length - 1)

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

    if (!suggestionsVisible) {
      setSuggestions([])
      return () => {
        active = false
      }
    }

    const loadSuggestions = async () => {
      setIsLoadingSuggestions(true)
      try {
        const response = await fetchTeamSuggestions({
          query: debouncedSearch,
          seasonId,
        })
        if (active) {
          setSuggestions(response.results)
          setActiveSuggestionIndex(response.results.length > 0 ? 0 : -1)
        }
      } catch {
        if (active) {
          setSuggestions([])
          setActiveSuggestionIndex(-1)
        }
      } finally {
        if (active) {
          setIsLoadingSuggestions(false)
        }
      }
    }

    void loadSuggestions()

    return () => {
      active = false
    }
  }, [debouncedSearch, seasonId, suggestionsVisible])

  const loadTeamReport = async (teamName: string, selectedSeason: number | null) => {
    setError(null)
    setIsLoadingReport(true)
    try {
      const response = await fetchTeamReport({ name: teamName, seasonId: selectedSeason })
      setReport(response)
      setQueryText(teamName)
      setSelectedTeam(teamName)
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unable to load report.'
      setError(message)
    } finally {
      setIsLoadingReport(false)
    }
  }

  useEffect(() => {
    if (activeTeamName.length < 2) {
      return
    }

    void loadTeamReport(activeTeamName, seasonId)
  }, [activeTeamName, seasonId])

  const applySuggestion = (item: SearchResult) => {
    setSelectedTeam(item.name)
    setQueryText(item.name)
    setSuggestions([])
    setActiveSuggestionIndex(-1)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (!suggestionsVisible || suggestions.length === 0) {
        return
      }
      event.preventDefault()
      setActiveSuggestionIndex((index) => (index < 0 ? 0 : (index + 1) % suggestions.length))
      return
    }

    if (event.key === 'ArrowUp') {
      if (!suggestionsVisible || suggestions.length === 0) {
        return
      }
      event.preventDefault()
      setActiveSuggestionIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (resolvedActiveSuggestionIndex >= 0) {
        applySuggestion(suggestions[resolvedActiveSuggestionIndex])
      } else {
        const typedTeamName = queryText.trim()
        if (typedTeamName.length >= 2) {
          setSelectedTeam(typedTeamName)
          setSuggestions([])
          setActiveSuggestionIndex(-1)
        }
      }
      return
    }

    if (event.key === 'Escape') {
      setSuggestions([])
      setActiveSuggestionIndex(-1)
    }
  }

  const snapshot = useMemo(
    () => (hasTeamSelection ? extractSnapshot(report) : []),
    [hasTeamSelection, report],
  )
  const winRateData = useMemo(
    () => (hasTeamSelection ? extractWinRateByType(report) : []),
    [hasTeamSelection, report],
  )
  const trendData = useMemo(
    () => (hasTeamSelection ? extractTrend(report, seasonId) : []),
    [hasTeamSelection, report, seasonId],
  )
  const spotlightInsights = useMemo(
    () => (hasTeamSelection ? extractSpotlightInsights(report) : null),
    [hasTeamSelection, report],
  )
  const showAllSeasonSpotlights = seasonId === null
  const activeSeasonLabel =
    seasonId === null
      ? 'All seasons'
      : (seasons.find((season) => season.season_id === seasonId)?.season_label ?? `Season ${seasonId}`)

  return (
    <section className="teams-section" id="teams" aria-label="Team insights workspace">
      <div className="teams-head">
        <p className="eyebrow">Teams workspace</p>
        <h2>Search any team to instantly uncover performance trends, matchup strengths, and tactical insights.</h2>
      </div>

      <div className="teams-layout">
        <aside className="teams-controls" aria-label="Team search controls">
          <div className="teams-search-form">
            <label className="teams-label" htmlFor="teams-search-input">
              Team search
            </label>
            <div className="teams-search-wrap">
              <input
                id="teams-search-input"
                value={queryText}
                onChange={(event) => {
                  setQueryText(event.target.value)
                  setSelectedTeam('')
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search team name, e.g. Vendsyssel 2"
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="team-suggestions"
              />
              {suggestionsVisible ? (
                <div className="teams-suggestions" id="team-suggestions">
                  {suggestions.length === 0 && !isLoadingSuggestions ? (
                    <p className="teams-empty">No team matches this search.</p>
                  ) : (
                    <ul>
                      {suggestions.map((item, index) => {
                        const isActive = index === resolvedActiveSuggestionIndex || item.name === selectedTeam
                        return (
                          <li key={item.name}>
                            <button
                              type="button"
                              className={isActive ? 'teams-suggestion-item active' : 'teams-suggestion-item'}
                              onMouseEnter={() => setActiveSuggestionIndex(index)}
                              onClick={() => applySuggestion(item)}
                            >
                              {item.name}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ) : null}

              {isLoadingSuggestions ? <p className="teams-search-status">Updating suggestions...</p> : null}
              {isLoadingReport ? <p className="teams-search-status">Refreshing charts...</p> : null}
            </div>

            <div className="teams-season-block">
              <label className="teams-label" htmlFor="teams-season-select">
                Season Filter
              </label>
              <select
                id="teams-season-select"
                value={seasonId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  const nextSeason = value ? Number(value) : null
                  setSeasonId(nextSeason)
                }}
              >
                <option value="">All seasons (full view)</option>
                {seasons.map((season) => (
                  <option key={season.season_id} value={season.season_id}>
                    {season.season_label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? <p className="teams-error">{error}</p> : null}
        </aside>

        <div className="teams-dashboard">
          {hasTeamSelection ? (
            <>
              <article className="workspace-context">
                <h3>{activeTeamName}</h3>
                <p>{activeSeasonLabel}</p>
              </article>

              <div className="teams-kpi-grid">
                {snapshot.map((metric) => (
                  <article key={metric.label} className="teams-kpi-card">
                    <p>{metric.label}</p>
                    <h3>{metric.value.toFixed(2)}%</h3>
                  </article>
                ))}
              </div>

              <div className="teams-chart-grid">
                <article
                  className={
                    isLoadingReport
                      ? 'teams-chart-card teams-chart-card-first teams-chart-card-loading'
                      : 'teams-chart-card teams-chart-card-first'
                  }
                >
                  <header>
                    <h3>Win Rate by Match Type</h3>
                    <p>Distribution across disciplines with wins/losses context.</p>
                  </header>
                  <div className="teams-chart-content">
                    <MatchTypeWinRateChart data={winRateData} />
                  </div>
                  {isLoadingReport ? (
                    <div className="teams-chart-shimmer" aria-hidden>
                      <span className="teams-shimmer-line line-one" />
                      <span className="teams-shimmer-line line-two" />
                      <span className="teams-shimmer-line line-three" />
                    </div>
                  ) : null}
                </article>

                {spotlightInsights ? (
                  <div className="teams-spotlight-grid" aria-label="Team spotlight insights">
                    <article className="teams-spotlight-card spotlight-player-volume">
                      <p className="teams-spotlight-kicker">Most Team Match Participations</p>
                      <h4>{spotlightInsights.mostGamesPlayer.name}</h4>
                      <p className="teams-spotlight-value">
                        {spotlightInsights.mostGamesPlayer.teamMatches} team matches
                      </p>
                      <p className="teams-spotlight-note">
                        Participation share: {spotlightInsights.participationPct.toFixed(1)}%
                      </p>
                      <SpotlightMeter
                        value={spotlightInsights.participationPct}
                        fill="#169369"
                        label="Team match participation share"
                      />
                    </article>

                    <article className="teams-spotlight-card spotlight-player-win">
                      <p className="teams-spotlight-kicker">Highest Player Win %</p>
                      <h4>{spotlightInsights.highestWinPctPlayer.name}</h4>
                      <p className="teams-spotlight-value">
                        {spotlightInsights.highestWinPctPlayer.winPct.toFixed(2)}% win rate
                      </p>
                      <p className="teams-spotlight-note">
                        Across {spotlightInsights.highestWinPctPlayer.individualMatches}{' '}
                        individual matches
                      </p>
                      <SpotlightMeter
                        value={spotlightInsights.highestWinPctPlayer.winPct}
                        fill="#0e7753"
                        label="Highest player win percentage"
                      />
                    </article>

                    {showAllSeasonSpotlights ? (
                      <>
                        <article className="teams-spotlight-card spotlight-opponent-best">
                          <p className="teams-spotlight-kicker">Best Opponent Matchup</p>
                          <h4>{spotlightInsights.bestOpponent.name}</h4>
                          <p className="teams-spotlight-value">
                            {spotlightInsights.bestOpponent.winPct.toFixed(2)}% team win rate
                          </p>
                          <p className="teams-spotlight-note">
                            From {spotlightInsights.bestOpponent.teamMatches} team matches
                          </p>
                          <SpotlightMeter
                            value={spotlightInsights.bestOpponent.winPct}
                            fill="#1a9d70"
                            label="Best opponent matchup win rate"
                          />
                        </article>

                        <article className="teams-spotlight-card spotlight-opponent-worst">
                          <p className="teams-spotlight-kicker">Most Difficult Opponent</p>
                          <h4>{spotlightInsights.worstOpponent.name}</h4>
                          <p className="teams-spotlight-value">
                            {spotlightInsights.worstOpponent.winPct.toFixed(2)}% team win rate
                          </p>
                          <p className="teams-spotlight-note">
                            From {spotlightInsights.worstOpponent.teamMatches} team matches
                          </p>
                          <SpotlightMeter
                            value={spotlightInsights.worstOpponent.winPct}
                            fill="#c7772f"
                            label="Worst opponent matchup win rate"
                          />
                        </article>
                      </>
                    ) : (
                      <article className="teams-spotlight-lock teams-spotlight-lock-wide" aria-live="polite">
                        <h4>Opponent spotlights</h4>
                        <p>
                          Select <strong>All seasons</strong> to show best and most difficult
                          opponent matchups.
                        </p>
                      </article>
                    )}
                  </div>
                ) : null}

                <article
                  className={
                    isLoadingReport
                      ? 'teams-chart-card teams-chart-card-second teams-chart-card-loading'
                      : 'teams-chart-card teams-chart-card-second'
                  }
                >
                  <header>
                    <h3>Recent Point Differential</h3>
                    <p>Positive values indicate scoring momentum over opponents.</p>
                  </header>
                  <div className="teams-chart-content">
                    <TeamFormTrendChart data={trendData} />
                  </div>
                  {isLoadingReport ? (
                    <div className="teams-chart-shimmer" aria-hidden>
                      <span className="teams-shimmer-line line-one" />
                      <span className="teams-shimmer-line line-two" />
                      <span className="teams-shimmer-line line-three" />
                    </div>
                  ) : null}
                </article>
              </div>
            </>
          ) : (
            <article className="workspace-empty" aria-live="polite">
              <h3>Select a team to generate visual insights</h3>
              <p>
                Use team search and pick a season. We will populate KPIs, charts, and matchup
                spotlights here.
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
