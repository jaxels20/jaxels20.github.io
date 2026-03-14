import { TeamsSection } from '../components/TeamsSection'

export function TeamsPage() {
  return (
    <>
      <section className="route-intro" aria-label="Teams page intro">
        <p className="eyebrow">Teams</p>
        <h1>Team analytics workspace</h1>
        <p>Search teams, compare form, and evaluate matchup strengths with live visual insights.</p>
      </section>
      <TeamsSection />
    </>
  )
}
