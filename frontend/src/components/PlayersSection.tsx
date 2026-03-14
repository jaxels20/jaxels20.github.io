import type { KeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AxisLeft } from '@visx/axis'
import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { scaleBand, scaleLinear, scalePoint } from '@visx/scale'
import { BarRounded, LinePath } from '@visx/shape'

import { fetchPlayerReport, fetchPlayerSuggestions, fetchSeasons } from '../api'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ReportBlock, ReportResponse, SearchResult } from '../types'

type TableBlock = Extract<ReportBlock, { type: 'table' }>

type SnapshotMetric = {
  label: string
  value: number
}

type DisciplineWinRateDatum = {
  label: string
  winPct: number
  matches: number
}

type TrendDatum = {
  label: string
  pointDelta: number
  result: string
  opponent: string
}

type RateSummary = {
  name: string
  matches: number
  winPct: number
}

type DisciplineSummary = {
  label: string
  matches: number
  winPct: number
  participationPct: number
}

type PlayerSpotlights = {
  mostPlayedDiscipline: DisciplineSummary
  bestPartner: RateSummary
  bestOpponent: RateSummary
  toughestOpponent: RateSummary
}

const DISCIPLINE_ORDER_INDEX: Record<string, number> = {
  MD: 0,
  DS: 1,
  HS: 2,
  DD: 3,
  HD: 4,
}

const FALLBACK_SNAPSHOT: SnapshotMetric[] = [
  { label: 'Match Win %', value: 56.52 },
  { label: 'Set Win %', value: 53.17 },
  { label: 'Point Win %', value: 51.22 },
  { label: '3-Set Win %', value: 62.5 },
]

const FALLBACK_DISCIPLINE_WIN_RATE: DisciplineWinRateDatum[] = [
  { label: 'HS', winPct: 61.1, matches: 18 },
  { label: 'DS', winPct: 58.3, matches: 12 },
  { label: 'HD', winPct: 50, matches: 20 },
  { label: 'DD', winPct: 48, matches: 10 },
  { label: 'MD', winPct: 55.6, matches: 9 },
]

const FALLBACK_TREND: TrendDatum[] = [
  { label: 'R1-hs', pointDelta: -8, result: 'L', opponent: 'Opponent' },
  { label: 'R2-hs', pointDelta: 17, result: 'W', opponent: 'Opponent' },
  { label: 'R3-hd', pointDelta: 6, result: 'W', opponent: 'Opponent' },
  { label: 'R4-hd', pointDelta: -5, result: 'L', opponent: 'Opponent' },
  { label: 'R5-md', pointDelta: 12, result: 'W', opponent: 'Opponent' },
  { label: 'R6-hs', pointDelta: 10, result: 'W', opponent: 'Opponent' },
]

const FALLBACK_SPOTLIGHTS: PlayerSpotlights = {
  mostPlayedDiscipline: {
    label: 'HD',
    matches: 20,
    winPct: 50,
    participationPct: 29.9,
  },
  bestPartner: {
    name: 'Emil Bak',
    matches: 11,
    winPct: 72.73,
  },
  bestOpponent: {
    name: 'Aarhus Akademisk',
    matches: 4,
    winPct: 75,
  },
  toughestOpponent: {
    name: 'Viborg',
    matches: 5,
    winPct: 20,
  },
}

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
    ['win_pct', 'Match Win %'],
    ['set_win_pct', 'Set Win %'],
    ['point_win_pct', 'Point Win %'],
    ['three_set_win_pct', '3-Set Win %'],
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

