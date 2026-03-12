import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, LoaderCircle, Search } from 'lucide-react'

import { fetchSeasons, fetchSuggestions, fetchTeamHeadToHeadReport } from '../api'
import { HeadToHeadCharts } from '../components/HeadToHeadCharts'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { ReportResponse } from '../types'

export function HeadToHeadPage() {
  const [teamAInput, setTeamAInput] = useState('')
  const [teamBInput, setTeamBInput] = useState('')
  const [selectedTeamA, setSelectedTeamA] = useState('')
  const [selectedTeamB, setSelectedTeamB] = useState('')
  const [seasonId, setSeasonId] = useState<number | null>(2025)
  const [activeReport, setActiveReport] = useState<ReportResponse | null>(null)

  const debouncedA = useDebouncedValue(teamAInput, 220)
  const debouncedB = useDebouncedValue(teamBInput, 220)

  const seasonsQuery = useQuery({
    queryKey: ['seasons'],
    queryFn: fetchSeasons,
  })

  const teamASearch = useQuery({
    queryKey: ['team-h2h-search-a', debouncedA, seasonId],
    queryFn: () => fetchSuggestions({ mode: 'team', query: debouncedA, seasonId, limit: 10 }),
    enabled: debouncedA.trim().length >= 2,
  })

  const teamBSearch = useQuery({
    queryKey: ['team-h2h-search-b', debouncedB, seasonId],
    queryFn: () => fetchSuggestions({ mode: 'team', query: debouncedB, seasonId, limit: 10 }),
    enabled: debouncedB.trim().length >= 2,
  })

  const reportMutation = useMutation({
    mutationFn: (payload: { teamA: string; teamB: string; seasonId: number | null }) =>
      fetchTeamHeadToHeadReport(payload),
    onSuccess: (data) => {
      setActiveReport(data)
    },
  })

  const teamASuggestions = teamASearch.data?.results ?? []
  const teamBSuggestions = teamBSearch.data?.results ?? []

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const teamA = (selectedTeamA || teamAInput).trim()
    const teamB = (selectedTeamB || teamBInput).trim()

    if (!teamA || !teamB) {
      return
    }

    reportMutation.mutate({ teamA, teamB, seasonId })
  }

  return (
    <main className="page reports-page">
      <section className="hero hero-compact">
        <p className="eyebrow">Head-to-Head Lab</p>
        <h1>Team vs Team comparison with strengths and weaknesses</h1>
      </section>

      <section className="workspace-grid">
        <aside className="control-panel">
          <form onSubmit={onSubmit} className="search-form h2h-form">
            <label>
              Team A
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  value={teamAInput}
                  onChange={(event) => {
                    setTeamAInput(event.target.value)
                    setSelectedTeamA('')
                  }}
                  placeholder="e.g. Vendsyssel 2"
                />
              </div>
            </label>

            {debouncedA.trim().length >= 2 ? (
              <div className="chips chips-inline">
                {teamASuggestions.slice(0, 6).map((item) => (
                  <button
                    type="button"
                    key={`a-${item.name}`}
                    className={selectedTeamA === item.name ? 'chip active' : 'chip'}
                    onClick={() => {
                      setSelectedTeamA(item.name)
                      setTeamAInput(item.name)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="h2h-divider" aria-hidden>
              <span>
                <ArrowRightLeft size={14} />
              </span>
            </div>

            <label>
              Team B
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  value={teamBInput}
                  onChange={(event) => {
                    setTeamBInput(event.target.value)
                    setSelectedTeamB('')
                  }}
                  placeholder="e.g. Christiansbjerg"
                />
              </div>
            </label>

            {debouncedB.trim().length >= 2 ? (
              <div className="chips chips-inline">
                {teamBSuggestions.slice(0, 6).map((item) => (
                  <button
                    type="button"
                    key={`b-${item.name}`}
                    className={selectedTeamB === item.name ? 'chip active' : 'chip'}
                    onClick={() => {
                      setSelectedTeamB(item.name)
                      setTeamBInput(item.name)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : null}

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
                  Comparing
                </>
              ) : (
                'Generate Head-to-Head'
              )}
            </button>
          </form>

          {reportMutation.error ? (
            <p className="error-text">{(reportMutation.error as Error).message}</p>
          ) : null}
        </aside>

        <section className="content-area">
          {activeReport ? (
            <HeadToHeadCharts report={activeReport} />
          ) : (
            <div className="placeholder-card">
              <h3>Compare any two teams</h3>
              <p>
                Select Team A and Team B to generate a full head-to-head report including delta
                metrics, discipline edges, and common-opponent comparison.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
