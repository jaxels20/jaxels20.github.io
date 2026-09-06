export type Entity = { name: string; slug: string; /** badmintonplayer.dk id, players only */ id?: number | null }
export type Result = 'W' | 'L' | 'D'

export type Season = { seasonId: number; label: string }
export type SeasonsResponse = {
  seasons: Season[]
  /** When the season exports were last replaced by the weekly refresh. */
  dataUpdated: string | null
  /** Date of the most recent match that has a result. */
  latestMatch: string | null
}

export type SearchTeam = Entity & { seasons: number; lastSeason: number; teamMatches: number }
export type SearchPlayer = Entity & { matches: number; lastSeason: number; team: Entity | null }
export type SearchResponse = { query: string; teams: SearchTeam[]; players: SearchPlayer[] }

export type TeamSummary = {
  teamMatches: number
  teamWins: number
  teamDraws: number
  teamLosses: number
  teamWinPct: number | null
  matches: number
  wins: number
  losses: number
  winPct: number | null
  walkovers: number
  nonWalkoverMatches: number
  nonWalkoverWinPct: number | null
  setsWon: number
  setsLost: number
  setWinPct: number | null
  pointsWon: number
  pointsLost: number
  pointWinPct: number | null
  avgPointMargin: number | null
  threeSetMatches: number
  threeSetWins: number
  threeSetWinPct: number | null
}

export type MatchTypeStat = {
  matchType: string
  code: string
  number: number | null
  played: number
  wins: number
  losses: number
  winPct: number | null
  setsWon?: number
  setsLost?: number
}

export type DisciplineStat = {
  code: string
  played: number
  wins: number
  losses: number
  winPct: number | null
  setWinPct: number | null
  pointWinPct: number | null
}

export type SideRecord = {
  played: number
  wins: number
  draws?: number
  losses: number
  winPct: number | null
}

export type TeamOpponent = {
  team: Entity
  played: number
  wins: number
  draws: number
  losses: number
  winPct: number | null
  disciplinesWon: number
  disciplinesLost: number
}

export type TeamPlayer = {
  player: Entity
  teamMatches: number
  matches: number
  wins: number
  losses: number
  winPct: number | null
  nonWalkoverWinPct: number | null
  setsWon: number
  setsLost: number
  disciplines: string[]
}

export type TeamPair = {
  players: [Entity, Entity]
  code: string
  played: number
  wins: number
  losses: number
  winPct: number | null
}

export type TeamSeasonTrend = {
  seasonId: number
  divisions: string
  teamMatches: number
  wins: number
  draws: number
  losses: number
  teamWinPct: number | null
  disciplinesWon: number
  disciplinesLost: number
  disciplineWinPct: number | null
  pointsWon: number
  pointsLost: number
  pointDelta: number
}

export type TeamMatch = {
  matchId: number
  seasonId: number
  groupId: number
  groupName: string
  division: string
  date: string
  round: number | null
  home: boolean
  opponent: Entity
  result: Result
  disciplinesWon: number
  disciplinesLost: number
  setsWon: number
  setsLost: number
  pointsWon: number
  pointsLost: number
}

export type TeamSeasonEntry = {
  seasonId: number
  division: string
  groupName: string
  groupId: number
  teamMatches: number
}

export type TeamProfile = {
  team: Entity
  seasonId: number | null
  seasons: TeamSeasonEntry[]
  summary: TeamSummary
  form: Result[]
  byMatchType: MatchTypeStat[]
  byDiscipline: DisciplineStat[]
  homeAway: { home: SideRecord | null; away: SideRecord | null }
  opponents: TeamOpponent[]
  players: TeamPlayer[]
  pairs: TeamPair[]
  seasonTrend: TeamSeasonTrend[]
  matches: TeamMatch[]
}

export type PlayerSummary = {
  matches: number
  wins: number
  losses: number
  winPct: number | null
  teamMatches: number
  walkovers: number
  nonWalkoverMatches: number
  nonWalkoverWinPct: number | null
  setsWon: number
  setsLost: number
  setWinPct: number | null
  pointsWon: number
  pointsLost: number
  pointWinPct: number | null
  avgPointMargin: number | null
  threeSetMatches: number
  threeSetWins: number
  threeSetWinPct: number | null
  straightSetWins: number
  straightSetLosses: number
}

export type PlayerTeam = {
  team: Entity
  firstSeason: number
  lastSeason: number
  divisions: string
  played: number
  wins: number
  winPct: number | null
}

export type PlayerOpponentTeam = { team: Entity; played: number; wins: number; winPct: number | null }

export type PlayerPartner = {
  player: Entity
  disciplines: string[]
  played: number
  wins: number
  losses: number
  winPct: number | null
}

export type PlayerRival = { player: Entity; played: number; wins: number; losses: number; winPct: number | null }

