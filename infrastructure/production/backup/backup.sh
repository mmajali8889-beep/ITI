#!/usr/bin/env bash
# UNITECH-EHR nightly backup (roadmap 28.1): Medplum PostgreSQL + Orthanc images.
#
# Creates  $BACKUP_DIR/<UTC timestamp>/
#            medplum.pgdump        pg_dump custom format (all clinical/FHIR data)
#            medplum-binary.tar.gz Medplum file storage (attachments, Binary)
#            orthanc-db.tar.gz     Orthanc storage + index (images)
#            MANIFEST              versions, sizes, row/study counts
#            SHA256SUMS
# then prunes sets older than RETENTION_DAYS and runs OFFSITE_CMD (optional).
# Exit code is non-zero on any failure, so systemd/cron/monitoring can alert.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/unitech-ehr}
RETENTION_DAYS=${RETENTION_DAYS:-14}
MEDPLUM_PG_CONTAINER=${MEDPLUM_PG_CONTAINER:-unitech-medplum-postgres-1}
MEDPLUM_PG_USER=${MEDPLUM_PG_USER:-medplum}
MEDPLUM_PG_DB=${MEDPLUM_PG_DB:-medplum}
MEDPLUM_BINARY_VOLUME=${MEDPLUM_BINARY_VOLUME:-unitech-medplum_binary-data}
ORTHANC_CONTAINER=${ORTHANC_CONTAINER:-unitech-ehr-orthanc-1}
ORTHANC_VOLUME=${ORTHANC_VOLUME:-unitech-ehr_orthanc-db}
ORTHANC_IMAGE=${ORTHANC_IMAGE:-orthancteam/orthanc:24.10.3}
# Optional: copies the finished set off this server, e.g.
#   OFFSITE_CMD='rsync -a "$1" backup@nas.hospital.local:/srv/ehr-backups/'
OFFSITE_CMD=${OFFSITE_CMD:-}

log() { echo "$(date -u +%FT%TZ) backup: $*"; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SET="$BACKUP_DIR/$STAMP"
mkdir -p "$SET"
chmod 700 "$BACKUP_DIR" "$SET" 2>/dev/null || true
trap 'log "FAILED (partial set kept at $SET for inspection)"' ERR

# --- Medplum PostgreSQL ------------------------------------------------------
log "dumping PostgreSQL $MEDPLUM_PG_DB from $MEDPLUM_PG_CONTAINER"
docker exec "$MEDPLUM_PG_CONTAINER" pg_dump -U "$MEDPLUM_PG_USER" -d "$MEDPLUM_PG_DB" -Fc > "$SET/medplum.pgdump"
# A dump that pg_restore cannot list is not a backup.
TOC=$(docker exec -i "$MEDPLUM_PG_CONTAINER" pg_restore --list < "$SET/medplum.pgdump" | grep -c ' TABLE DATA ' || true)
[ "$TOC" -gt 0 ] || { log "dump has no table data"; exit 1; }
PATIENTS=$(docker exec "$MEDPLUM_PG_CONTAINER" psql -U "$MEDPLUM_PG_USER" -d "$MEDPLUM_PG_DB" -Atc 'select count(*) from "Patient" where deleted = false')

# --- Medplum file storage (files are written once, never changed) -----------
log "archiving Medplum file storage $MEDPLUM_BINARY_VOLUME"
docker volume inspect "$MEDPLUM_BINARY_VOLUME" >/dev/null
docker run --rm -v "$MEDPLUM_BINARY_VOLUME":/data:ro --entrypoint tar "$ORTHANC_IMAGE" czf - -C /data . > "$SET/medplum-binary.tar.gz"
tar tzf - < "$SET/medplum-binary.tar.gz" > /dev/null

# --- Orthanc (paused briefly so index and files stay consistent) -------------
log "archiving Orthanc volume $ORTHANC_VOLUME"
resume() { docker unpause "$ORTHANC_CONTAINER" >/dev/null 2>&1 || true; }
docker pause "$ORTHANC_CONTAINER" >/dev/null
trap 'resume; log "FAILED (partial set kept at $SET for inspection)"' ERR
docker run --rm -v "$ORTHANC_VOLUME":/data:ro --entrypoint tar "$ORTHANC_IMAGE" czf - -C /data . > "$SET/orthanc-db.tar.gz"
resume
trap 'log "FAILED (partial set kept at $SET for inspection)"' ERR
# Read from stdin so tar never interprets a path (e.g. "C:/...") as a remote host.
tar tzf - < "$SET/orthanc-db.tar.gz" > /dev/null

# --- Manifest and checksums ---------------------------------------------------
{
  echo "created_utc=$STAMP"
  echo "postgres_version=$(docker exec "$MEDPLUM_PG_CONTAINER" psql -U "$MEDPLUM_PG_USER" -d "$MEDPLUM_PG_DB" -Atc 'show server_version')"
  echo "medplum_patients=$PATIENTS"
  echo "pg_table_data_entries=$TOC"
  echo "orthanc_image=$ORTHANC_IMAGE"
  echo "medplum_pgdump_bytes=$(wc -c < "$SET/medplum.pgdump")"
  echo "medplum_binary_tar_bytes=$(wc -c < "$SET/medplum-binary.tar.gz")"
  echo "orthanc_tar_bytes=$(wc -c < "$SET/orthanc-db.tar.gz")"
} > "$SET/MANIFEST"
(cd "$SET" && sha256sum medplum.pgdump medplum-binary.tar.gz orthanc-db.tar.gz MANIFEST > SHA256SUMS)
log "backup set complete: $SET ($PATIENTS patients)"

# --- Retention and off-site copy ---------------------------------------------
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} + | sed 's/^/pruned /' || true
if [ -n "$OFFSITE_CMD" ]; then
  log "copying off-site"
  sh -c "$OFFSITE_CMD" offsite "$SET"
fi
log "done"
