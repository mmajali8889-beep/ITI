#!/usr/bin/env bash
# UNITECH-EHR restore drill (roadmap 28.4 / 30.1): a full, timed disaster
# recovery rehearsal on a SPARE machine (the staging server), never production.
#
#   restore-drill.sh <set-dir|latest> --on-spare-machine
#
# 1. verify   the backup set restores into scratch targets (restore.sh verify)
# 2. restore  it over this machine's live data (restore.sh restore)
# 3. healthy  wait until $EHR_URL/api/health answers 200
# 4. check    live patient count = manifest; live study count = backup
#
# and writes a report (Markdown + JSON) to $DRILL_REPORT_DIR with the time of
# each step. RTO = restore + healthy; RPO = age of the backup set at the start.
# Exit code 0 only if every step passed. Sign-in and opening a patient with
# images stay manual: the report lists them for the operator to tick.
#
# Env: BACKUP_DIR, EHR_URL (https://localhost), CURL_TLS_OPTS ("-k" for a
# self-signed staging certificate), PRODUCTION_HOSTNAME (refused if it is this
# host), DRILL_REPORT_DIR (/var/lib/unitech-ehr/drills),
# HEALTH_TIMEOUT_SECONDS (900), ORTHANC_PASSWORD_FILE (to count live studies),
# and the container names used by restore.sh.
set -uo pipefail

SET=${1:-}
CONFIRM=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
RESTORE_SCRIPT=${RESTORE_SCRIPT:-$HERE/restore.sh}
EHR_URL=${EHR_URL:-https://localhost}
CURL_TLS_OPTS=${CURL_TLS_OPTS:-}
DRILL_REPORT_DIR=${DRILL_REPORT_DIR:-/var/lib/unitech-ehr/drills}
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-900}
ORTHANC_PASSWORD_FILE=${ORTHANC_PASSWORD_FILE:-}
MEDPLUM_PG_CONTAINER=${MEDPLUM_PG_CONTAINER:-unitech-medplum-postgres-1}
MEDPLUM_PG_USER=${MEDPLUM_PG_USER:-medplum}
MEDPLUM_PG_DB=${MEDPLUM_PG_DB:-medplum}
ORTHANC_CONTAINER=${ORTHANC_CONTAINER:-unitech-ehr-orthanc-1}

die() { echo "restore-drill: $*" >&2; exit 2; }

[ -n "$SET" ] && [ "$CONFIRM" = --on-spare-machine ] \
  || die "usage: $0 <set-dir|latest> --on-spare-machine   (replaces this machine's data)"
if [ -n "${PRODUCTION_HOSTNAME:-}" ] && [ "$(hostname)" = "$PRODUCTION_HOSTNAME" ]; then
  die "this is the production server ($PRODUCTION_HOSTNAME); run the drill on the spare machine"
fi
if [ "$SET" = latest ]; then
  SET=$(ls -1d "${BACKUP_DIR:-/var/backups/unitech-ehr}"/20*Z 2>/dev/null | tail -1)
  [ -n "$SET" ] || die "no backup sets in ${BACKUP_DIR:-/var/backups/unitech-ehr}"
fi
[ -f "$SET/MANIFEST" ] || die "not a backup set (no MANIFEST): $SET"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DRILL_REPORT_DIR" || die "cannot create $DRILL_REPORT_DIR"
LOG="$DRILL_REPORT_DIR/drill-$STAMP.log"
REPORT="$DRILL_REPORT_DIR/drill-$STAMP.md"
JSON="$DRILL_REPORT_DIR/drill-$STAMP.json"
: > "$LOG"

drill_start=$(date +%s)
set_name=$(basename "$SET")
expected_patients=$(sed -n 's/^medplum_patients=//p' "$SET/MANIFEST")
# The set's name is its UTC creation time, e.g. 20261018T020000Z.
set_epoch=$(date -u -d "$(echo "$set_name" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3 \4:\5:\6/')" +%s 2>/dev/null || echo "")
rpo_minutes=""
[ -n "$set_epoch" ] && rpo_minutes=$(( (drill_start - set_epoch) / 60 ))

names=(); results=(); seconds=(); notes=()
failed=0
step() { # name note command...
  local name=$1 note=$2; shift 2
  local started=$(date +%s)
  echo "=== $name ($(date -u +%FT%TZ))" | tee -a "$LOG"
  if [ "$failed" -eq 0 ] && "$@" >> "$LOG" 2>&1; then
    results+=(PASS)
  elif [ "$failed" -eq 1 ]; then
    results+=(SKIPPED)
  else
    results+=(FAIL); failed=1
  fi
  names+=("$name"); notes+=("$note"); seconds+=($(( $(date +%s) - started )))
  echo "    ${results[-1]} in ${seconds[-1]}s" | tee -a "$LOG"
}

