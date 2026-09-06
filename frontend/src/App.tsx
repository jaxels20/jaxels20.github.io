import { Link, Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { GroupPage } from './pages/GroupPage'
import { HomePage } from './pages/HomePage'
import { LeaderboardsPage } from './pages/LeaderboardsPage'
import { LeaguesPage } from './pages/LeaguesPage'
import { MatchPage } from './pages/MatchPage'
import { PlayerComparePage } from './pages/PlayerComparePage'
import { PlayerPage } from './pages/PlayerPage'
import { TeamH2HPage } from './pages/TeamH2HPage'
import { TeamPage } from './pages/TeamPage'

function NotFoundPage() {
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
        <Route path="/spillere/:slug" element={<PlayerPage />} />
        <Route path="/hold-mod-hold" element={<TeamH2HPage />} />
        <Route path="/spiller-mod-spiller" element={<PlayerComparePage />} />
        <Route path="/ligaer" element={<LeaguesPage />} />
        <Route path="/ligaer/:season" element={<LeaguesPage />} />
        <Route path="/ligaer/:season/:groupId" element={<GroupPage />} />
        <Route path="/kampe/:season/:groupId/:matchId" element={<MatchPage />} />
        <Route path="/toplister" element={<LeaderboardsPage />} />
        <Route path="/teams" element={<Navigate to="/" replace />} />
        <Route path="/players" element={<Navigate to="/" replace />} />
        <Route path="/head-to-head" element={<Navigate to="/hold-mod-hold" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
