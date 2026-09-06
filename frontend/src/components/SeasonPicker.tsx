import { useSeasons } from '../api'

export function SeasonPicker({
  value,
  onChange,
  allowAll = true,
  allLabel = 'Alle sæsoner',
  id = 'season',
}: {
  value: number | null
  onChange: (season: number | null) => void
  allowAll?: boolean
  allLabel?: string
  id?: string
}) {
  const { data } = useSeasons()
  const seasons = data?.seasons ?? []
  return (
    <label>
      <span className="sr-only">Sæson</span>
      <select
        id={id}
        className="select"
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        {allowAll && <option value="">{allLabel}</option>}
        {seasons.map((season) => (
          <option key={season.seasonId} value={season.seasonId}>
            {season.label}
          </option>
        ))}
      </select>
    </label>
  )
}