function extractDisciplineWinRate(report: ReportResponse | null): DisciplineWinRateDatum[] {
  if (!report) {
    return FALLBACK_DISCIPLINE_WIN_RATE
  }

  const table = findTableByHeading(report.blocks, /Discipline Pivot/i)
  if (!table || table.rows.length === 0) {
    return FALLBACK_DISCIPLINE_WIN_RATE
  }

  const metricHeaderIndex = table.headers.findIndex((header) => header.trim().toLowerCase() === 'metric')
  if (metricHeaderIndex < 0) {
    return FALLBACK_DISCIPLINE_WIN_RATE
  }

  const winPctRow = table.rows.find((row) => row[metricHeaderIndex]?.trim().toLowerCase() === 'win_pct')
  const matchesRow = table.rows.find((row) => row[metricHeaderIndex]?.trim().toLowerCase() === 'matches')
  if (!winPctRow || !matchesRow) {
    return FALLBACK_DISCIPLINE_WIN_RATE
  }

  const data: DisciplineWinRateDatum[] = []
  for (let index = 0; index < table.headers.length; index += 1) {
    const header = table.headers[index].trim().toLowerCase()
    if (!header || header === 'metric' || header === 'overall') {
      continue
    }

    const matches = parseNumericCell(matchesRow[index] ?? '')
    const winPct = parseNumericCell(winPctRow[index] ?? '')
    if (matches === null || winPct === null) {
      continue
    }

    data.push({
      label: header.toUpperCase(),
      matches,
      winPct: Math.max(0, Math.min(100, winPct)),
    })
  }

  if (data.length === 0) {
    return FALLBACK_DISCIPLINE_WIN_RATE
  }

  return data.sort((left, right) => {
    const leftIndex = DISCIPLINE_ORDER_INDEX[left.label] ?? 99
    const rightIndex = DISCIPLINE_ORDER_INDEX[right.label] ?? 99
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }
    return left.label.localeCompare(right.label)
  })
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

  const table = findTableByHeading(report.blocks, /Recent Matches/i)
  if (!table) {
    return FALLBACK_TREND
  }

  const rows = table.rows
    .map((rawRow) => {
      const row = rowToObject(table.headers, rawRow)
      const pointDelta = parsePointScore(row.points_result ?? '')
      if (pointDelta === null) {
        return null
      }

      const seasonValue = parseNumericCell(row.season_id ?? '')
      const roundValue = parseNumericCell(row.round_no ?? '')

      return {
        season: seasonValue,
        round: roundValue,
        pointDelta,
        opponent: (row.opponent_team || '').trim() || 'Unknown opponent',
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

  return aggregated.length > 0 ? aggregated.slice(-12) : FALLBACK_TREND
}

function extractSpotlights(report: ReportResponse | null): PlayerSpotlights {
  if (!report) {
    return FALLBACK_SPOTLIGHTS
  }

  const overallTable = findTableByHeading(report.blocks, /Overall Summary/i)
  const disciplineTable = findTableByHeading(report.blocks, /Discipline Pivot/i)
  const topPartnersTable = findTableByHeading(report.blocks, /Top Partners/i)
  const opponentTable = findTableByHeading(report.blocks, /Opponent Breakdown/i)

  if (!overallTable || !disciplineTable || !topPartnersTable || !opponentTable) {
    return FALLBACK_SPOTLIGHTS
  }

  const overallRow = overallTable.rows[0] ? rowToObject(overallTable.headers, overallTable.rows[0]) : null
  const totalMatches = overallRow ? parseNumericCell(overallRow.matches_played ?? '') : null

  const disciplineData = extractDisciplineWinRate(report)
  const mostPlayedDiscipline = disciplineData.reduce((best, current) =>
    current.matches > best.matches ? current : best
  )

  const mostPlayedSummary: DisciplineSummary = {
    label: mostPlayedDiscipline.label,
    matches: mostPlayedDiscipline.matches,
    winPct: mostPlayedDiscipline.winPct,
    participationPct:
      totalMatches && totalMatches > 0
        ? Math.max(0, Math.min(100, (mostPlayedDiscipline.matches / totalMatches) * 100))
        : FALLBACK_SPOTLIGHTS.mostPlayedDiscipline.participationPct,
  }

  const partners = topPartnersTable.rows
    .map((rawRow) => {
      const row = rowToObject(topPartnersTable.headers, rawRow)
      const name = (row.partner_name || '').trim()
      const matches = parseNumericCell(row.matches_together ?? '')
      const winPct = parseNumericCell(row.win_pct_together ?? '')
      if (!name || matches === null || winPct === null) {
        return null
      }
      return {
        name,
        matches,
        winPct: Math.max(0, Math.min(100, winPct)),
      }
    })
    .filter((item): item is RateSummary => item !== null)

  const opponents = opponentTable.rows
    .map((rawRow) => {
      const row = rowToObject(opponentTable.headers, rawRow)
      const name = (row.opponent_team_name || '').trim()
      const matches = parseNumericCell(row.matches_against ?? '')
      const winPct = parseNumericCell(row.win_pct ?? '')
      if (!name || matches === null || winPct === null) {
        return null
      }
      return {
        name,
        matches,
        winPct: Math.max(0, Math.min(100, winPct)),
      }
    })
    .filter((item): item is RateSummary => item !== null)

  const partnerEligible = partners.filter((item) => item.matches >= 3)
  const partnerSource = partnerEligible.length > 0 ? partnerEligible : partners
  const bestPartner =
    partnerSource.length > 0
      ? partnerSource.reduce((best, current) => {
          if (current.winPct > best.winPct) {
            return current
          }
          if (current.winPct === best.winPct && current.matches > best.matches) {
            return current
          }
          return best
        })
      : FALLBACK_SPOTLIGHTS.bestPartner

  const opponentEligible = opponents.filter((item) => item.matches >= 2)
  const opponentSource = opponentEligible.length > 0 ? opponentEligible : opponents
  const bestOpponent =
    opponentSource.length > 0
      ? opponentSource.reduce((best, current) => (current.winPct > best.winPct ? current : best))
      : FALLBACK_SPOTLIGHTS.bestOpponent

  const toughestOpponent =
    opponentSource.length > 0
      ? opponentSource.reduce((best, current) => (current.winPct < best.winPct ? current : best))
      : FALLBACK_SPOTLIGHTS.toughestOpponent

  return {
    mostPlayedDiscipline: mostPlayedSummary,
    bestPartner,
    bestOpponent,
    toughestOpponent,
  }
}

function SpotlightMeter({ value, fill, label }: { value: number; fill: string; label: string }) {
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

function DisciplineWinRateChart({ data }: { data: DisciplineWinRateDatum[] }) {
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
    <svg className="teams-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player win rate by discipline">
      <defs>
        <linearGradient id="players-bars-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1aa777" />
          <stop offset="100%" stopColor="#0f684a" />
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
              fill="url(#players-bars-gradient)"
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
            <g key={`discipline-label-${item.label}`}>
              <text x={x} y={innerHeight + 18} textAnchor="middle" className="teams-axis-label">
                {item.label}
              </text>
              <text x={x} y={innerHeight + 34} textAnchor="middle" className="teams-axis-subtle">
                {item.matches} matches
              </text>
            </g>
          )
        })}
      </Group>
    </svg>
  )
}

