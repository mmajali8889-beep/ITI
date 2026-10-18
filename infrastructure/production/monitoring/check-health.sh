#!/usr/bin/env bash
# UNITECH-EHR health check (roadmap 28.2) for a systemd timer, cron, or a
# monitoring agent (Zabbix/Nagios "exit code" checks). Exit 0 = healthy.
# Problems are written to the system log (journalctl -t unitech-ehr) and, if
# ALERT_CMD is set, passed to it, e.g. ALERT_CMD='mail -s "EHR alert" it@hospital.local'.
set -uo pipefail

EHR_URL=${EHR_URL:-https://ehr.hospital.local}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/unitech-ehr}
MAX_BACKUP_AGE_HOURS=${MAX_BACKUP_AGE_HOURS:-26}
MIN_FREE_GB=${MIN_FREE_GB:-20}
# Set to "-k" only if the server itself does not trust the hospital CA.
CURL_TLS_OPTS=${CURL_TLS_OPTS:-}
ALERT_CMD=${ALERT_CMD:-}
# Error and rate-limit alerts need the API's metrics token (secrets/metrics_token).
METRICS_TOKEN=${METRICS_TOKEN:-}
METRICS_TOKEN_FILE=${METRICS_TOKEN_FILE:-}
MAX_5XX_PER_CHECK=${MAX_5XX_PER_CHECK:-5}
MAX_429_PER_CHECK=${MAX_429_PER_CHECK:-20}
STATE_DIR=${STATE_DIR:-${STATE_DIRECTORY:-/var/lib/unitech-ehr}}

problems=()

# 1. Application readiness: proxy -> API -> Medplum and Orthanc.
body=$(curl -sS $CURL_TLS_OPTS --max-time 15 -w '\n%{http_code}' "$EHR_URL/api/health" 2>&1) || true
code=${body##*$'\n'}
if [ "$code" != 200 ]; then
  problems+=("application health is $code: $(echo "${body%$'\n'*}" | tr -d '\n' | cut -c1-200)")
fi

# 2. Server errors and rate limiting since the last check, from the API's
#    counters. The first run only records a baseline; an API restart resets
#    the counters (its uptime goes down), so counting starts again from zero.
if [ -z "$METRICS_TOKEN" ] && [ -n "$METRICS_TOKEN_FILE" ] && [ -r "$METRICS_TOKEN_FILE" ]; then
  METRICS_TOKEN=$(tr -d '\r\n' < "$METRICS_TOKEN_FILE")
fi
if [ -n "$METRICS_TOKEN" ]; then
  metrics=$(curl -sS $CURL_TLS_OPTS --max-time 10 -H "Authorization: Bearer $METRICS_TOKEN" "$EHR_URL/api/health/metrics" 2>/dev/null) || metrics=""
  metric() { printf '%s\n' "$metrics" | awk -v name="$1" '$1 == name { print $2; exit }'; }
  errors=$(metric ehr_http_errors_total)
  limited=$(metric ehr_http_rate_limited_total)
  throttled=$(metric ehr_medplum_throttled_total)
  uptime=$(metric ehr_process_uptime_seconds)
  if [ -z "$errors" ] || [ -z "$limited" ] || [ -z "$throttled" ] || [ -z "$uptime" ]; then
    problems+=("API metrics are unavailable (check METRICS_TOKEN)")
  else
    state="$STATE_DIR/metrics.last"
    last=""
    [ -r "$state" ] && last=$(cat "$state")
    mkdir -p "$STATE_DIR" 2>/dev/null && echo "$errors $limited $throttled $uptime" > "$state"
    if [ -n "$last" ]; then
      read -r last_errors last_limited last_throttled last_uptime <<< "$last"
      if [ "$uptime" -lt "$last_uptime" ]; then
        last_errors=0; last_limited=0; last_throttled=0
      fi
      new_throttled=$(( throttled - last_throttled ))
      # Medplum throttling is answered as 503; report it with rate limiting, not as an error.
      new_errors=$(( errors - last_errors - new_throttled ))
      new_limited=$(( limited - last_limited ))
      [ "$new_errors" -le "$MAX_5XX_PER_CHECK" ] || problems+=("$new_errors server errors (5xx) since the last check")
      [ $(( new_limited + new_throttled )) -le "$MAX_429_PER_CHECK" ] || problems+=("$new_limited rate-limited (429) responses and $new_throttled Medplum throttles since the last check")
    fi
  fi
fi

# 3. A recent backup exists.
latest=$(ls -1d "$BACKUP_DIR"/20*Z 2>/dev/null | tail -1)
if [ -z "$latest" ] || [ ! -f "$latest/SHA256SUMS" ]; then
  problems+=("no complete backup set in $BACKUP_DIR")
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest/SHA256SUMS") ) / 3600 ))
  [ "$age_h" -le "$MAX_BACKUP_AGE_HOURS" ] || problems+=("last backup is ${age_h}h old ($latest)")
fi

# 4. Room for tomorrow's backup.
free_gb=$(df -P -BG "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ -n "$free_gb" ] && [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  problems+=("only ${free_gb}G free on the backup disk")
fi

if [ "${#problems[@]}" -eq 0 ]; then
  echo "OK: application healthy, last backup $(basename "${latest:-none}")"
  exit 0
fi
message="UNITECH-EHR: ${problems[*]}"
echo "$message" >&2
logger -t unitech-ehr -p user.err "$message" 2>/dev/null || true
[ -n "$ALERT_CMD" ] && echo "$message" | sh -c "$ALERT_CMD"
exit 1
