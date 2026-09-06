const numberFormat = new Intl.NumberFormat('da-DK')
const dateFormat = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' })
const weekdayFormat = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–'
  return numberFormat.format(value)
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '–'
  return `${value.toLocaleString('da-DK', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}

export function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '–'
  const text = Math.abs(value).toLocaleString('da-DK', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text}`
  return text
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return dateFormat.format(date)
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return shortDateFormat.format(date)
}

export function formatWeekday(value: string | null | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return weekdayFormat.format(date)
}

export function seasonLabel(seasonId: number | null | undefined): string {
  if (seasonId === null || seasonId === undefined) return 'Alle sæsoner'
  return `${seasonId}/${String(seasonId + 1).slice(2)}`
}

export const DISCIPLINE_NAMES: Record<string, string> = {
  HS: 'Herresingle',
  DS: 'Damesingle',
  HD: 'Herredouble',
  DD: 'Damedouble',
  MD: 'Mixdouble',
  S: 'Single',
  D: 'Double',
}

export function disciplineName(code: string): string {
  return DISCIPLINE_NAMES[code] ?? code
}

export const RESULT_LABELS: Record<string, string> = { W: 'Sejr', L: 'Nederlag', D: 'Uafgjort' }

export function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result
}

export function resultLetter(result: string): string {
  return result === 'W' ? 'V' : result === 'L' ? 'T' : 'U'
}

export function record(wins: number, draws: number | undefined, losses: number): string {
  return draws ? `${wins}–${draws}–${losses}` : `${wins}–${losses}`
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('da-DK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
