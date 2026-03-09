# BadmintonPlayer HoldTurnering API Usage (`#1`, `#4` and `#5`)

This document explains the API calls used by these pages:

- All groups/divisions for a season:  
  `https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,,`

- All team matches in a group/year:  
  `https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#4,2025,17917,1,1,,,-3,`
- Single match details:  
  `https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#5,2025,17917,1,1,,485505,-3,`

Both are powered by the same backend endpoint.

## 1. Endpoint

`POST https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding`

Headers:

- `Content-Type: application/json; charset=UTF-8`
- `X-Requested-With: XMLHttpRequest` (recommended)

Response format:

- JSON object with a `d` field
- `d.html` contains HTML markup for the requested view

## 2. Required parameter: `callbackcontextkey`

You must provide a valid `callbackcontextkey` (from page JS variable `SR_CallbackContext`), otherwise the API returns:

`{"Message":"There was an error processing the request.", ...}`

Get it from the same page:

```bash
curl -sSL 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/' \
  | rg -o "SR_CallbackContext = '[^']+'" \
  | sed -E "s/.*'([^']+)'.*/\1/"
```

## 3. Hash to API payload mapping

The hash has 9 positional values:

`#subPage,seasonID,leagueGroupID,ageGroupID,regionID,leagueGroupTeamID,leagueMatchID,clubID,playerID`

Mapping used in the POST body:

- `subPage`
- `seasonID`
- `leagueGroupID`
- `ageGroupID`
- `regionID`
- `leagueGroupTeamID`
- `leagueMatchID`
- `clubID`
- `playerID`

Empty hash values should be sent as `null`.

## 4. API call for page `#1` (all groups/divisions)

URL hash:

`#1,2025,,1,1,,,,`

Payload:

```json
{
  "callbackcontextkey": "<SR_CallbackContext>",
  "subPage": 1,
  "seasonID": 2025,
  "leagueGroupID": null,
  "ageGroupID": 1,
  "regionID": 1,
  "leagueGroupTeamID": null,
  "leagueMatchID": null,
  "clubID": null,
  "playerID": null
}
```

What you get:

- `d.html` contains a `selectgroup` table
- rows grouped by division (`divisionrow`) and group links (`grouprow`)
- each group link points to a `ShowStanding('2', ..., '<leagueGroupID>', ...)` call.

## 5. API call for page `#4` (all matches list)

URL hash:

`#4,2025,17917,1,1,,,-3,`

Payload:

```json
{
  "callbackcontextkey": "<SR_CallbackContext>",
  "subPage": 4,
  "seasonID": 2025,
  "leagueGroupID": 17917,
  "ageGroupID": 1,
  "regionID": 1,
  "leagueGroupTeamID": null,
  "leagueMatchID": null,
  "clubID": -3,
  "playerID": null
}
```

`curl` example:

```bash
ctx=$(curl -sSL 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/' \
  | rg -o "SR_CallbackContext = '[^']+'" \
  | sed -E "s/.*'([^']+)'.*/\1/")

curl -sS 'https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding' \
  -H 'Content-Type: application/json; charset=UTF-8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data-raw "{\"callbackcontextkey\":\"$ctx\",\"subPage\":4,\"seasonID\":2025,\"leagueGroupID\":17917,\"ageGroupID\":1,\"regionID\":1,\"leagueGroupTeamID\":null,\"leagueMatchID\":null,\"clubID\":-3,\"playerID\":null}"
```

What you get:

- `d.html` contains a table (`class='matchlist'`) with match numbers and scores.
- Each match number links to a `ShowStanding('5', ..., '<matchId>', ...)` call.

## 6. API call for page `#5` (single match details)

URL hash:

`#5,2025,17917,1,1,,485505,-3,`

Payload:

```json
{
  "callbackcontextkey": "<SR_CallbackContext>",
  "subPage": 5,
  "seasonID": 2025,
  "leagueGroupID": 17917,
  "ageGroupID": 1,
  "regionID": 1,
  "leagueGroupTeamID": null,
  "leagueMatchID": 485505,
  "clubID": -3,
  "playerID": null
}
```

`curl` example:

```bash
ctx=$(curl -sSL 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/' \
  | rg -o "SR_CallbackContext = '[^']+'" \
  | sed -E "s/.*'([^']+)'.*/\1/")

curl -sS 'https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding' \
  -H 'Content-Type: application/json; charset=UTF-8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data-raw "{\"callbackcontextkey\":\"$ctx\",\"subPage\":5,\"seasonID\":2025,\"leagueGroupID\":17917,\"ageGroupID\":1,\"regionID\":1,\"leagueGroupTeamID\":null,\"leagueMatchID\":485505,\"clubID\":-3,\"playerID\":null}"
```

What you get:

- `d.html` contains match details (venue, teams, result)
- and full per-discipline game rows and set scores.

## 7. Python scripts in this repo

Use the script:

`fetch_match_via_api.py`

For all-groups collection from `#1`, use:

`collect_all_groups_api.py`

Example:

```bash
python3 collect_all_groups_api.py \
  --url "https://badmintonplayer.dk/DBF/HoldTurnering/Stilling/#1,2025,,1,1,,,,"
```

Examples:

```bash
# #4 list page
python3 fetch_match_via_api.py \
  --url "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#4,2025,17917,1,1,,,-3,"

# #5 match details page
python3 fetch_match_via_api.py \
  --url "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#5,2025,17917,1,1,,485505,-3,"

# Save outputs
python3 fetch_match_via_api.py \
  --url "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#5,2025,17917,1,1,,485505,-3," \
  --output-html match_485505.html \
  --output-json match_485505.json
```

## 8. Practical workflow

1. Call `subPage=1` for a season/year to discover all groups (`leagueGroupID`).
2. Call `subPage=4` per group to get all match IDs from `d.html`.
3. Call `subPage=5` per match ID to get detailed match + game data.
