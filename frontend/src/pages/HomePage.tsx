import { ArrowRight, BarChart3, Search, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <main className="page">
      <section className="hero hero-home">
        <p className="eyebrow">Badminton Intelligence</p>
        <h1>Professional Team & Player Reporting Platform</h1>
        <p>
          Explore deep warehouse-driven match analytics through a modern, searchable experience.
          Generate complete reports for players and teams in seconds.
        </p>

        <div className="hero-cta-row">
          <Link to="/reports?mode=team" className="cta cta-primary">
            Open Team Reports
            <ArrowRight size={16} />
          </Link>
          <Link to="/reports?mode=player" className="cta cta-secondary">
            Open Player Reports
          </Link>
          <Link to="/head-to-head" className="cta cta-secondary">
            Team Head-to-Head
          </Link>
        </div>
      </section>

      <section className="feature-grid">
        <article className="feature-card">
          <div className="feature-icon">
            <Search size={18} />
          </div>
          <h3>Instant Smart Search</h3>
          <p>
            Find players and teams with live suggestions, then generate complete statistical reports
            filtered by season.
          </p>
        </article>

        <article className="feature-card">
          <div className="feature-icon">
            <BarChart3 size={18} />
          </div>
          <h3>Structured Report Tables</h3>
          <p>
            View robust warehouse outputs including win rates, match-type performance, discipline
            pivots, and opponent breakdowns.
          </p>
        </article>

        <article className="feature-card">
          <div className="feature-icon">
            <Users size={18} />
          </div>
          <h3>Built For Collaboration</h3>
          <p>
            Use web reports for analysis sessions, planning meetings, and quick sharing with coaches
            and teammates.
          </p>
        </article>
      </section>
    </main>
  )
}
