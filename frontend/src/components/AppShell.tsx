import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useSeasons } from '../api'
import { pathHasTitle } from '../hooks/usePageTitle'
import { formatDate, formatDateTime } from '../lib/format'
import { SearchBox } from './SearchBox'

function usePageTracking() {
  const location = useLocation()
  useEffect(() => {
    const path = `${location.pathname}${location.search}`
    let cancelled = false
    const started = Date.now()

    const tryCount = () => {
      if (cancelled) return
      const goatcounter = (window as Window & { goatcounter?: { count?: (o?: { path?: string; title?: string }) => void } })
        .goatcounter
      const ready = Boolean(goatcounter?.count) && pathHasTitle(path)
      // Give the page up to 2 s to load its name (team, player, pulje) so the
      // dashboard shows a readable title; then record the view regardless.
      if (!ready && Date.now() - started < 2000) {
        window.setTimeout(tryCount, 150)
        return
      }
      goatcounter?.count?.({ path, title: document.title })
    }

    tryCount()
    return () => {
      cancelled = true
    }
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
  const { data: seasons } = useSeasons()

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
            Resultater hentes fra badmintonplayer.dk hver mandag.
            {seasons?.dataUpdated && (
              <>
                <br />
                Data opdateret {formatDateTime(seasons.dataUpdated)}
                {seasons.latestMatch && <> · seneste spillede kamp {formatDate(seasons.latestMatch)}</>}
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}
