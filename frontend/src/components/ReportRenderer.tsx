import type { ReportResponse } from '../types'

function isNumeric(value: string): boolean {
  const trimmed = value.trim()
  return /^-?\d+(\.\d+)?$/.test(trimmed)
}

export function ReportRenderer({ report }: { report: ReportResponse }) {
  return (
    <section className="report-shell">
      <header className="report-header">
        <p className="report-kicker">Live Report</p>
        <h2>{report.title}</h2>
        <p>
          <strong>{report.subject}</strong>
          {report.season_id ? ` · Season ${report.season_id}` : ' · All Seasons'}
        </p>
      </header>

      {report.blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <h3 key={`h-${idx}`} className="section-title">
              {block.text}
            </h3>
          )
        }

        if (block.type === 'paragraph') {
          return (
            <p key={`p-${idx}`} className="report-note">
              {block.text}
            </p>
          )
        }

        return (
          <article key={`t-${idx}`} className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIdx) => (
                      <th key={`${idx}-${headerIdx}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIdx) => (
                    <tr key={`${idx}-r-${rowIdx}`}>
                      {row.map((cell, cellIdx) => (
                        <td
                          key={`${idx}-r-${rowIdx}-c-${cellIdx}`}
                          className={isNumeric(cell) ? 'is-numeric' : ''}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {block.row_count ? <div className="row-count">{block.row_count}</div> : null}
          </article>
        )
      })}
    </section>
  )
}
