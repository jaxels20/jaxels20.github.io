import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useSearch } from '../api'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { seasonLabel } from '../lib/format'
import type { Entity } from '../types'

type Option = { kind: 'team' | 'player'; entity: Entity; meta: string }

export function SearchBox({
  size = 'compact',
  placeholder = 'Søg efter hold eller spiller…',
  autoFocus = false,
  mode = 'navigate',
  onPick,
  restrict,
  defaultValue = '',
}: {
  size?: 'compact' | 'hero'
  placeholder?: string
  autoFocus?: boolean
  mode?: 'navigate' | 'pick'
  onPick?: (option: Option) => void
  restrict?: 'team' | 'player'
  defaultValue?: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebouncedValue(query, 180)
  const { data, isFetching } = useSearch(debounced, null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const options = useMemo<Option[]>(() => {
    if (!data) return []
    const teams: Option[] = restrict === 'player'
      ? []
      : data.teams.map((t) => ({
          kind: 'team',
          entity: { name: t.name, slug: t.slug },
          meta: `${t.teamMatches} holdkampe · senest ${seasonLabel(t.lastSeason)}`,
        }))
    const players: Option[] = restrict === 'team'
      ? []
      : data.players.map((p) => ({
          kind: 'player',
          entity: { name: p.name, slug: p.slug },
          meta: `${p.team?.name ?? 'Ukendt hold'} · ${p.matches} kampe`,
        }))
    return [...teams, ...players]
  }, [data, restrict])

  useEffect(() => {
    setActive(0)
  }, [options])

  useEffect(() => {
    setQuery(defaultValue)
  }, [defaultValue])

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (mode !== 'navigate' || size !== 'compact') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, size])

  const choose = (option: Option) => {
    setOpen(false)
    if (mode === 'pick') {
      setQuery(option.entity.name)
      onPick?.(option)
      return
    }
    setQuery('')
    navigate(option.kind === 'team' ? `/hold/${option.entity.slug}` : `/spillere/${option.entity.slug}`)
  }

  const showMenu = open && query.trim().length >= 2
  const teamOptions = options.filter((o) => o.kind === 'team')
  const playerOptions = options.filter((o) => o.kind === 'player')

  const renderOption = (option: Option) => {
    const index = options.indexOf(option)
    return (
      <button
        key={`${option.kind}-${option.entity.slug}`}
        type="button"
        role="option"
        id={`${listId}-${index}`}
        aria-selected={index === active}
        className={`search-item ${index === active ? 'active' : ''}`.trim()}
        onMouseEnter={() => setActive(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        <strong>{option.entity.name}</strong>
        <small>{option.meta}</small>
      </button>
    )
  }

  return (
    <div className={`search ${size === 'hero' ? 'search-hero' : ''}`.trim()} ref={rootRef}>
      <div className="search-field">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showMenu && options[active] ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (event.key === 'Enter') {
              if (showMenu && options[active]) {
                event.preventDefault()
                choose(options[active])
              }
            } else if (event.key === 'Escape') {
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
        />
        {size === 'compact' && mode === 'navigate' && !query && <kbd aria-hidden="true">/</kbd>}
      </div>
      {showMenu && (
        <div className="search-menu" role="listbox" id={listId}>
          {teamOptions.length > 0 && (
            <>
              <div className="search-group">Hold</div>
              {teamOptions.map(renderOption)}
            </>
          )}
          {playerOptions.length > 0 && (
            <>
              <div className="search-group">Spillere</div>
              {playerOptions.map(renderOption)}
            </>
          )}
          {options.length === 0 && (
            <div className="search-empty">{isFetching ? 'Søger…' : 'Ingen hold eller spillere matcher søgningen.'}</div>
          )}
        </div>
      )}
    </div>
  )
}
