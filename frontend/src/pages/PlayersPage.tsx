import { PlayersSection } from '../components/PlayersSection'

export function PlayersPage() {
  return (
    <>
      <section className="route-intro" aria-label="Players page intro">
        <p className="eyebrow">Players</p>
        <h1>Player analytics workspace</h1>
        <p>Find player trends, discipline strengths, and partnership performance in one focused view.</p>
      </section>
      <PlayersSection />
    </>
  )
}
