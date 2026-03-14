import { HeadToHeadSection } from '../components/HeadToHeadSection'

export function HeadToHeadPage() {
  return (
    <>
      <section className="route-intro" aria-label="Head-to-head page intro">
        <p className="eyebrow">Head-to-Head</p>
        <h1>Team versus team matchup lab</h1>
        <p>Benchmark two teams side by side with direct form and lineup-level radar comparison.</p>
      </section>
      <HeadToHeadSection />
    </>
  )
}
