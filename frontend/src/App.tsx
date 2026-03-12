import { ArrowRightLeft, BarChart3, Home, Menu, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const HeadToHeadPage = lazy(() =>
  import('./pages/HeadToHeadPage').then((module) => ({ default: module.HeadToHeadPage })),
)

function Shell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="app-root">
      <div className="bg-ornament" />

      <header className="site-header">
        <div className="site-header-inner">
          <NavLink to="/" className="brand" onClick={() => setMobileNavOpen(false)}>
            <span className="brand-mark">
              <BarChart3 size={18} />
            </span>
            <span>Badminton Intelligence</span>
          </NavLink>

          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={() => setMobileNavOpen((value) => !value)}
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <nav className={mobileNavOpen ? 'nav-links open' : 'nav-links'}>
            <NavLink
              to="/"
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setMobileNavOpen(false)}
            >
              <Home size={14} />
              Home
            </NavLink>
            <NavLink
              to="/reports"
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setMobileNavOpen(false)}
            >
              <BarChart3 size={14} />
              Reports
            </NavLink>
            <NavLink
              to="/head-to-head"
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setMobileNavOpen(false)}
            >
              <ArrowRightLeft size={14} />
              Head-to-Head
            </NavLink>
          </nav>
        </div>
      </header>

      <Suspense fallback={<div className="page-shell">Loading page...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/head-to-head" element={<HeadToHeadPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}

function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}

export default App