verified_studies=""
do_verify() {
  local out
  out=$("$RESTORE_SCRIPT" verify "$SET" 2>&1); local rc=$?
  echo "$out"
  verified_studies=$(echo "$out" | sed -n 's/.*lists \([0-9][0-9]*\) studies.*/\1/p' | tail -1)
  return $rc
}
do_restore() { "$RESTORE_SCRIPT" restore "$SET" --replace-live-data; }
do_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS )) code
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code=$(curl -s $CURL_TLS_OPTS -o /dev/null -w '%{http_code}' --max-time 10 "$EHR_URL/api/health" 2>/dev/null || true)
    echo "health: $code"
    [ "$code" = 200 ] && return 0
    sleep 10
  done
  echo "not healthy after ${HEALTH_TIMEOUT_SECONDS}s"
  return 1
}
live_patients=""; live_studies=""
do_check() {
  live_patients=$(docker exec "$MEDPLUM_PG_CONTAINER" psql -U "$MEDPLUM_PG_USER" -d "$MEDPLUM_PG_DB" -Atc 'select count(*) from "Patient" where deleted = false') || return 1
  echo "patients: live $live_patients, manifest $expected_patients"
  [ "$live_patients" = "$expected_patients" ] || return 1
  if [ -n "$ORTHANC_PASSWORD_FILE" ] && [ -r "$ORTHANC_PASSWORD_FILE" ] && [ -n "$verified_studies" ]; then
    # The password goes over stdin, never on a command line (process listings).
    live_studies=$(docker exec -i "$ORTHANC_CONTAINER" python3 -c "import base64,json,sys,urllib.request as u;p=sys.stdin.read().strip();r=u.Request('http://127.0.0.1:8042/studies',headers={'Authorization':'Basic '+base64.b64encode(('hospital-api:'+p).encode()).decode()});print(len(json.load(u.urlopen(r))))" < "$ORTHANC_PASSWORD_FILE") || return 1
    echo "studies: live $live_studies, backup $verified_studies"
    [ "$live_studies" = "$verified_studies" ] || return 1
  else
    echo "studies: not compared (set ORTHANC_PASSWORD_FILE)"
  fi
}

step verify "backup set restores into scratch targets" do_verify
restore_started=$(date +%s)
step restore "replace this machine's data with the set" do_restore
step healthy "wait for $EHR_URL/api/health = 200" do_healthy
rto_seconds=$(( $(date +%s) - restore_started ))
step check "live patient and study counts match the backup" do_check
total_seconds=$(( $(date +%s) - drill_start ))
outcome=$([ "$failed" -eq 0 ] && echo PASS || echo FAIL)

minutes() { printf '%d min %02d s' $(( $1 / 60 )) $(( $1 % 60 )); }
{
  echo "# Restore drill $STAMP: $outcome"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Machine | $(hostname) |"
  echo "| Operator | ${SUDO_USER:-${USER:-unknown}} |"
  echo "| Backup set | \`$SET\` |"
  echo "| Data age at start (RPO) | ${rpo_minutes:-unknown} min |"
  echo "| Recovery time (RTO: restore + healthy) | $(minutes "$rto_seconds") |"
  echo "| Whole drill | $(minutes "$total_seconds") |"
  echo "| Patients (manifest / live) | ${expected_patients:-?} / ${live_patients:-not checked} |"
  echo "| Studies (backup / live) | ${verified_studies:-?} / ${live_studies:-not checked} |"
  echo
  echo "| Step | Result | Time | What |"
  echo "|---|---|---|---|"
  for i in "${!names[@]}"; do
    echo "| ${names[$i]} | ${results[$i]} | $(minutes "${seconds[$i]}") | ${notes[$i]} |"
  done
  echo
  echo "## Manual checks (tick and sign)"
  echo
  echo "- [ ] Staff sign-in works at $EHR_URL"
  echo "- [ ] A known patient opens with notes, results and invoices"
  echo "- [ ] A study opens in the image viewer"
  echo "- [ ] A patient signs in to the portal"
  echo
  echo "Checked by: ____________________  Date: ____________"
  echo
  echo "Full log: \`$LOG\`"
} > "$REPORT"
{
  printf '{"stamp":"%s","outcome":"%s","host":"%s","set":"%s",' "$STAMP" "$outcome" "$(hostname)" "$SET"
  printf '"rpoMinutes":%s,"rtoSeconds":%s,"totalSeconds":%s,' "${rpo_minutes:-null}" "$rto_seconds" "$total_seconds"
  printf '"patients":{"manifest":%s,"live":%s},' "${expected_patients:-null}" "${live_patients:-null}"
  printf '"studies":{"backup":%s,"live":%s},"steps":[' "${verified_studies:-null}" "${live_studies:-null}"
  for i in "${!names[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"name":"%s","result":"%s","seconds":%s}' "${names[$i]}" "${results[$i]}" "${seconds[$i]}"
  done
  printf ']}\n'
} > "$JSON"

message="UNITECH-EHR restore drill $outcome: RTO $(minutes "$rto_seconds"), RPO ${rpo_minutes:-?} min, report $REPORT"
echo "$message"
logger -t unitech-ehr -p "user.$([ "$outcome" = PASS ] && echo notice || echo err)" "$message" 2>/dev/null || true
[ "$outcome" = PASS ]