export type PlayerSeasonTrend = {
  seasonId: number
  divisions: string
  played: number
  wins: number
  losses: number
  winPct: number | null
  pointsWon: number
  pointsLost: number
  pointDelta: number
}

export type PlayerMatch = {
  matchId: number
  seasonId: number
  groupId: number
  groupName: string
  division: string
  date: string
  round: number | null
  matchType: string
  code: string
  home: boolean
  team: Entity
  opponentTeam: Entity
  partner: Entity | null
  opponents: Entity[]
  result: 'W' | 'L'
  setsWon: number
  setsLost: number
  pointsWon: number
  pointsLost: number
  setsPlayed: number
  walkover: boolean
  walkoverCode: string | null
  setScores: string
}

export type PlayerSeasonEntry = { seasonId: number; team: Entity; division: string; played: number }

export type PlayerProfile = {
  player: Entity
  seasonId: number | null
  seasons: PlayerSeasonEntry[]
  currentTeam: Entity | null
  summary: PlayerSummary
  form: ('W' | 'L')[]
  byDiscipline: DisciplineStat[]
  byMatchType: MatchTypeStat[]
  homeAway: { home: SideRecord | null; away: SideRecord | null }
  teams: PlayerTeam[]
  opponentTeams: PlayerOpponentTeam[]
  partners: PlayerPartner[]
  rivals: PlayerRival[]
  seasonTrend: PlayerSeasonTrend[]
  matches: PlayerMatch[]
}

export type H2HSide = {
  team: Entity
  summary: TeamSummary
  form: Result[]
  byMatchType: MatchTypeStat[]
  byDiscipline: DisciplineStat[]
}

export type DirectTeamMatch = {
  matchId: number
  seasonId: number
  groupId: number
  groupName: string
  division: string
  date: string
  round: number | null
  aHome: boolean
  aDisciplines: number
  bDisciplines: number
  result: Result
}

export type CommonOpponent = {
  team: Entity
  a: { played: number; wins: number; winPct: number | null; disciplinesWon: number; disciplinesLost: number }
  b: { played: number; wins: number; winPct: number | null; disciplinesWon: number; disciplinesLost: number }
}

export type TeamHeadToHead = {
  seasonId: number | null
  a: H2HSide
  b: H2HSide
  direct: {
    played: number
    aWins: number
    bWins: number
    draws: number
    aDisciplines: number
    bDisciplines: number
    matches: DirectTeamMatch[]
    byMatchType: { matchType: string; code: string; number: number | null; played: number; aWins: number; bWins: number }[]
  }
  commonOpponents: CommonOpponent[]
}

export type CompareSide = {
  player: Entity
  currentTeam: Entity | null
  summary: PlayerSummary
  form: ('W' | 'L')[]
  byDiscipline: DisciplineStat[]
  byMatchType: MatchTypeStat[]
}

export type PlayerMeeting = {
  matchId: number
  seasonId: number
  groupId: number
  groupName: string
  division: string
  date: string
  matchType: string
  code: string
  aHome: boolean
  homeTeam: Entity
  awayTeam: Entity
  aWon: boolean
  aSets: number
  bSets: number
  walkover: boolean
  setScores: string
  aPartner: Entity | null
  bPartner: Entity | null
}

export type PlayerComparison = {
  seasonId: number | null
  a: CompareSide
  b: CompareSide
  meetings: { played: number; aWins: number; bWins: number; matches: PlayerMeeting[] }
  together: { played: number; wins: number; matches: PlayerMeeting[] }
}

export type LeagueGroup = {
  groupId: number
  name: string
  teams: number
  matches: number
  played: number
  firstDate: string | null
  lastDate: string | null
}

export type LeagueDivision = { name: string; tier: number; groups: LeagueGroup[] }
export type LeaguesResponse = { seasonId: number; divisions: LeagueDivision[] }

export type StandingRow = {
  rank: number
  team: Entity
  played: number
  wins: number
  draws: number
  losses: number
  disciplinesFor: number
  disciplinesAgainst: number
  disciplineDiff: number
  points: number
  pointsAgainst: number
}

export type GroupMatch = {
  matchId: number
  date: string | null
  time: string | null
  scheduled: string | null
  home: Entity
  away: Entity
  played: boolean
  homeDisciplines: number | null
  awayDisciplines: number | null
  homePoints: number | null
  awayPoints: number | null
  walkover: boolean
  venue: string | null
}

export type GroupRound = { round: number | null; label: string | null; date: string | null; matches: GroupMatch[] }

export type GroupDetail = {
  seasonId: number
  seasonLabel: string
  groupId: number
  name: string
  division: string
  standings: StandingRow[]
  rounds: GroupRound[]
}

export type MatchPlayer = Entity & { placeholder: boolean }

