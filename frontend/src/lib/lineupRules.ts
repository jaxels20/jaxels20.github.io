/**
 * Lineup legality per Badminton Danmark's DH-reglement (§37 team shape, §38 order and
 * lower-team rules). Pure functions so the page re-checks on every edit.
 */

export type Sex = 'M' | 'F'
export type Category = 'MD' | 'DS' | 'HS' | 'DD' | 'HD'
export type PointsKey = 'single' | 'double' | 'mix'

export type Points = { single: number | null; double: number | null; mix: number | null }

export type LineupPlayer = {
  id: number
  name: string
  sex: Sex | null
  points: Points | null
  /** U17/U19 per the ranking list. §38 stk. 5: placed by assessed senior strength, not points. */
  youth: boolean
  ageGroup?: string | null
}

export type SlotSpec = { key: string; category: Category; number: number; size: 1 | 2 }

export type Format = {
  matches: 9 | 13
  minMen: number
  minWomen: number
  maxPerPlayer: number | null
  division: string
}

export type Assignment = Record<string, (LineupPlayer | null)[]>

export type HigherTeamPlayer = { player: LineupPlayer; categories: PointsKey[]; slots: string[] }

export type Issue = {
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  slots?: string[]
}

export const CATEGORY_NAMES: Record<Category, string> = {
  MD: 'Mixdouble',
  DS: 'Damesingle',
  HS: 'Herresingle',
  DD: 'Damedouble',
  HD: 'Herredouble',
}

/** The official match sheet order: mixed, ladies' singles, men's singles, ladies' doubles, men's doubles. */
export function slotsFor(matches: 9 | 13): SlotSpec[] {
  const counts: Record<Category, number> =
    matches === 9 ? { MD: 2, DS: 2, HS: 2, DD: 1, HD: 2 } : { MD: 2, DS: 2, HS: 4, DD: 2, HD: 3 }
  const order: Category[] = ['MD', 'DS', 'HS', 'DD', 'HD']
  const slots: SlotSpec[] = []
  for (const category of order) {
    for (let n = 1; n <= counts[category]; n++) {
      slots.push({ key: `${category}${n}`, category, number: n, size: category === 'DS' || category === 'HS' ? 1 : 2 })
    }
  }
  return slots
}

export function pointsKeyFor(category: Category): PointsKey {
  if (category === 'MD') return 'mix'
  if (category === 'DS' || category === 'HS') return 'single'
  return 'double'
}

export function categoryLabel(key: PointsKey): string {
  return key === 'single' ? 'single' : key === 'double' ? 'double' : 'mix'
}

/** §38 stk. 4: a player not on a list counts as 0 points. */
export function pointsOf(player: LineupPlayer | null, key: PointsKey): number {
  return player?.points?.[key] ?? 0
}

function pairPoints(players: (LineupPlayer | null)[], key: PointsKey): number {
  return players.reduce((sum, p) => sum + pointsOf(p, key), 0)
}

export function sexAllowed(category: Category, position: number): Sex {
  if (category === 'MD') return position === 0 ? 'M' : 'F'
  return category === 'HS' || category === 'HD' ? 'M' : 'F'
}

export function slotLabel(slot: SlotSpec): string {
  return `${slot.number}. ${slot.category}`
}

