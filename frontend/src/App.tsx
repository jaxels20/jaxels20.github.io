import { useEffect } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { HomePage } from './pages/HomePage'
import { HeadToHeadPage } from './pages/HeadToHeadPage'
import { PlayersPage } from './pages/PlayersPage'
import { TeamsPage } from './pages/TeamsPage'

function ScrollToHash() {
  const location = useLocation()

  useEffect(() => {
    const path = `${location.pathname}${location.search}${location.hash}`
    const trackPageView = (): boolean => {
      const goatcounter = (
        window as Window & { goatcounter?: { count?: (options?: { path?: string }) => void } }
      ).goatcounter
      if (!goatcounter?.count) {
        return false
      }

      goatcounter.count({ path })
      return true
    }

    const trackedNow = trackPageView()
    const delayedTrack = trackedNow ? null : window.setTimeout(() => void trackPageView(), 700)

    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'auto' })
      return () => {
        if (delayedTrack !== null) {
          window.clearTimeout(delayedTrack)
        }
      }
    }

    const elementId = location.hash.replace('#', '')
    window.requestAnimationFrame(() => {
      const target = document.getElementById(elementId)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })

    return () => {
      if (delayedTrack !== null) {
        window.clearTimeout(delayedTrack)
      }
    }
  }, [location.hash, location.pathname, location.search])

  return null
}

function AppLayout() {
  const navClassName = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link nav-link-active' : 'nav-link'

  return (
    <div className="site-shell">
      <ScrollToHash />
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" aria-label="Badminton Intelligence home">
            <span className="brand-mark" aria-hidden="true">
              BI
            </span>
            <span className="brand-copy">
              <strong>Badminton Intelligence</strong>
              <small>Data-led performance insights</small>
            </span>
          </NavLink>

          <nav className="primary-nav" aria-label="Main navigation">
            <NavLink className={navClassName} to="/teams">
              Teams
            </NavLink>
            <NavLink className={navClassName} to="/players">
              Players
            </NavLink>
            <NavLink className={navClassName} to="/head-to-head">
              Head-to-Head
            </NavLink>
            <Link className="nav-link" to="/#analysis">
              Advanced Analysis
            </Link>
            <Link className="nav-link" to="/#data-foundation">
              Data Foundation
            </Link>
          </nav>
        </div>
      </header>

      <main className="site-main" aria-label="Main content">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <section className="footer-about" aria-label="Brand overview">
            <h2>Badminton Intelligence</h2>
            <p>
              Our mission is to help players and coaches analyze badminton results with clarity,
              speed, and confidence.
            </p>
          </section>

          <section className="footer-links" aria-label="Website footer placeholders">
            <div>
              <h3>Resources</h3>
              <a href="#">Documentation</a>
              <a href="#">Blog</a>
              <a href="#">Status</a>
            </div>
          </section>
        </div>

        <div className="footer-meta">
          <p>© {new Date().getFullYear()} Badminton Intelligence. All rights reserved.</p>
          <div className="meta-links">
            <a href="#">Privacy policy</a>
            <a href="#">Terms of service</a>
            <a href="#">Cookie settings</a>
            <a href="#">LinkedIn</a>
            <a href="#">X</a>
            <a href="#">YouTube</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/head-to-head" element={<HeadToHeadPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
