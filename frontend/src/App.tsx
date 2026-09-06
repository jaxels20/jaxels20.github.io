import { lazy } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { usePageTitle } from './hooks/usePageTitle'
import { HomePage } from './pages/HomePage'

// Every page but the front page loads on demand, so a phone only downloads the code
// (and the chart library) for the page it actually opens.
const GroupPage = lazy(() => import('./pages/GroupPage').then((m) => ({ default: m.GroupPage })))
const LeaderboardsPage = lazy(() => import('./pages/LeaderboardsPage').then((m) => ({ default: m.LeaderboardsPage })))
const LeaguesPage = lazy(() => import('./pages/LeaguesPage').then((m) => ({ default: m.LeaguesPage })))
const ClubPage = lazy(() => import('./pages/ClubPage').then((m) => ({ default: m.ClubPage })))
const ClubsPage = lazy(() => import('./pages/ClubsPage').then((m) => ({ default: m.ClubsPage })))
const LineupPage = lazy(() => import('./pages/LineupPage').then((m) => ({ default: m.LineupPage })))
const MatchPage = lazy(() => import('./pages/MatchPage').then((m) => ({ default: m.MatchPage })))
const PlayerComparePage = lazy(() => import('./pages/PlayerComparePage').then((m) => ({ default: m.PlayerComparePage })))
const PlayerPage = lazy(() => import('./pages/PlayerPage').then((m) => ({ default: m.PlayerPage })))
const TeamH2HPage = lazy(() => import('./pages/TeamH2HPage').then((m) => ({ default: m.TeamH2HPage })))
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })))

function NotFoundPage() {
  usePageTitle('Siden findes ikke')
  return (
    <div className="empty" style={{ padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Siden findes ikke</h1>
      <p>
        Prøv at søge efter et hold eller en spiller fra{' '}
        <Link className="link link-accent" to="/">
          forsiden
        </Link>
        .
      </p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/hold/:slug" element={<TeamPage />} />
        <Route path="/klubber" element={<ClubsPage />} />
        <Route path="/klubber/:slug" element={<ClubPage />} />
        <Route path="/spillere/:slug" element={<PlayerPage />} />
        <Route path="/hold-mod-hold" element={<TeamH2HPage />} />
        <Route path="/spiller-mod-spiller" element={<PlayerComparePage />} />
        <Route path="/ligaer" element={<LeaguesPage />} />
        <Route path="/ligaer/:season" element={<LeaguesPage />} />
        <Route path="/ligaer/:season/:groupId" element={<GroupPage />} />
        <Route path="/kampe/:season/:groupId/:matchId" element={<MatchPage />} />
        <Route path="/toplister" element={<LeaderboardsPage />} />
        <Route path="/holdopstilling" element={<LineupPage />} />
        <Route path="/teams" element={<Navigate to="/" replace />} />
        <Route path="/players" element={<Navigate to="/" replace />} />
        <Route path="/head-to-head" element={<Navigate to="/hold-mod-hold" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
