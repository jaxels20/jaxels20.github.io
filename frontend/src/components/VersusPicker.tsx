import { useRef } from 'react'

import { useResolveEntity } from '../api'
import { SearchBox } from './SearchBox'
import type { Entity } from '../types'

type Side = 'a' | 'b'

const COPY = {
  team: {
    labels: ['Hold', 'Modstander'] as const,
    placeholders: ['Vælg et hold', 'Vælg et modstanderhold'] as const,
    swap: 'Byt om på holdene',
  },
  player: {
    labels: ['Spiller', 'Modstander'] as const,
    placeholders: ['Vælg en spiller', 'Vælg en modstander'] as const,
    swap: 'Byt om på spillerne',
  },
}

/** Readable stand-in while a name is unknown, e.g. "vendsyssel-2" -> "Vendsyssel 2". */
function prettifySlug(slug: string): string {
  return slug
    .replace(/-\d+$/, '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function PickerField({
  label,
  placeholder,
  name,
  restrict,
  onPick,
  onClear,
}: {
  label: string
  placeholder: string
  name: string | null
  restrict: 'team' | 'player'
  onPick: (entity: Entity) => void
  onClear: () => void
}) {
  return (
    <div className="picker">
      <span className="picker-label">{label}</span>
      {name ? (
        <div className="picker-chosen">
          <span className="picker-name">{name}</span>
          <button type="button" className="picker-change" onClick={onClear}>
            Skift
          </button>
        </div>
      ) : (
        <SearchBox mode="pick" restrict={restrict} placeholder={placeholder} onPick={(option) => onPick(option.entity)} />
      )}
    </div>
  )
}

/**
 * Two-sided chooser for the comparison pages. A chosen side collapses to its name
 * with a "Skift" button, so the page reads as a matchup rather than two form fields.
 */
export function VersusPicker({
  kind,
  a,
  b,
  slugs,
  onPick,
  onSwap,
}: {
  kind: 'team' | 'player'
  a: Entity | null
  b: Entity | null
  slugs: [string | null, string | null]
  onPick: (side: Side, slug: string | null) => void
  onSwap: () => void
}) {
  const copy = COPY[kind]
  const canSwap = Boolean(slugs[0] && slugs[1])

  // Only one side selected means the comparison query is idle, so no names come back.
  // Remember every name we have seen so a half-finished choice still reads properly.
  const seen = useRef<Record<string, string>>({})
  if (slugs[0] && a) seen.current[slugs[0]] = a.name
  if (slugs[1] && b) seen.current[slugs[1]] = b.name

  // A page opened with one side pre-filled has no name to show, and the slug spells
  // Danish letters as ae/oe/aa, so ask the API rather than guessing from the slug.
  const resolvedA = useResolveEntity(kind, slugs[0], Boolean(slugs[0]) && !a && !seen.current[slugs[0] ?? ''])
  const resolvedB = useResolveEntity(kind, slugs[1], Boolean(slugs[1]) && !b && !seen.current[slugs[1] ?? ''])

  const nameFor = (slug: string | null, value: Entity | null, resolved: Entity | undefined) => {
    if (value) return value.name
    if (!slug) return null
    return seen.current[slug] ?? resolved?.name ?? prettifySlug(slug)
  }

  const pick = (side: Side) => (entity: Entity) => {
    seen.current[entity.slug] = entity.name
    onPick(side, entity.slug)
  }

  return (
    <div className="versus-picker">
      <PickerField
        label={copy.labels[0]}
        placeholder={copy.placeholders[0]}
        name={nameFor(slugs[0], a, resolvedA.data)}
        restrict={kind}
        onPick={pick('a')}
        onClear={() => onPick('a', null)}
      />
      <div className="versus-picker-mid">
        <span className="versus-picker-word">mod</span>
        <button
          type="button"
          className="versus-swap"
          onClick={onSwap}
          disabled={!canSwap}
          title={copy.swap}
          aria-label={copy.swap}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M7 4L3 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 8h13" strokeLinecap="round" />
            <path d="M17 20l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 16H8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <PickerField
        label={copy.labels[1]}
        placeholder={copy.placeholders[1]}
        name={nameFor(slugs[1], b, resolvedB.data)}
        restrict={kind}
        onPick={pick('b')}
        onClear={() => onPick('b', null)}
      />
    </div>
  )
}
