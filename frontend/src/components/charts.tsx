import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'

import { Legend } from './ui'

export type BarRow = {
  key: string
  label: ReactNode
  sub?: ReactNode
  value: number | null
  valueLabel: string
  detail?: ReactNode
}

export function BarList({ rows, max = 100 }: { rows: BarRow[]; max?: number }) {
  if (!rows.length) return <div className="empty">Ingen data.</div>
  return (
    <div className="bars" role="list">
      {rows.map((row) => (
        <div className="bar-row" role="listitem" key={row.key}>
          <div className="bar-label">
            {row.label}
            {row.sub && <small>{row.sub}</small>}
          </div>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, ((row.value ?? 0) / max) * 100))}%` }} />
          </div>
          <div className="bar-value">
            {row.valueLabel}
            {row.detail && <small>{row.detail}</small>}
          </div>
        </div>
      ))}
    </div>
  )
}

export type WinLossRow = {
  key: string
  label: ReactNode
  sub?: ReactNode
  wins: number
  losses: number
  winPct: number | null
  detail?: string
}

/** Stacked win/loss bars with a 50 % reference line and direct labels. */
export function WinLossBars({ rows, midline = 50 }: { rows: WinLossRow[]; midline?: number | null }) {
  const [hover, setHover] = useState<string | null>(null)
  if (!rows.length) return <div className="empty">Ingen data.</div>
  const maxPlayed = Math.max(...rows.map((r) => r.wins + r.losses), 1)
  return (
    <div className="wl" role="list">
      <div className="wl-legend" aria-hidden="true">
        <span>
          <i className="wl-win" /> Vundet
        </span>
        <span>
          <i className="wl-loss" /> Tabt
        </span>
        {midline !== null && (
          <span>
            <i className="wl-mid" /> {midline} %
          </span>
        )}
      </div>
      {rows.map((row) => {
        const played = row.wins + row.losses
        const winShare = played ? (row.wins / played) * 100 : 0
        const active = hover === row.key
        return (
          <div
            className={`wl-row ${active ? 'active' : ''}`.trim()}
            role="listitem"
            key={row.key}
            onMouseEnter={() => setHover(row.key)}
            onMouseLeave={() => setHover(null)}
            aria-label={`${typeof row.label === 'string' ? row.label : ''}: ${row.wins} vundet, ${row.losses} tabt`}
          >
            <div className="wl-label">
              {row.label}
              {row.sub && <small>{row.sub}</small>}
            </div>
            <div className="wl-track" style={{ opacity: 0.55 + 0.45 * (played / maxPlayed) }}>
              <div className="wl-seg wl-win" style={{ width: `${winShare}%` }}>
                {winShare >= 14 && <span>{row.wins}</span>}
              </div>
              <div className="wl-seg wl-loss" style={{ width: `${100 - winShare}%` }}>
                {100 - winShare >= 14 && <span>{row.losses}</span>}
              </div>
              {midline !== null && <div className="wl-midline" style={{ left: `${midline}%` }} />}
            </div>
            <div className="wl-value">
              {row.winPct === null ? '–' : `${Math.round(row.winPct)} %`}
              <small>{played} kampe</small>
            </div>
            {active && (
              <div className="wl-tip">
                <strong>{row.label}</strong>
                {row.wins}–{row.losses} · {row.winPct === null ? '–' : `${row.winPct.toLocaleString('da-DK')} %`}
                {row.detail ? ` · ${row.detail}` : ''}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export type PairRow = {
  key: string
  label: ReactNode
  a: number | null
  b: number | null
  aLabel: string
  bLabel: string
}

export function PairedBars({ rows, names, max = 100 }: { rows: PairRow[]; names: [string, string]; max?: number }) {
  if (!rows.length) return <div className="empty">Ingen data.</div>
  const width = (v: number | null) => `${Math.max(0, Math.min(100, ((v ?? 0) / max) * 100))}%`
  return (
    <div className="stack" style={{ gap: '0.75rem' }}>
      <Legend items={[{ label: names[0], series: 1 }, { label: names[1], series: 2 }]} />
      <div className="bars" role="list">
        {rows.map((row) => (
          <div className="bar-row bar-row-2" role="listitem" key={row.key}>
            <div className="bar-label">{row.label}</div>
            <div className="bar-pair">
              <div className="bar-track" aria-hidden="true">
                <div className="bar-fill" style={{ width: width(row.a) }} />
              </div>
              <div className="bar-track" aria-hidden="true">
                <div className="bar-fill s2" style={{ width: width(row.b) }} />
              </div>
              <div className="bar-pair-values">
                <span>{row.aLabel}</span>
                <span>{row.bLabel}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

export type TrendPoint = { x: string; y: number | null; detail?: string }

export function TrendChart({
  points,
  height = 220,
  formatY = (v: number) => String(v),
  domain,
  baseline,
  series2,
  names,
}: {
  points: TrendPoint[]
  height?: number
  formatY?: (value: number) => string
  domain?: [number, number]
  baseline?: number
  series2?: TrendPoint[]
  names?: [string, string]
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const margin = { top: 12, right: 16, bottom: 30, left: 44 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom

  const labels = points.map((p) => p.x)
  const xScale = useMemo(() => scalePoint<string>({ domain: labels, range: [0, innerW], padding: 0.5 }), [labels, innerW])
  const values = [...points, ...(series2 ?? [])].map((p) => p.y).filter((v): v is number => v !== null)
  const yDomain: [number, number] = domain ?? [
    Math.min(...values, baseline ?? Infinity) - 5,
    Math.max(...values, baseline ?? -Infinity) + 5,
  ]
  const yScale = useMemo(() => scaleLinear<number>({ domain: yDomain, range: [innerH, 0], nice: true }), [yDomain, innerH])

  if (!points.length) return <div className="empty">Ingen data.</div>

  const valid = (p: TrendPoint) => p.y !== null
  const px = (p: TrendPoint) => xScale(p.x) ?? 0
  const py = (p: TrendPoint) => yScale(p.y ?? 0)

  const handleMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    let best = 0
    let bestDist = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(px(p) - x)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    setHover(best)
  }

  const hovered = hover !== null ? points[hover] : null
  const hovered2 = hover !== null && series2 ? series2[hover] : null

  return (
    <div className="chart" ref={ref}>
      {names && <Legend items={[{ label: names[0], series: 1 }, { label: names[1], series: 2 }]} />}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Udvikling over tid">
          <Group left={margin.left} top={margin.top}>
            <GridRows scale={yScale} width={innerW} stroke="var(--grid)" numTicks={4} />
            {baseline !== undefined && (
              <line x1={0} x2={innerW} y1={yScale(baseline)} y2={yScale(baseline)} stroke="var(--axis)" strokeDasharray="4 4" />
            )}
            <AxisLeft
              scale={yScale}
              numTicks={4}
              stroke="transparent"
              tickStroke="transparent"
              tickFormat={(v) => formatY(Number(v))}
              tickLabelProps={() => ({ fill: 'var(--text-3)', fontSize: 11, textAnchor: 'end', dy: '0.33em', dx: -4 })}
            />
            <AxisBottom
              top={innerH}
              scale={xScale}
              stroke="var(--axis)"
              tickStroke="transparent"
              tickLabelProps={() => ({ fill: 'var(--text-3)', fontSize: 11, textAnchor: 'middle', dy: 4 })}
            />
            {series2 && (
              <LinePath
                data={series2.filter(valid)}
                x={px}
                y={py}
                stroke="var(--series-2)"
                strokeWidth={2}
                curve={curveMonotoneX}
              />
            )}
            <LinePath data={points.filter(valid)} x={px} y={py} stroke="var(--series-1)" strokeWidth={2} curve={curveMonotoneX} />
            {series2?.filter(valid).map((p) => (
              <circle key={`b-${p.x}`} cx={px(p)} cy={py(p)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
            ))}
            {points.filter(valid).map((p) => (
              <circle key={p.x} cx={px(p)} cy={py(p)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            ))}
            {hovered && (
              <line x1={px(hovered)} x2={px(hovered)} y1={0} y2={innerH} stroke="var(--line-strong)" />
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
            />
          </Group>
        </svg>
      )}
      {hovered && (
        <div
          className="chart-tooltip"
          style={{ left: margin.left + px(hovered), top: margin.top + (hovered.y !== null ? py(hovered) : innerH / 2) }}
        >
          <strong>{hovered.x}</strong>
          {names ? `${names[0]}: ` : ''}
          {hovered.y === null ? '–' : formatY(hovered.y)}
          {hovered.detail ? ` · ${hovered.detail}` : ''}
          {hovered2 && (
            <>
              <br />
              {names ? `${names[1]}: ` : ''}
              {hovered2.y === null ? '–' : formatY(hovered2.y)}
              {hovered2.detail ? ` · ${hovered2.detail}` : ''}
            </>
          )}
        </div>
      )}
    </div>
  )
}
