import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { SearchBox } from './SearchBox'

function usePageTracking() {
  const location = useLocation()
  useEffect(() => {
    const path = `${location.pathname}${location.search}`
    const track = (): boolean => {
      const goatcounter = (window as Window & { goatcounter?: { count?: (o?: { path?: string }) => void } }).goatcounter
      if (!goatcounter?.count) return false
      goatcounter.count({ path })
      return true
    }
    if (track()) return
    const timer = window.setTimeout(() => void track(), 700)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.search])
}

function useScrollReset() {
  const location = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])
}

const NAV = [
  { to: '/ligaer', label: 'Ligaer' },
  { to: '/toplister', label: 'Toplister' },
  { to: '/hold-mod-hold', label: 'Hold mod hold' },
  { to: '/spiller-mod-spiller', label: 'Spiller mod spiller' },
]

export function AppShell() {
  usePageTracking()
  useScrollReset()
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <div className="shell">
      <header className="header">
        <div className="container header-inner">
          <Link className="brand" to="/" aria-label="Badminton Intelligence forside">
            <span className="brand-mark" aria-hidden="true">
              BI
            </span>
            <span>Badminton Intelligence</span>
          </Link>
          <nav className="nav" aria-label="Hovedmenu">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          {!isHome && (
            <div className="header-search">
              <SearchBox size="compact" placeholder="Søg hold eller spiller" />
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <strong style={{ color: 'var(--text-2)' }}>Badminton Intelligence</strong> · statistik for dansk holdbadminton
          </div>
          <div>
            Data fra Badminton Danmarks holdturnering (Badmintonligaen til Danmarksserien), sæson 2020/21 og frem.
            Resultater hentes fra badmintonplayer.dk.
          </div>
        </div>
      </footer>
    </div>
  )
}
