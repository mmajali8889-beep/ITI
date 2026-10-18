#!/usr/bin/env bash
# UNITECH-EHR restore (roadmap 28.1 / 28.4).
#
#   restore.sh verify  <set-dir>                       safe: restores into scratch
#                                                      targets, checks, cleans up
#   restore.sh restore <set-dir> --replace-live-data   disaster recovery: replaces
#                                                      the live database and images
#
# Run "verify" regularly (e.g. weekly): a backup is trusted only once it restores.
set -euo pipefail

MODE=${1:-}; SET=${2:-}
MEDPLUM_PG_CONTAINER=${MEDPLUM_PG_CONTAINER:-unitech-medplum-postgres-1}
MEDPLUM_PG_USER=${MEDPLUM_PG_USER:-medplum}
MEDPLUM_PG_DB=${MEDPLUM_PG_DB:-medplum}
MEDPLUM_BINARY_VOLUME=${MEDPLUM_BINARY_VOLUME:-unitech-medplum_binary-data}
ORTHANC_CONTAINER=${ORTHANC_CONTAINER:-unitech-ehr-orthanc-1}
ORTHANC_VOLUME=${ORTHANC_VOLUME:-unitech-ehr_orthanc-db}
ORTHANC_IMAGE=${ORTHANC_IMAGE:-orthancteam/orthanc:24.10.3}
API_CONTAINER=${API_CONTAINER:-unitech-ehr-api-1}
PROXY_CONTAINER=${PROXY_CONTAINER:-unitech-ehr-proxy-1}
MEDPLUM_SERVER_CONTAINER=${MEDPLUM_SERVER_CONTAINER:-unitech-medplum-medplum-server-1}

log() { echo "$(date -u +%FT%TZ) restore: $*"; }
die() { log "ERROR: $*"; exit 1; }

[ "$MODE" = verify ] || [ "$MODE" = restore ] || die "usage: $0 verify|restore <set-dir|latest> [--replace-live-data]"
if [ "$SET" = latest ]; then
  SET=$(ls -1d "${BACKUP_DIR:-/var/backups/unitech-ehr}"/20*Z 2>/dev/null | tail -1)
  [ -n "$SET" ] || die "no backup sets in ${BACKUP_DIR:-/var/backups/unitech-ehr}"
