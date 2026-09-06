import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Entity, Result } from '../types'
import { formatPct, resultLabel, resultLetter } from '../lib/format'

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: boolean
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${accent ? 'accent' : ''}`.trim()}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function PctStat({ label, value, sub }: { label: string; value: number | null; sub?: ReactNode }) {
  return <Stat label={label} value={formatPct(value)} sub={sub} />
}

export function FormPills({ results, label = 'Seneste resultater' }: { results: Result[]; label?: string }) {
  if (!results.length) return <span className="muted">–</span>
  return (
    <span className="form" role="img" aria-label={`${label}: ${results.map(resultLabel).join(', ')}`}>
      {results.map((r, i) => (
        <span key={i} className={`form-${r}`} aria-hidden="true">
          {resultLetter(r)}
        </span>
      ))}
    </span>
  )
}

export function ResultBadge({ result }: { result: Result }) {
  return (
    <span className={`result-${result}`} title={resultLabel(result)}>
      {resultLetter(result)}
    </span>
  )
}

export function TeamLink({ team, className = 'link' }: { team: Entity; className?: string }) {
  return (
    <Link className={className} to={`/hold/${team.slug}`}>
      {team.name}
    </Link>
  )
}

export function PlayerLink({ player, className = 'link' }: { player: Entity; className?: string }) {
  return (
    <Link className={className} to={`/spillere/${player.slug}`}>
      {player.name}
    </Link>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Noget gik galt.'
  return (
    <div className="error" role="alert">
      {message}
    </div>
  )
}

export function Skeleton({ height = 120, className = '' }: { height?: number; className?: string }) {
  return <div className={`skeleton ${className}`.trim()} style={{ height }} aria-hidden="true" />
}

export function PageSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Indlæser">
      <Skeleton height={140} />
      <div className="stat-grid">
        <Skeleton height={88} />
        <Skeleton height={88} />
        <Skeleton height={88} />
        <Skeleton height={88} />
      </div>
      <div className="grid grid-main">
        <Skeleton height={320} />
        <Skeleton height={320} />
      </div>
    </div>
  )
}

export function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <span className={`chip ${accent ? 'chip-accent' : ''}`.trim()}>{children}</span>
}

export function Legend({ items }: { items: { label: string; series: 1 | 2 }[] }) {
  return (
    <div className="legend" aria-label="Signaturforklaring">
      {items.map((item) => (
        <span key={item.label}>
          <i className={item.series === 2 ? 's2' : ''} aria-hidden="true" /> {item.label}
        </span>
      ))}
    </div>
  )
}