function PlayerTrendChart({ data }: { data: TrendDatum[] }) {
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
      <svg className="teams-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player point differential trend">
        <defs>
          <linearGradient id="players-line-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0f6f4e" />
            <stop offset="100%" stopColor="#d89d2c" />
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
            stroke="url(#players-line-gradient)"
            strokeWidth={3.5}
          />

          {data.map((item, index) => {
            const x = xScale(item.label) ?? 0
            const y = yScale(item.pointDelta)
            const positive = item.result.toUpperCase() === 'W' || item.pointDelta >= 0
            const isHovered = hoveredIndex === index
            return (
              <g key={`player-trend-${item.label}`}>
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

export function PlayersSection() {
  const [queryText, setQueryText] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [seasons, setSeasons] = useState<{ season_id: number; season_label: string }[]>([])
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(queryText, 220)

  const activePlayerName = selectedPlayer.trim()
  const hasPlayerSelection = activePlayerName.length >= 2
  const suggestionsVisible = debouncedSearch.trim().length >= 2 && selectedPlayer !== debouncedSearch.trim()
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
        const response = await fetchPlayerSuggestions({
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

  const loadPlayerReport = async (playerName: string, selectedSeason: number | null) => {
    setError(null)
    setIsLoadingReport(true)
    try {
      const response = await fetchPlayerReport({ name: playerName, seasonId: selectedSeason })
      setReport(response)
      setQueryText(playerName)
      setSelectedPlayer(playerName)
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unable to load report.'
      setError(message)
    } finally {
      setIsLoadingReport(false)
    }
  }

  useEffect(() => {
    if (activePlayerName.length < 2) {
      return
    }

    void loadPlayerReport(activePlayerName, seasonId)
  }, [activePlayerName, seasonId])

  const applySuggestion = (item: SearchResult) => {
    setSelectedPlayer(item.name)
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
        const typedPlayerName = queryText.trim()
        if (typedPlayerName.length >= 2) {
          setSelectedPlayer(typedPlayerName)
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
    () => (hasPlayerSelection ? extractSnapshot(report) : []),
    [hasPlayerSelection, report],
  )
  const disciplineWinRate = useMemo(
    () => (hasPlayerSelection ? extractDisciplineWinRate(report) : []),
    [hasPlayerSelection, report],
  )
  const trendData = useMemo(
    () => (hasPlayerSelection ? extractTrend(report, seasonId) : []),
    [hasPlayerSelection, report, seasonId],
  )
  const spotlights = useMemo(
    () => (hasPlayerSelection ? extractSpotlights(report) : null),
    [hasPlayerSelection, report],
  )
  const activeSeasonLabel =
    seasonId === null
      ? 'All seasons'
      : (seasons.find((season) => season.season_id === seasonId)?.season_label ?? `Season ${seasonId}`)

  return (
    <section className="teams-section players-section" id="players" aria-label="Player insights workspace">
      <div className="teams-head">
        <p className="eyebrow">Players workspace</p>
        <h2>Search any player to reveal form trends, discipline strengths, and matchup intelligence.</h2>
      </div>

      <div className="teams-layout">
        <aside className="teams-controls" aria-label="Player search controls">
          <div className="teams-search-form">
            <label className="teams-label" htmlFor="players-search-input">
              Player search
            </label>
            <div className="teams-search-wrap">
              <input
                id="players-search-input"
                value={queryText}
                onChange={(event) => {
                  setQueryText(event.target.value)
                  setSelectedPlayer('')
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search player name, e.g. Anna Simonsen"
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="player-suggestions"
              />
              {suggestionsVisible ? (
                <div className="teams-suggestions" id="player-suggestions">
                  {suggestions.length === 0 && !isLoadingSuggestions ? (
                    <p className="teams-empty">No player matches this search.</p>
                  ) : (
                    <ul>
                      {suggestions.map((item, index) => {
                        const isActive = index === resolvedActiveSuggestionIndex || item.name === selectedPlayer
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
              <label className="teams-label" htmlFor="players-season-select">
                Season Filter
              </label>
              <p id="players-season-hint" className="teams-season-hint">
                Switch between seasons to instantly refresh the player profile and charts.
              </p>
              <select
                id="players-season-select"
                aria-describedby="players-season-hint"
                value={seasonId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  const nextSeason = value ? Number(value) : null
                  setSeasonId(nextSeason)
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

          {error ? <p className="teams-error">{error}</p> : null}
        </aside>

        <div className="teams-dashboard">
          {hasPlayerSelection ? (
            <>
              <article className="workspace-context">
                <span className="workspace-context-kicker">Current player view</span>
                <h3>{activePlayerName}</h3>
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
                    <h3>Win Rate by Discipline</h3>
                    <p>Performance profile across singles, doubles, and mixed formats.</p>
                  </header>
                  <div className="teams-chart-content">
                    <DisciplineWinRateChart data={disciplineWinRate} />
                  </div>
                  {isLoadingReport ? (
                    <div className="teams-chart-shimmer" aria-hidden>
                      <span className="teams-shimmer-line line-one" />
                      <span className="teams-shimmer-line line-two" />
                      <span className="teams-shimmer-line line-three" />
                    </div>
                  ) : null}
                </article>

                {spotlights ? (
                  <div className="teams-spotlight-grid" aria-label="Player spotlight insights">
                    <article className="teams-spotlight-card spotlight-player-volume">
                      <p className="teams-spotlight-kicker">Most Played Discipline</p>
                      <h4>{spotlights.mostPlayedDiscipline.label}</h4>
                      <p className="teams-spotlight-value">{spotlights.mostPlayedDiscipline.matches} matches</p>
                      <p className="teams-spotlight-note">
                        Win rate: {spotlights.mostPlayedDiscipline.winPct.toFixed(2)}%
                      </p>
                      <SpotlightMeter
                        value={spotlights.mostPlayedDiscipline.participationPct}
                        fill="#169369"
                        label="Most played discipline participation"
                      />
                    </article>

                    <article className="teams-spotlight-card spotlight-player-win">
                      <p className="teams-spotlight-kicker">Best Partner Chemistry</p>
                      <h4>{spotlights.bestPartner.name}</h4>
                      <p className="teams-spotlight-value">
                        {spotlights.bestPartner.winPct.toFixed(2)}% win rate
                      </p>
                      <p className="teams-spotlight-note">
                        Across {spotlights.bestPartner.matches} matches together
                      </p>
                      <SpotlightMeter
                        value={spotlights.bestPartner.winPct}
                        fill="#0e7753"
                        label="Best partner win rate"
                      />
                    </article>

                    <article className="teams-spotlight-card spotlight-opponent-best">
                      <p className="teams-spotlight-kicker">Best Opponent Matchup</p>
                      <h4>{spotlights.bestOpponent.name}</h4>
                      <p className="teams-spotlight-value">
                        {spotlights.bestOpponent.winPct.toFixed(2)}% win rate
                      </p>
                      <p className="teams-spotlight-note">Across {spotlights.bestOpponent.matches} matches</p>
                      <SpotlightMeter
                        value={spotlights.bestOpponent.winPct}
                        fill="#1a9d70"
                        label="Best opponent win rate"
                      />
                    </article>

                    <article className="teams-spotlight-card spotlight-opponent-worst">
                      <p className="teams-spotlight-kicker">Most Difficult Opponent</p>
                      <h4>{spotlights.toughestOpponent.name}</h4>
                      <p className="teams-spotlight-value">
                        {spotlights.toughestOpponent.winPct.toFixed(2)}% win rate
                      </p>
                      <p className="teams-spotlight-note">Across {spotlights.toughestOpponent.matches} matches</p>
                      <SpotlightMeter
                        value={spotlights.toughestOpponent.winPct}
                        fill="#c7772f"
                        label="Most difficult opponent win rate"
                      />
                    </article>
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
                    <p>Momentum curve from recent player matches.</p>
                  </header>
                  <div className="teams-chart-content">
                    <PlayerTrendChart data={trendData} />
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
              <h3>Select a player to generate visual insights</h3>
              <p>
                Use player search and a season filter to populate profile KPIs, discipline charts,
                and matchup spotlights.
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
