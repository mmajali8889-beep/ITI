#!/usr/bin/env sh
# Creates ./secrets for the Medplum stack (roadmap 28.3). Safe to re-run:
# existing secrets are kept. Nothing here is ever committed (see .gitignore).
#
#   postgres_password      database password (also inside medplum.config.json)
#   redis.conf             Redis config with requirepass
#   medplum.config.json    Medplum server config, incl. the initial super-admin
#   admin_password         initial super-admin password (admin@example.com);
#                          change it after first sign-in, then delete this file
set -eu
cd "$(dirname "$0")"
[ -f .env ] && . ./.env
BASE_URL=${MEDPLUM_ADMIN_URL:-http://localhost:8103/}

mkdir -p secrets
chmod 700 secrets
random() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-40; }

keep_or() { # name value-if-missing
  if [ -s "secrets/$1" ]; then echo "kept    secrets/$1"; return; fi
  printf '%s' "$2" > "secrets/$1"
  chmod 644 "secrets/$1"
  echo "created secrets/$1"
}

keep_or postgres_password "$(random)"
keep_or redis_password "$(random)"
keep_or admin_password "$(random)"
keep_or redis.conf "requirepass $(cat secrets/redis_password)
appendonly yes
"
keep_or medplum.config.json "$(cat <<JSON
{
  "port": 8103,
  "baseUrl": "$BASE_URL",
  "appBaseUrl": "http://localhost:3000/",
  "storageBaseUrl": "${BASE_URL}storage/",
  "binaryStorage": "file:./binary/",
  "supportEmail": "\"Medplum\" <support@hospital.local>",
  "allowedOrigins": "http://localhost:3000",
  "introspectionEnabled": true,
  "rateLimitsEnabled": true,
  "vmContextBotsEnabled": false,
  "registerEnabled": false,
  "defaultSuperAdminPassword": "$(cat secrets/admin_password)",
  "database": {
    "host": "postgres",
    "port": 5432,
    "dbname": "medplum",
    "username": "medplum",
    "password": "$(cat secrets/postgres_password)"
  },
  "redis": {
    "host": "redis",
    "port": 6379,
    "password": "$(cat secrets/redis_password)"
  },
  "shutdownTimeoutMilliseconds": 30000
}
JSON
)"
