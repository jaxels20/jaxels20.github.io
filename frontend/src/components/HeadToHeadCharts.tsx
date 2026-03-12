import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { ReportBlock, ReportResponse } from '../types'

type TableBlock = Extract<ReportBlock, { type: 'table' }>

function formatPercent(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    return String(value ?? '-')
  }
  return `${num.toFixed(2)}%`
}

function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-') {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function tableRowsAsObjects(table: TableBlock): Array<Record<string, string>> {
  return table.rows.map((row) => {
    const result: Record<string, string> = {}
    table.headers.forEach((header, idx) => {
      result[header] = row[idx] ?? ''
    })
    return result
  })
}

function findTable(
  report: ReportResponse,
  predicate: (table: TableBlock) => boolean
): TableBlock | null {
  for (const block of report.blocks) {
    if (block.type !== 'table') {
      continue
    }
    if (predicate(block)) {
      return block
    }
  }
  return null
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

const MATCH_TYPE_ORDER_INDEX: Map<string, number> = new Map(
  MATCH_TYPE_ORDER.map((matchType, idx) => [matchType, idx] as [string, number])
)

function normalizeMatchType(value: string): string {
  return value.trim().toLowerCase().replace(',', '.')
}

function compareMatchType(a: string, b: string): number {
  const normalizedA = normalizeMatchType(a)
  const normalizedB = normalizeMatchType(b)

  const indexA = MATCH_TYPE_ORDER_INDEX.get(normalizedA)
  const indexB = MATCH_TYPE_ORDER_INDEX.get(normalizedB)

  if (indexA !== undefined && indexB !== undefined) {
    return indexA - indexB
  }
  if (indexA !== undefined) {
    return -1
  }
  if (indexB !== undefined) {
    return 1
  }

  return normalizedA.localeCompare(normalizedB)
}

function ChartLegend({
  series,
}: {
  series: ReadonlyArray<{ key: string; label: string; color: string }>
}) {
  return (
    <div className="chart-legend">
      {series.map((item) => (
        <span key={item.key} className="chart-legend-item">
          <span className="chart-legend-swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function HeadToHeadCharts({ report }: { report: ReportResponse }) {
  const overallTable = findTable(
    report,
    (table) =>
      table.headers.includes('team_code') &&
      table.headers.includes('team_name') &&
      table.headers.includes('team_match_win_pct')
  )

  const disciplineTable = findTable(
    report,
    (table) =>
      table.headers.includes('discipline_code') &&
      table.headers.includes('team_a_win_pct') &&
      table.headers.includes('team_b_win_pct')
  )

  const matchTypeTable = findTable(
    report,
    (table) =>
      table.headers.includes('match_type') &&
      table.headers.includes('team_a_win_pct') &&
      table.headers.includes('team_b_win_pct')
  )

  if (!overallTable || !disciplineTable) {
    return null
  }

  const overallRows = tableRowsAsObjects(overallTable)
  const teamARow = overallRows.find((row) => row.team_code === 'A')
  const teamBRow = overallRows.find((row) => row.team_code === 'B')

  if (!teamARow || !teamBRow) {
    return null
  }

  const teamAName = teamARow.team_name || 'Team A'
  const teamBName = teamBRow.team_name || 'Team B'

  const series = [
    { key: 'teamA', label: teamAName, color: '#155f8f' },
    { key: 'teamB', label: teamBName, color: '#16907e' },
  ] as const

  const comparisonData = [
    {
      metric: 'Team Match Win %',
      teamA: toNumber(teamARow.team_match_win_pct) ?? 0,
      teamB: toNumber(teamBRow.team_match_win_pct) ?? 0,
    },
    {
      metric: 'Individual Win %',
      teamA: toNumber(teamARow.individual_win_pct) ?? 0,
      teamB: toNumber(teamBRow.individual_win_pct) ?? 0,
    },
    {
      metric: 'Set Win %',
      teamA: toNumber(teamARow.set_win_pct) ?? 0,
      teamB: toNumber(teamBRow.set_win_pct) ?? 0,
    },
    {
      metric: 'Point Win %',
      teamA: toNumber(teamARow.point_win_pct) ?? 0,
      teamB: toNumber(teamBRow.point_win_pct) ?? 0,
    },
  ]

  const disciplineData = tableRowsAsObjects(disciplineTable).map((row) => ({
    discipline: row.discipline_code,
    teamA: toNumber(row.team_a_win_pct) ?? 0,
    teamB: toNumber(row.team_b_win_pct) ?? 0,
  }))

  const matchTypeData = matchTypeTable
    ? tableRowsAsObjects(matchTypeTable)
        .map((row) => ({
          matchType: normalizeMatchType(row.match_type),
          teamA: toNumber(row.team_a_win_pct) ?? 0,
          teamB: toNumber(row.team_b_win_pct) ?? 0,
        }))
        .sort((a, b) => compareMatchType(a.matchType, b.matchType))
    : []

  return (
    <section className="charts-grid">
      <article className="chart-card">
        <header>
          <h3>Core Performance Comparison</h3>
          <p>{teamAName} vs {teamBName}</p>
        </header>
        <ChartLegend series={series} />
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={comparisonData}
              margin={{ top: 14, right: 18, left: 4, bottom: 34 }}
              barCategoryGap="28%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="metric"
                tick={{ fontSize: 12 }}
                tickMargin={10}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={52}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => formatPercent(value)} />
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={item.color}
                  radius={[6, 6, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="chart-card">
        <header>
          <h3>Discipline Win Rate %</h3>
          <p>Strength/weakness by discipline</p>
        </header>
        <ChartLegend series={series} />
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={disciplineData}
              margin={{ top: 14, right: 18, left: 4, bottom: 14 }}
              barCategoryGap="30%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="discipline" tick={{ fontSize: 12 }} tickMargin={10} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => formatPercent(value)} />
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={item.color}
                  radius={[6, 6, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      {matchTypeData.length > 0 ? (
        <article className="chart-card chart-card-wide">
          <header>
            <h3>Match-Type Win Rate %</h3>
            <p>Ordered as md, ds, hs, dd, hd lineup slots for easier comparison</p>
          </header>
          <ChartLegend series={series} />
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={matchTypeData}
                layout="vertical"
                margin={{ top: 14, right: 18, left: 8, bottom: 8 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="matchType"
                  width={64}
                  tick={{ fontSize: 12 }}
                  tickMargin={8}
                />
                <Tooltip formatter={(value) => formatPercent(value)} />
                {series.map((item) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    fill={item.color}
                    radius={[0, 6, 6, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      ) : null}
    </section>
  )
}