export type MatchGame = {
  matchType: string
  code: string
  number: number | null
  homePlayers: MatchPlayer[]
  awayPlayers: MatchPlayer[]
  winner: 'home' | 'away'
  homeSets: number
  awaySets: number
  setsPlayed: number
  homePoints: number
  awayPoints: number
  walkover: boolean
  walkoverCode: string | null
  setScores: string | null
}

export type MatchDetail = {
  matchId: number
  seasonId: number
  seasonLabel: string
  groupId: number
  groupName: string
  division: string
  round: number | null
  roundLabel: string | null
  date: string | null
  time: string | null
  scheduled: string | null
  venue: string | null
  organizer: string | null
  livescoreUrl: string | null
  played: boolean
  home: Entity
  away: Entity
  homeDisciplines: number
  awayDisciplines: number
  homePoints: number | null
  awayPoints: number | null
  walkover: boolean
  games: MatchGame[]
}

export type LeaderboardEntry = {
  player: Entity
  team: Entity
  matches: number
  wins: number
  losses: number
  winPct: number | null
  value: number | null
  unit: string
  threeSetMatches?: number
  threeSetWins?: number
}

export type LeaderboardPair = {
  players: [Entity, Entity]
  team: Entity
  disciplines: string[]
  matches: number
  wins: number
  losses: number
  winPct: number | null
  value: number | null
  unit: string
}

export type Leaderboards = {
  seasonId: number
  division: string | null
  divisions: string[]
  minMatches: number
  playerCount: number
  lists: {
    winPct: LeaderboardEntry[]
    mostWins: LeaderboardEntry[]
    mostMatches: LeaderboardEntry[]
    singles: LeaderboardEntry[]
    doubles: LeaderboardEntry[]
    threeSet: LeaderboardEntry[]
    pointMargin: LeaderboardEntry[]
    pairs: LeaderboardPair[]
  }
}

export type RankingList = {
  list: string
  group: string | null
  points: number
  matches: number | null
  place: number | null
}

export type PlayerRanking = {
  player: { name: string; id: number }
  profileUrl: string
  club: string | null
  currentSeasonId: number | null
  lists: RankingList[]
  levels: { seasonId: number; level: number }[]
  rankingList: RankingListStatus
}

export type LineupFormat = {
  matches: 9 | 13
  minMen: number
  minWomen: number
  maxPerPlayer: number | null
  division: string
}

export type LineupSetupPlayer = Entity & {
  sex: 'M' | 'F' | null
  team: Entity
  /** Season the player was last seen for that team; may be the previous one early in a season. */
  lastSeason: number
  teamMatches: number
  matches: number
  disciplines: string[]
}

export type LineupLatest = {
  matchId: number
  seasonId: number
  groupId: number
  date: string
  opponent: Entity
  players: (Entity & { sex: 'M' | 'F' | null; slots: string[] })[]
}

export type LineupSetup = {
  team: Entity
  seasonId: number
  format: LineupFormat
  players: LineupSetupPlayer[]
  higherTeam: { team: Entity; lineup: LineupLatest | null } | null
  otherTeams: Entity[]
}

export type LineupClubTeam = {
  team: Entity
  rank: number
  seasonId: number
  format: LineupFormat
  latestLineup: LineupLatest | null
}

export type LineupClub = {
  club: string
  seasonId: number
  teams: LineupClubTeam[]
  players: LineupSetupPlayer[]
}

export type RankingListVersion = { name: string; published: string | null; validFrom: string; validTo: string | null }

export type RankingListStatus = {
  /** Date of the latest daily update, which is what the points on the site come from. */
  latestUpdate: string | null
  /** Monthly list the regulation applies today (§38 stk. 1 a). */
  applicable: RankingListVersion | null
  upcoming: RankingListVersion | null
  checkedAt: string
}

export type LineupPoints = {
  rankingList: RankingListStatus
  seasonId: number
  points: Record<
    string,
    { id: number; club: string | null; ageGroup: string | null; youth: boolean; single: number | null; double: number | null; mix: number | null; seasonId: number }
  >
}

export type OptimisePlayer = Entity & { rating: number; matches: number; points: number; youth?: boolean; unusual?: boolean }

export type OptimiseDetail = {
  slot: string
  ours: OptimisePlayer[]
  ourRating: number
  ourPoints: number
  theirs: OptimisePlayer[]
  theirRating: number
  pWin: number
}

export type OptimiseCandidate = {
  expectedWins: number
  slots: Record<string, number[]>
  details: OptimiseDetail[]
}

export type OptimiseResult = {
  team: Entity
  opponent: Entity
  format: LineupFormat
  opponentLineup: { date: string; against: Entity; players: (Entity & { sex: 'M' | 'F' | null; slots: string[] })[] } | null
  candidates: OptimiseCandidate[]
  excluded: { player: Entity; reason: string }[]
  notes: string[]
  model: string
}
