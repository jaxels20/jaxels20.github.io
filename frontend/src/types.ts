export type ReportBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][]; row_count: string | null }

export type ReportResponse = {
  report_type: string
  title: string
  subject: string
  season_id: number | null
  generated_at: string
  blocks: ReportBlock[]
}

export type SearchResult = {
  name: string
}

export type SeasonsResponse = {
  results: { season_id: number; season_label: string }[]
}
