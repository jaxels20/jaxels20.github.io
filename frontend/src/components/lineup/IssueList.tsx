import type { Issue } from '../../lib/lineupRules'

export function IssueList({ issues, empty = 'Ingen problemer fundet.' }: { issues: Issue[]; empty?: string }) {
  if (issues.length === 0) return <p className="text-2">{empty}</p>
  return (
    <ul className="issue-list">
      {issues.map((issue, i) => (
        <li key={i} className={`issue issue-${issue.severity}`}>
          <span className="issue-rule">{issue.rule}</span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  )
}

export function issueCounts(issues: Issue[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  return `${errors} ${errors === 1 ? 'fejl' : 'fejl'} · ${warnings} ${warnings === 1 ? 'advarsel' : 'advarsler'}`
}
