#!/usr/bin/env sh
# Creates ./secrets for the on-premise stack (roadmap 24.7). Safe to re-run:
# existing secrets are kept. Nothing here is ever committed (see .gitignore).
#
# Generated:  auth_session_secret, orthanc_password, orthanc_users.json
# Asked for:  medplum_client_secret            (from the Medplum ClientApplication)
#             medplum_provisioning_password     (optional; enables creating staff logins)
# Non-interactive: set MEDPLUM_CLIENT_SECRET / MEDPLUM_PROVISIONING_PASSWORD in the environment.
set -eu
cd "$(dirname "$0")"

# The directory keeps other users on the server out; the files themselves are
# readable so the non-root API container can read its bind-mounted secrets.
mkdir -p secrets certs
chmod 700 secrets

random() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-48; }

write() { # name value
  printf '%s' "$2" > "secrets/$1"
  chmod 644 "secrets/$1"
  echo "created secrets/$1"
}

keep_or() { # name value-if-missing
  if [ -s "secrets/$1" ]; then echo "kept    secrets/$1"; else write "$1" "$2"; fi
}

ask() { # name prompt env-value
  if [ -e "secrets/$1" ]; then echo "kept    secrets/$1"; return; fi
  value="$3"
  if [ -z "$value" ] && [ -t 0 ]; then
    printf '%s: ' "$2"
    stty -echo 2>/dev/null || true
    read -r value
    stty echo 2>/dev/null || true
    echo
  fi
  write "$1" "$value"
}

keep_or auth_session_secret "$(random)"
keep_or orthanc_password "$(random)"
# Orthanc reads its service account from this file; it must match orthanc_password.
printf '{ "RegisteredUsers": { "hospital-api": "%s" } }\n' "$(cat secrets/orthanc_password)" > secrets/orthanc_users.json
chmod 644 secrets/orthanc_users.json
echo "updated secrets/orthanc_users.json"

ask medplum_client_secret "Medplum client secret" "${MEDPLUM_CLIENT_SECRET:-}"
ask medplum_provisioning_password "Medplum provisioning password (Enter to skip)" "${MEDPLUM_PROVISIONING_PASSWORD:-}"

if [ ! -s secrets/medplum_client_secret ]; then
  echo "WARNING: secrets/medplum_client_secret is empty; the API will refuse to start." >&2
fi
