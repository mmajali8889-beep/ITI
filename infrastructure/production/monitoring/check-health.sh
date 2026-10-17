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

problems=()

# 1. Application readiness: proxy -> API -> Medplum and Orthanc.
body=$(curl -sS $CURL_TLS_OPTS --max-time 15 -w '\n%{http_code}' "$EHR_URL/api/health" 2>&1) || true
code=${body##*$'\n'}
if [ "$code" != 200 ]; then
  problems+=("application health is $code: $(echo "${body%$'\n'*}" | tr -d '\n' | cut -c1-200)")
fi

# 2. A recent backup exists.
latest=$(ls -1d "$BACKUP_DIR"/20*Z 2>/dev/null | tail -1)
if [ -z "$latest" ] || [ ! -f "$latest/SHA256SUMS" ]; then
  problems+=("no complete backup set in $BACKUP_DIR")
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest/SHA256SUMS") ) / 3600 ))
  [ "$age_h" -le "$MAX_BACKUP_AGE_HOURS" ] || problems+=("last backup is ${age_h}h old ($latest)")
fi

# 3. Room for tomorrow's backup.
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