export function checkLineup(
  format: Format,
  slots: SlotSpec[],
  assignment: Assignment,
  higher: { teamName: string; players: HigherTeamPlayer[] } | null,
): Issue[] {
  const issues: Issue[] = []
  const filled = (key: string) => (assignment[key] ?? []).filter((p): p is LineupPlayer => Boolean(p))

  // Completeness and sex per slot.
  let missing = 0
  for (const slot of slots) {
    const players = assignment[slot.key] ?? []
    for (let i = 0; i < slot.size; i++) {
      const p = players[i]
      if (!p) {
        missing++
        continue
      }
      const need = sexAllowed(slot.category, i)
      if (p.sex && p.sex !== need) {
        issues.push({
          severity: 'error',
          rule: '§ 37',
          message: `${p.name} kan ikke spille ${slotLabel(slot)} (${need === 'M' ? 'herre' : 'dame'}plads).`,
          slots: [slot.key],
        })
      }
      if (!p.sex) {
        issues.push({
          severity: 'warning',
          rule: 'Data',
          message: `${p.name}: køn kendes ikke fra kampdata. Vælg det i spillerlisten.`,
          slots: [slot.key],
        })
      }
      if (!p.points) {
        issues.push({
          severity: 'warning',
          rule: 'Data',
          message: `${p.name}: ranglistepoint mangler, tæller som 0 point (§ 38 stk. 4).`,
          slots: [slot.key],
        })
      }
    }
    if (slot.size === 2 && players[0] && players[1] && players[0].id === players[1].id) {
      issues.push({ severity: 'error', rule: '§ 37', message: `${players[0].name} står to gange i ${slotLabel(slot)}.`, slots: [slot.key] })
    }
  }
  if (missing > 0) {
    issues.push({
      severity: 'info',
      rule: '§ 37',
      message: `Opstillingen er ikke komplet: ${missing} ${missing === 1 ? 'plads' : 'pladser'} mangler.`,
    })
  }

  // §38 stk. 5: youth players are placed by assessed senior strength, so say who they are.
  const youthSeen = new Set<number>()
  for (const slot of slots) {
    for (const p of filled(slot.key)) {
      if (p.youth && !youthSeen.has(p.id)) {
        youthSeen.add(p.id)
        issues.push({
          severity: 'info',
          rule: '§ 38 stk. 5',
          message: `${p.name} er ${p.ageGroup ?? 'U17/U19'}-spiller og skal placeres efter aktuel styrke i seniorregi, ikke efter point. Klubben vurderer.`,
          slots: [slot.key],
        })
      }
    }
  }

  // §37: no player twice in the same category, and (13-match format) at most two matches.
  const perPlayer = new Map<number, { name: string; slots: SlotSpec[] }>()
  for (const slot of slots) {
    for (const p of filled(slot.key)) {
      const entry = perPlayer.get(p.id) ?? { name: p.name, slots: [] }
      entry.slots.push(slot)
      perPlayer.set(p.id, entry)
    }
  }
  for (const [, entry] of perPlayer) {
    const byCategory = new Map<Category, SlotSpec[]>()
    for (const s of entry.slots) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s])
    for (const [category, list] of byCategory) {
      if (list.length > 1) {
        issues.push({
          severity: 'error',
          rule: format.matches === 9 ? '§ 37 stk. 1 a' : '§ 37 stk. 2 a',
          message: `${entry.name} spiller to kampe i ${CATEGORY_NAMES[category].toLowerCase()} (${list.map(slotLabel).join(', ')}).`,
          slots: list.map((s) => s.key),
        })
      }
    }
    if (format.maxPerPlayer !== null && entry.slots.length > format.maxPerPlayer) {
      issues.push({
        severity: 'error',
        rule: '§ 37 stk. 2 a',
        message: `${entry.name} spiller ${entry.slots.length} kampe; højst ${format.maxPerPlayer} er tilladt.`,
        slots: entry.slots.map((s) => s.key),
      })
    }
  }

  // §37: minimum number of distinct men and women, judged once the lineup is complete.
  if (missing === 0) {
    const men = new Set<number>()
    const women = new Set<number>()
    for (const slot of slots) {
      const players = assignment[slot.key] ?? []
      players.forEach((p, i) => {
        if (!p) return
        ;(sexAllowed(slot.category, i) === 'M' ? men : women).add(p.id)
      })
    }
    if (men.size < format.minMen) {
      issues.push({
        severity: 'error',
        rule: format.matches === 9 ? '§ 37 stk. 1 a' : '§ 37 stk. 2 a',
        message: `Der bruges ${men.size} herrer; ${format.division} kræver mindst ${format.minMen}.`,
      })
    }
    if (women.size < format.minWomen) {
      issues.push({
        severity: 'error',
        rule: format.matches === 9 ? '§ 37 stk. 1 a' : '§ 37 stk. 2 a',
        message: `Der bruges ${women.size} damer; ${format.division} kræver mindst ${format.minWomen}.`,
      })
    }
  }

  // §38 stk. 2-3: order within each category by points, with 50 (singles) / 100 (doubles) tolerance.
  const categories: Category[] = ['MD', 'DS', 'HS', 'DD', 'HD']
  for (const category of categories) {
    const inCategory = slots.filter((s) => s.category === category)
    const key = pointsKeyFor(category)
    const tolerance = inCategory[0]?.size === 1 ? 50 : 100
    for (let i = 0; i < inCategory.length; i++) {
      for (let j = i + 1; j < inCategory.length; j++) {
        const a = assignment[inCategory[i].key] ?? []
        const b = assignment[inCategory[j].key] ?? []
        if (a.filter(Boolean).length < inCategory[i].size || b.filter(Boolean).length < inCategory[j].size) continue
        const upper = pairPoints(a, key)
        const lower = pairPoints(b, key)
        if (lower > upper + tolerance) {
          const nameA = a.map((p) => p?.name).join(' / ')
          const nameB = b.map((p) => p?.name).join(' / ')
          const youthInvolved = [...a, ...b].some((p) => p?.youth)
          issues.push(
            youthInvolved
              ? {
                  severity: 'warning',
                  rule: '§ 38 stk. 5',
                  message: `${slotLabel(inCategory[j])} (${nameB}, ${lower} point) står under ${slotLabel(inCategory[i])} (${nameA}, ${upper} point) trods ${lower - upper} point mere. Da en U17/U19-spiller indgår, afgøres rækkefølgen af vurderet seniorstyrke, ikke point. Vurder selv.`,
                  slots: [inCategory[i].key, inCategory[j].key],
                }
              : {
                  severity: 'error',
                  rule: inCategory[i].size === 1 ? '§ 38 stk. 2' : '§ 38 stk. 3',
                  message: `${slotLabel(inCategory[j])} (${nameB}, ${lower} point) har ${lower - upper} point mere end ${slotLabel(inCategory[i])} (${nameA}, ${upper} point). Højst ${tolerance} point er tilladt.`,
                  slots: [inCategory[i].key, inCategory[j].key],
                },
          )
        }
      }
    }
  }

  // §38 stk. 4: legality against the club's higher-ranked team.
  if (higher && higher.players.length > 0) {
    const seen = new Set<number>()
    for (const slot of slots) {
      for (const p of filled(slot.key)) {
        if (seen.has(p.id) || !p.sex) continue
        seen.add(p.id)
        for (const h of higher.players) {
          if (h.player.sex !== p.sex || h.categories.length === 0) continue
          const ok = h.categories.some((c) => pointsOf(p, c) <= pointsOf(h.player, c) + 50)
          if (!ok) {
            const detail = h.categories
              .map((c) => `${categoryLabel(c)} ${pointsOf(p, c)} mod ${pointsOf(h.player, c)}`)
              .join(', ')
            if (p.youth || h.player.youth) {
              issues.push({
                severity: 'warning',
                rule: '§ 38 stk. 5',
                message: `${p.name} har flere point end ${h.player.name} (${higher.teamName}) i alle de kategorier ${h.player.name} spiller (${detail}). Da en U17/U19-spiller indgår, skal ${p.name} vurderes svagere i mindst én af dem for at være lovlig. Vurder selv.`,
                slots: [slot.key],
              })
            } else {
              issues.push({
                severity: 'error',
                rule: '§ 38 stk. 4',
                message: `${p.name} er ikke lovlig under ${higher.teamName}: mere end 50 point over ${h.player.name} i alle de kategorier ${h.player.name} spiller (${detail}).`,
                slots: [slot.key],
              })
            }
          }
        }
      }
    }
  }

  const order = { error: 0, warning: 1, info: 2 }
  return issues.sort((x, y) => order[x.severity] - order[y.severity])
}

export function verdict(issues: Issue[]): 'legal' | 'illegal' | 'incomplete' {
  if (issues.some((i) => i.severity === 'error')) return 'illegal'
  if (issues.some((i) => i.severity === 'info' && i.rule === '§ 37')) return 'incomplete'
  return 'legal'
}
