#!/usr/bin/env bash
#
# Weekly data refresh for the current season.
#
# Collects the season from badmintonplayer.dk into a staging directory, checks the
# result looks sane, and only then loads it into both warehouses. Run by the
# badminton-refresh.timer systemd unit; safe to run by hand:
#
#   /root/jaxels20.github.io/deploy/weekly-refresh.sh          # current season
#   /root/jaxels20.github.io/deploy/weekly-refresh.sh 2024     # a specific season
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/jaxels20.github.io}"
DEPLOY_DIR="$REPO_DIR/deploy"
LOG_DIR="${LOG_DIR:-/var/log/badminton}"
LOCK_FILE="${LOCK_FILE:-/var/lock/badminton-refresh.lock}"
CONTAINER_LIVE_DIR="/app/badminton_export_live"

# Collection politeness and sanity thresholds.
COLLECT_DELAY="${COLLECT_DELAY:-0.25}"
MIN_LINES="${MIN_LINES:-50}"
SHRINK_TOLERANCE_PCT="${SHRINK_TOLERANCE_PCT:-90}"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

# The Danish team season starts in the autumn: season 2025 runs Sep 2025 - Apr 2026.
current_season() {
    local year month
    year=$(date +%Y)
    month=$(date +%-m)
    if [ "$month" -ge 8 ]; then echo "$year"; else echo "$((year - 1))"; fi
}

SEASON="${1:-$(current_season)}"
[[ "$SEASON" =~ ^[0-9]{4}$ ]] || fail "season must be a four-digit year, got '$SEASON'"

cd "$DEPLOY_DIR" || fail "no deploy directory at $DEPLOY_DIR"
[ -f .env ] || fail "no $DEPLOY_DIR/.env"

# shellcheck disable=SC1091
LIVE_DIR="$(grep -E '^BADMINTON_LIVE_DIR=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"
[ -n "$LIVE_DIR" ] || fail "set BADMINTON_LIVE_DIR in $DEPLOY_DIR/.env (a directory OUTSIDE the git checkout)"
case "$(readlink -f "$LIVE_DIR")/" in
    "$(readlink -f "$REPO_DIR")"/*)
        fail "BADMINTON_LIVE_DIR must be outside $REPO_DIR; deploys run 'git reset --hard' and would discard collected data"
        ;;
esac
mkdir -p "$LIVE_DIR/staging" "$LOG_DIR"

compose() { docker compose --env-file .env "$@"; }

STEM="season_${SEASON}_all_groups"
FILES=(
    "${STEM}_full.json"
    "${STEM}_groups.csv"
    "${STEM}_team_matches.csv"
    "${STEM}_individual_matches.csv"
)

check_file() {
    local name="$1" new="$LIVE_DIR/staging/$1" old="$LIVE_DIR/$1" new_lines old_lines floor
    [ -s "$new" ] || fail "collection produced no $name"
    new_lines=$(wc -l < "$new")
    [ "$new_lines" -ge "$MIN_LINES" ] || fail "$name has only $new_lines lines (expected at least $MIN_LINES)"
    if [ -f "$old" ]; then
        old_lines=$(wc -l < "$old")
        floor=$((old_lines * SHRINK_TOLERANCE_PCT / 100))
        [ "$new_lines" -ge "$floor" ] || fail "$name shrank from $old_lines to $new_lines lines; keeping the old data"
        log "  $name: $old_lines -> $new_lines lines"
    else
        log "  $name: $new_lines lines (new file)"
    fi
}

main() {
    log "=== weekly refresh, season $SEASON ($((SEASON + 1)) spring), live dir $LIVE_DIR"

    log "collecting from badmintonplayer.dk (this takes a few minutes)"
    compose run --rm -T backend python refresh_season_data.py \
        --year "$SEASON" \
        --output-dir "$CONTAINER_LIVE_DIR/staging" \
        --delay "$COLLECT_DELAY" \
        --skip-individual-load \
        --skip-team-load \
        || fail "collection failed"

    log "checking collected files"
    for name in "${FILES[@]}"; do check_file "$name"; done

    log "promoting staged files"
    for name in "${FILES[@]}"; do
        mv -f "$LIVE_DIR/staging/$name" "$LIVE_DIR/$name"
    done

    log "loading season $SEASON into both warehouses"
    compose run --rm -T backend python refresh_season_data.py \
        --year "$SEASON" \
        --output-dir "$CONTAINER_LIVE_DIR" \
        --skip-collect \
        --db-host db --db-port 5432 --db-user postgres --psql-bin psql \
        || fail "warehouse load failed"

    log "clearing API cache"
    compose exec -T backend python -c \
        "import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:8000/api/v2/cache/clear', method='POST'), timeout=10)" \
        || log "WARNING: could not clear the API cache; it expires on its own within 10 minutes"

    log "=== done"
}

exec 9>"$LOCK_FILE"
flock -n 9 || fail "another refresh is already running"

LOG_FILE="$LOG_DIR/refresh-$(date -u +%Y%m%d-%H%M%S)-${SEASON}.log"
main 2>&1 | tee -a "$LOG_FILE"
status=${PIPESTATUS[0]}
find "$LOG_DIR" -name 'refresh-*.log' -mtime +90 -delete 2>/dev/null || true
exit "$status"
