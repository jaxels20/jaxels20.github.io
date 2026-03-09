import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

type ReportMode = 'player' | 'team'

type ReportBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][]; row_count: string | null }

type ReportResponse = {
  report_type: string
  title: string
  subject: string
  season_id: number | null
  generated_at: string
  blocks: ReportBlock[]
}

type SearchResult = { name: string }

type SeasonsResponse = {
  results: { season_id: number; season_label: string }[]
}

const API_BASE = '/api'

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

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

function ReportViewer({ report }: { report: ReportResponse }) {
  return (
    <section className="report-shell">
      <header className="report-header">
        <h2>{report.title}</h2>
        <p>
          <strong>{report.subject}</strong>
          {report.season_id ? ` · Season ${report.season_id}` : ' · All Seasons'}
        </p>
      </header>

      {report.blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <div key={`h-${idx}`} className="section-title">
              {block.text}
            </div>
          )
        }

        if (block.type === 'paragraph') {
          return (
            <p key={`p-${idx}`} className="report-note">
              {block.text}
            </p>
          )
        }

        return (
          <article key={`t-${idx}`} className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIdx) => (
                      <th key={`${idx}-${headerIdx}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIdx) => (
                    <tr key={`${idx}-r-${rowIdx}`}>
                      {row.map((cell, cellIdx) => (
                        <td key={`${idx}-r-${rowIdx}-c-${cellIdx}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {block.row_count ? <div className="row-count">{block.row_count}</div> : null}
          </article>
        )
      })}
    </section>
  )
}

function App() {
  const [mode, setMode] = useState<ReportMode>('player')
  const [queryText, setQueryText] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [selectedName, setSelectedName] = useState<string>('')
  const [activeReport, setActiveReport] = useState<ReportResponse | null>(null)

  const debouncedSearch = useDebouncedValue(queryText, 250)

  const seasonsQuery = useQuery({
    queryKey: ['seasons'],
    queryFn: () => fetchJson<SeasonsResponse>(`${API_BASE}/seasons`),
  })

  const searchQuery = useQuery({
    queryKey: ['search', mode, debouncedSearch, seasonId],
    queryFn: () => {
      const params = new URLSearchParams({
        q: debouncedSearch,
        limit: '12',
      })
      if (seasonId !== null) {
        params.set('season_id', String(seasonId))
      }

      return fetchJson<{ results: SearchResult[] }>(
        `${API_BASE}/search/${mode === 'player' ? 'players' : 'teams'}?${params.toString()}`
      )
    },
    enabled: debouncedSearch.trim().length >= 2,
  })

  const reportMutation = useMutation({
    mutationFn: (payload: { name: string; season_id: number | null }) =>
      fetchJson<ReportResponse>(`${API_BASE}/reports/${mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setActiveReport(data)
    },
  })

  const suggestions = searchQuery.data?.results ?? []

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = (selectedName || queryText).trim()
    if (!name) {
      return
    }
    reportMutation.mutate({ name, season_id: seasonId })
  }

  return (
    <div className="app-root">
      <div className="bg-ornament" />
      <main className="page">
        <header className="hero">
          <p className="eyebrow">Data Warehouse Reports</p>
          <h1>Badminton Team & Player Analytics</h1>
          <p>
            Search a player or team, pick season, and render complete report tables directly in
            the browser.
          </p>
        </header>

        <section className="control-panel">
          <div className="mode-toggle">
            <button
              className={mode === 'player' ? 'active' : ''}
              type="button"
              onClick={() => {
                setMode('player')
                setSelectedName('')
                setActiveReport(null)
              }}
            >
              Player Report
            </button>
            <button
              className={mode === 'team' ? 'active' : ''}
              type="button"
              onClick={() => {
                setMode('team')
                setSelectedName('')
                setActiveReport(null)
              }}
            >
              Team Report
            </button>
          </div>

          <form onSubmit={onSubmit} className="search-form">
            <label>
              {mode === 'player' ? 'Player Name' : 'Team Name'}
              <input
                value={queryText}
                onChange={(event) => {
                  setQueryText(event.target.value)
                  setSelectedName('')
                }}
                placeholder={mode === 'player' ? 'e.g. Anna Simonsen' : 'e.g. Vendsyssel 2'}
              />
            </label>

            <label>
              Season
              <select
                value={seasonId ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setSeasonId(value ? Number(value) : null)
                }}
              >
                <option value="">All seasons</option>
                {(seasonsQuery.data?.results ?? []).map((season) => (
                  <option key={season.season_id} value={season.season_id}>
                    {season.season_label}
                  </option>
                ))}
              </select>
            </label>

            <button className="submit-btn" type="submit" disabled={reportMutation.isPending}>
              {reportMutation.isPending ? 'Generating...' : 'Generate Report'}
            </button>
          </form>

          {debouncedSearch.trim().length >= 2 ? (
            <div className="suggestions">
              <div className="suggestions-head">
                <span>Suggestions</span>
                {searchQuery.isFetching ? <small>Updating...</small> : null}
              </div>

              <div className="chips">
                {suggestions.length === 0 && !searchQuery.isFetching ? (
                  <span className="empty-chip">No matches yet</span>
                ) : null}

                {suggestions.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    className={selectedName === item.name ? 'chip active' : 'chip'}
                    onClick={() => {
                      setSelectedName(item.name)
                      setQueryText(item.name)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {reportMutation.error ? (
            <p className="error-text">{(reportMutation.error as Error).message}</p>
          ) : null}
        </section>

        <section className="content-area">
          {activeReport ? (
            <ReportViewer report={activeReport} />
          ) : (
            <div className="placeholder-card">
              <h3>Ready to explore</h3>
              <p>
                Start with at least two letters in the search box, choose a suggestion, and click
                <strong> Generate Report</strong>.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