fi
[ -d "$SET" ] || die "backup set not found: $SET"
log "checking checksums"
(cd "$SET" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch: the set is damaged"
expected_patients=$(sed -n 's/^medplum_patients=//p' "$SET/MANIFEST")

orthanc_study_count() { # container
  docker exec "$1" python3 -c "import json,urllib.request;print(len(json.load(urllib.request.urlopen('http://127.0.0.1:8042/studies'))))"
}

if [ "$MODE" = verify ]; then
  TAG="verify$$"
  SCRATCH_DB="medplum_restore_$TAG"
  SCRATCH_VOL="ehr_restore_$TAG"
  SCRATCH_ORTHANC="ehr-restore-$TAG"
  cleanup() {
    docker rm -f "$SCRATCH_ORTHANC" >/dev/null 2>&1 || true
    docker volume rm "$SCRATCH_VOL" >/dev/null 2>&1 || true
    docker exec "$MEDPLUM_PG_CONTAINER" dropdb -U "$MEDPLUM_PG_USER" --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  log "restoring PostgreSQL into scratch database $SCRATCH_DB"
  docker exec "$MEDPLUM_PG_CONTAINER" createdb -U "$MEDPLUM_PG_USER" "$SCRATCH_DB"
  docker exec -i "$MEDPLUM_PG_CONTAINER" pg_restore -U "$MEDPLUM_PG_USER" -d "$SCRATCH_DB" --no-owner --exit-on-error < "$SET/medplum.pgdump"
  restored_patients=$(docker exec "$MEDPLUM_PG_CONTAINER" psql -U "$MEDPLUM_PG_USER" -d "$SCRATCH_DB" -Atc 'select count(*) from "Patient" where deleted = false')
  [ "$restored_patients" = "$expected_patients" ] || die "patients: restored $restored_patients, manifest $expected_patients"
  log "PostgreSQL OK: $restored_patients patients, as in the manifest"

  files=$(tar tzf - < "$SET/medplum-binary.tar.gz" | grep -vc '/$' || true)
  log "Medplum file storage OK: archive lists $files files"

  log "restoring Orthanc into scratch volume $SCRATCH_VOL"
  docker volume create "$SCRATCH_VOL" >/dev/null
  docker run --rm -i -v "$SCRATCH_VOL":/data --entrypoint tar "$ORTHANC_IMAGE" xzf - -C /data < "$SET/orthanc-db.tar.gz"
  docker run -d --name "$SCRATCH_ORTHANC" -v "$SCRATCH_VOL":/var/lib/orthanc/db -e ORTHANC__AUTHENTICATION_ENABLED=false "$ORTHANC_IMAGE" >/dev/null
  for _ in $(seq 1 30); do orthanc_study_count "$SCRATCH_ORTHANC" >/dev/null 2>&1 && break; sleep 2; done
  studies=$(orthanc_study_count "$SCRATCH_ORTHANC") || die "restored Orthanc did not start"
  log "Orthanc OK: restored copy starts and lists $studies studies"
  log "VERIFIED: $SET restores cleanly"
  exit 0
fi

# --- restore (replaces live data) ---------------------------------------------
[ "${3:-}" = --replace-live-data ] || die "restoring replaces live data; re-run with --replace-live-data"
log "stopping $API_CONTAINER and $MEDPLUM_SERVER_CONTAINER"
docker stop "$API_CONTAINER" "$MEDPLUM_SERVER_CONTAINER" >/dev/null
log "restoring PostgreSQL into $MEDPLUM_PG_DB (replacing current contents)"
docker exec -i "$MEDPLUM_PG_CONTAINER" pg_restore -U "$MEDPLUM_PG_USER" -d "$MEDPLUM_PG_DB" --clean --if-exists --no-owner --exit-on-error < "$SET/medplum.pgdump"
log "restoring Medplum file storage $MEDPLUM_BINARY_VOLUME"
docker run --rm -v "$MEDPLUM_BINARY_VOLUME":/data --entrypoint sh "$ORTHANC_IMAGE" -c 'find /data -mindepth 1 -delete'
docker run --rm -i -v "$MEDPLUM_BINARY_VOLUME":/data --entrypoint tar "$ORTHANC_IMAGE" xzf - -C /data < "$SET/medplum-binary.tar.gz"
docker run --rm -v "$MEDPLUM_BINARY_VOLUME":/data --entrypoint chown "$ORTHANC_IMAGE" -R 1000:1000 /data
log "restoring Orthanc volume $ORTHANC_VOLUME"
docker stop "$ORTHANC_CONTAINER" >/dev/null
docker run --rm -v "$ORTHANC_VOLUME":/data --entrypoint sh "$ORTHANC_IMAGE" -c 'find /data -mindepth 1 -delete'
docker run --rm -i -v "$ORTHANC_VOLUME":/data --entrypoint tar "$ORTHANC_IMAGE" xzf - -C /data < "$SET/orthanc-db.tar.gz"
log "starting services"
docker start "$ORTHANC_CONTAINER" "$MEDPLUM_SERVER_CONTAINER" "$API_CONTAINER" >/dev/null
# On a freshly installed machine the API cannot start before its Medplum data is
# restored, so Compose never started the proxy that depends on it. Start it now.
docker start "$PROXY_CONTAINER" >/dev/null 2>&1 || log "WARNING: could not start $PROXY_CONTAINER; run 'docker compose up -d'"
log "RESTORED from $SET; check https://<host>/api/health and sign in"
