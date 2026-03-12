import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { fetchReport, fetchSeasons, fetchSuggestions } from '../api'
import { ReportRenderer } from '../components/ReportRenderer'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ReportMode, ReportResponse } from '../types'

function parseMode(value: string | null): ReportMode {
  if (value === 'team') {
    return 'team'
  }
  return 'player'
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode = useMemo(() => parseMode(searchParams.get('mode')), [searchParams])

  const [mode, setMode] = useState<ReportMode>(initialMode)
  const [queryText, setQueryText] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [selectedName, setSelectedName] = useState<string>('')
  const [activeReport, setActiveReport] = useState<ReportResponse | null>(null)

  const debouncedSearch = useDebouncedValue(queryText, 220)

  const seasonsQuery = useQuery({
    queryKey: ['seasons'],
    queryFn: fetchSeasons,
  })

  const searchQuery = useQuery({
    queryKey: ['search', mode, debouncedSearch, seasonId],
    queryFn: () =>
      fetchSuggestions({
        mode,
        query: debouncedSearch,
        seasonId,
      }),
    enabled: debouncedSearch.trim().length >= 2,
  })

  const reportMutation = useMutation({
    mutationFn: (payload: { mode: ReportMode; name: string; seasonId: number | null }) =>
      fetchReport(payload),
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

    reportMutation.mutate({
      mode,
      name,
      seasonId,
    })
  }

  const modeLabel = mode === 'player' ? 'Player Name' : 'Team Name'

  return (
    <main className="page reports-page">
      <section className="hero hero-compact">
        <p className="eyebrow">Report Workspace</p>
        <h1>Generate and inspect advanced performance reports</h1>
      </section>

      <section className="workspace-grid">
        <aside className="control-panel">
          <div className="mode-toggle">
            <button
              className={mode === 'player' ? 'active' : ''}
              type="button"
              onClick={() => {
                setMode('player')
                setSelectedName('')
                setActiveReport(null)
                setSearchParams({ mode: 'player' })
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
                setSearchParams({ mode: 'team' })
              }}
            >
              Team Report
            </button>
          </div>

          <form onSubmit={onSubmit} className="search-form">
            <label>
              {modeLabel}
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  value={queryText}
                  onChange={(event) => {
                    setQueryText(event.target.value)
                    setSelectedName('')
                  }}
                  placeholder={mode === 'player' ? 'e.g. Anna Simonsen' : 'e.g. Vendsyssel 2'}
                />
              </div>
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
              {reportMutation.isPending ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  Generating
                </>
              ) : (
                'Generate Report'
              )}
            </button>
          </form>

          {debouncedSearch.trim().length >= 2 ? (
            <div className="suggestions">
              <div className="suggestions-head">
                <span>Suggestions</span>
                {searchQuery.isFetching ? <small>Refreshing...</small> : null}
              </div>

              <div className="chips">
                {suggestions.length === 0 && !searchQuery.isFetching ? (
                  <span className="empty-chip">No matches</span>
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
        </aside>

        <section className="content-area">
          {activeReport ? (
            <ReportRenderer report={activeReport} />
          ) : (
            <div className="placeholder-card">
              <h3>Pick a player or team to get started</h3>
              <p>
                Search, choose suggestion, and generate. Your report will render in a clean,
                interactive table view.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
