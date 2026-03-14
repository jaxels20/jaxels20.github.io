import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <>
      <section className="hero" id="analysis">
        <div className="hero-copy">
          <p className="eyebrow">Welcome to Badminton Intelligence</p>
          <h1>Turn match results into smarter training and better matchday decisions.</h1>
          <p className="hero-lede">
            We help players, coaches, and clubs analyze badminton results so you can spot momentum
            shifts, track progress, and prepare with confidence.
          </p>
          <div className="hero-actions">
            <Link className="button-action" to="/players">
              Explore player insights
            </Link>
            <Link className="text-action" to="/teams">
              Open team workspace
            </Link>
          </div>
          <ul className="hero-pills" aria-label="Key benefits">
            <li>Player progression tracking</li>
            <li>Team trend intelligence</li>
            <li>Opponent preparation snapshots</li>
          </ul>
        </div>

        <div className="hero-visual">
          <div className="hero-image-wrap">
            <img
              src="/badminton-hero.svg"
              alt="Stylized badminton racket and shuttlecock illustration"
            />
          </div>
          <div className="floating-chip chip-one">Smash win rate +12%</div>
          <div className="floating-chip chip-two">21-17 in deciding sets</div>
        </div>
      </section>

      <section className="purpose-section">
        <div className="section-heading">
          <p className="eyebrow">What this site is for</p>
          <h2>Clear badminton analysis for every level of competition.</h2>
        </div>

        <div className="purpose-grid">
          <article className="purpose-card">
            <span className="card-kicker">Players</span>
            <h3>Understand your game profile</h3>
            <p>
              Review season form, score patterns, and opponent matchups to focus each training block
              on what wins points.
            </p>
          </article>

          <article className="purpose-card">
            <span className="card-kicker">Teams</span>
            <h3>Prepare lineups with confidence</h3>
            <p>
              Compare squad trends and key matchups before fixtures so your team strategy starts from
              evidence.
            </p>
          </article>

          <article className="purpose-card" id="foundation">
            <span className="card-kicker">Data Foundation</span>
            <h3>Reliable numbers behind every insight</h3>
            <p>
              Structured results data powers reports you can trust, from high-level overviews to deep
              tactical details.
            </p>
          </article>
        </div>
      </section>

      <section className="data-coverage" id="data-foundation" aria-label="Data scope and coverage">
        <div className="data-coverage-head">
          <p className="eyebrow">Data Foundation</p>
          <h2>Know exactly what this analysis is based on.</h2>
          <p>
            Every chart and metric on this site follows a clear premise, so coaches and players know
            what is included before drawing conclusions.
          </p>
        </div>
        <div className="data-premise-list" aria-label="Data premise summary">
          <article>
            <h3>Official Source</h3>
            <p>
              Results are sourced from team competitions hosted by <strong>Badminton Danmark</strong>.
            </p>
          </article>
          <article>
            <h3>League Scope</h3>
            <p>
              Coverage includes <strong>Danmarkserien and higher divisions</strong>.
            </p>
          </article>
          <article>
            <h3>Season Window</h3>
            <p>
              Current dataset spans <strong>2020 to 2026</strong>, with future expansion planned from{' '}
              <strong>2010 and onwards</strong>.
            </p>
          </article>
        </div>
      </section>

      <section className="journey">
        <p className="eyebrow">How it works</p>
        <div className="journey-grid">
          <article>
            <span>01</span>
            <h3>Collect Results</h3>
            <p>Import match data from your season to establish a complete competitive baseline.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Analyze Patterns</h3>
            <p>Surface trends for players and teams, including momentum and consistency shifts.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Act With Confidence</h3>
            <p>Use insight-driven planning for training focus, lineup choices, and match prep.</p>
          </article>
        </div>
      </section>
    </>
  )
}
