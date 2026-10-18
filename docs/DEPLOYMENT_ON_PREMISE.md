# On-premise deployment (roadmap 24.7, 24.8 and 28)

How to run UNITECH-EHR on the hospital's own server with HTTPS and properly
protected secrets. Everything lives in `infrastructure/production/`.

## What runs

| Container | Role | Reachable from the network |
|---|---|---|
| `proxy` (Caddy and the built web app) | TLS termination, security headers, serves the app, routes `/api`, `/ohif`, `/dicom-web` to the API | **Yes: 443 (HTTPS) and 80 (redirects to HTTPS)** |
| `api` (hospital API) | Business logic; talks to Medplum and Orthanc | No |
| `orthanc` (PACS and OHIF plugin) | Image storage, DICOMweb, viewer | Only DICOM port 4242, for modalities |
| Medplum (separate stack in `medplum/`: server, Postgres, Redis) | FHIR server and patient data | No: the API reaches it over a private Docker network; admins use an SSH tunnel |

Staff use a single address, for example `https://ehr.hospital.local`. The
browser never talks to Orthanc or Medplum directly and never receives their
credentials.

## Prerequisites

- A Linux server with Docker Engine and the Compose plugin.
- A DNS name on the hospital network (for example `ehr.hospital.local`) that
  points to the server.
- Medplum running from `medplum/` (step 0), plus a **ClientApplication** for
  the API: its client ID and secret.
- A TLS certificate for the DNS name from hospital IT. This is recommended, so
  every hospital PC already trusts it.

## 0. Medplum (28.3)

```bash
cd infrastructure/production/medplum
cp .env.example .env
./generate-secrets.sh        # secrets/: Postgres, Redis, Medplum config, admin password
docker compose up -d
docker compose ps            # medplum-server "healthy"
```

- Every image is pinned to an exact version (`medplum-server`/`medplum-app`
  5.1.30, `postgres:16.15`, `redis:7.4.11`), never `:latest`. To upgrade: take a
  backup, change the tags, read the Medplum release notes, test on staging, then
  `docker compose up -d`. Keep the Postgres major version unless you plan a
  dump-and-restore migration.
- Postgres and Redis publish no ports and have generated passwords (Postgres
  via `POSTGRES_PASSWORD_FILE`, Redis via a mounted config). The Medplum
  config, with those passwords, is a secret file, not environment variables.
  Self-registration and VM bots are off.
- The server is bound to `127.0.0.1:8103` on the host for administration only.
  The admin app starts only when you ask for it:

  ```bash
  docker compose --profile admin up -d medplum-app
  # from your PC: ssh -L 8103:127.0.0.1:8103 -L 3000:127.0.0.1:3000 admin@<server>
  # then open http://localhost:3000
  ```

- **First sign-in:** `admin@example.com` with the password in
  `secrets/admin_password` (generated; the upstream default is not used).
  Change the password, create the API's ClientApplication (its ID goes in
  `../.env`, its secret in `../generate-secrets.sh`), then delete
  `secrets/admin_password` and stop the admin app
  (`docker compose --profile admin stop medplum-app`).

## 1. Certificate (24.8)

Put the certificate chain and private key in `infrastructure/production/certs/`:

```bash
cp ehr.hospital.local.fullchain.pem infrastructure/production/certs/cert.pem
cp ehr.hospital.local.key            infrastructure/production/certs/key.pem
chmod 600 infrastructure/production/certs/key.pem
```

and set `EHR_TLS=tls /certs/cert.pem /certs/key.pem` in `.env`. Without a
certificate, `EHR_TLS=tls internal` makes Caddy issue one from its own CA.
Browsers warn until that CA (`/data/caddy/pki/authorities/local/root.crt`
in the `caddy-data` volume) is installed on hospital PCs, so use it only to get
started.

## 2. Settings and secrets (24.7)

```bash
cd infrastructure/production
cp .env.example .env        # hostname, TLS mode, Medplum address and client ID
./generate-secrets.sh       # asks for the Medplum client secret
```

`generate-secrets.sh` creates `secrets/`, a directory only the owner can enter:

- `auth_session_secret` and `orthanc_password`: generated, 48 random characters.
- `orthanc_users.json`: Orthanc's service account, matching `orthanc_password`.
- `medplum_client_secret`: entered by you.
- `medplum_provisioning_password`: optional; enables creating staff logins.

It never overwrites an existing secret. The API reads them as files
(`*_FILE` → `/run/secrets/...`), so they don't appear in images,
`docker inspect`, process listings or git (`secrets/` and `certs/` are
git-ignored).

The API **refuses to start** in production if something critical is missing
or unsafe, and lists every problem at once. It checks for: a missing Medplum or
Orthanc setting, a session secret under 32 characters, a non-HTTPS
`WEB_ORIGIN`, the development login being enabled, or a placeholder password.

## 3. Start

```bash
docker compose up -d --build
docker compose ps            # all services "running"; api "healthy"
docker compose logs -f api   # "Hospital API running on ..."
```

Open `https://<EHR_HOSTNAME>`.

## 4. Check

- `http://<host>` redirects to `https://<host>`.
- Responses carry `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`
  and `X-Frame-Options: DENY`, and no `Server` banner.
- Sign-in sets a `Secure; HttpOnly; SameSite=Lax` session cookie.
- `docker compose ps` shows published ports only for `proxy` (and 4242 on
  `orthanc`).
- `https://<host>/api/health` returns `{"status":"ok", ...}` with Medplum and
  Orthanc both `ok`.

## 5. Backups (28.1)

`backup/backup.sh` writes one set per night to `/var/backups/unitech-ehr/<UTC time>/`:

| File | Contents |
|---|---|
| `medplum.pgdump` | Medplum Postgres (`pg_dump -Fc`): every FHIR resource, i.e. all clinical, billing and audit data |
| `medplum-binary.tar.gz` | Medplum file storage (attachments) |
| `orthanc-db.tar.gz` | Orthanc images and index; Orthanc is paused for the few seconds of the archive so both stay consistent |
| `MANIFEST`, `SHA256SUMS` | Versions, sizes, patient count; checksums |

The script checks the dump is readable before calling the set complete, keeps
`RETENTION_DAYS` (default 14) of sets, and copies each finished set off the
server when `OFFSITE_CMD` is set. **Set it:** a backup on the same disk does not
survive a disk or server loss. No passwords are needed; it uses `docker exec`.

Install the scheduled jobs (systemd, as root). The units expect this
repository checked out at `/opt/unitech-ehr`; edit their `ExecStart` lines if
it lives elsewhere.

```bash
sudo mkdir -p /etc/unitech-ehr
sudo install -m 600 infrastructure/production/systemd/backup.env.example /etc/unitech-ehr/backup.env
sudo nano /etc/unitech-ehr/backup.env        # EHR_URL, OFFSITE_CMD, ALERT_CMD
sudo cp infrastructure/production/systemd/*.service infrastructure/production/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unitech-ehr-backup.timer unitech-ehr-backup-verify.timer unitech-ehr-health.timer
sudo systemctl start unitech-ehr-backup.service && journalctl -u unitech-ehr-backup -n 20
```

| Timer | When | What |
|---|---|---|
| `unitech-ehr-backup` | daily 02:30 (catches up after downtime) | `backup.sh` |
| `unitech-ehr-backup-verify` | Sundays 04:00 | `restore.sh verify latest`: restores the newest set into scratch copies, compares the patient count with the manifest, starts the restored Orthanc, then removes the copies. Live data is not touched |
| `unitech-ehr-health` | every 5 minutes | `check-health.sh` |

## 6. Monitoring (28.2)

- `GET /api/health/live`: the API process answers (used by the container health check).
- `GET /api/health`: readiness. 200 when Medplum and Orthanc answer, 503
  otherwise. Public and terse: up/down and latency only.
- Every container has a Docker health check; `docker compose ps` shows it.
- `monitoring/check-health.sh` alerts when the application is not healthy,
  the last complete backup is older than `MAX_BACKUP_AGE_HOURS` (26), or the
  backup disk has less than `MIN_FREE_GB` (20) free. Problems go to the system
  log (`journalctl -t unitech-ehr`) and to `ALERT_CMD` (for example
  `mail -s "EHR alert" it@hospital.local`). It exits non-zero, so Zabbix or
  Nagios can run it directly instead.
- Failed backup or verify runs show as failed units: `systemctl --failed`.

### Errors and rate limits

- `GET /api/health/metrics` returns the API's request counters in Prometheus
  format: requests by status class, 5xx errors, 429 responses and Medplum
  throttling ("Too Many Requests", answered as 503). It needs
  `Authorization: Bearer <secrets/metrics_token>`; without a configured token
  the endpoint does not exist. Prometheus can scrape it with that bearer token.
- `check-health.sh` reads it when `METRICS_TOKEN_FILE` is set (see
  `systemd/backup.env.example`) and alerts when, since the previous check,
  there were more than `MAX_5XX_PER_CHECK` (5) server errors or more than
  `MAX_429_PER_CHECK` (20) rate-limited responses and Medplum throttles
  together. The counters are per API process; the script keeps the last
  reading in `/var/lib/unitech-ehr` and starts again from zero after an
  API restart.

### Central logs

- Every container (proxy, API, Orthanc, and the Medplum stack) logs to the
  host's systemd journal, tagged `unitech-ehr/<container>`:
  `journalctl -t unitech-ehr/unitech-ehr-api-1 -f`. `docker compose logs`
  keeps working.
- The API writes one JSON line per request: time, level, method, path with
  record ids masked (`/api/patients/:id`), status, duration and client
  address. No query strings, bodies or headers, so no patient names or tokens.
  Set `REQUEST_LOG=off` to turn it off (it is on whenever `NODE_ENV=production`).
- The proxy writes its own JSON access log.
- To collect everything centrally, forward the journal to the hospital's log
  server: for example `systemd-journal-upload` to a `systemd-journal-remote`
  host, rsyslog (`imjournal` → `omfwd`) to a SIEM, or a Promtail / Grafana
  Alloy / Fluent Bit agent reading the journal for Loki or Graylog. Filter on
  `SYSLOG_IDENTIFIER=unitech-ehr/*`. The health-check alerts are in the same
  journal (`-t unitech-ehr`).

## 7. Disaster recovery (28.4)

1. Install Docker, check out this repository, and copy back `.env` files and
   `secrets/` from your secure off-server copy (or regenerate them; then
   recreate the ClientApplication secret).
2. Start the empty stacks: `medplum/` first, then this directory.
3. Copy the newest backup set from off-site, then check it:
   `backup/restore.sh verify <set-dir>`.
4. Restore it, replacing the (empty) live data:
   `backup/restore.sh restore <set-dir> --replace-live-data`.
   This stops the API and Medplum, restores Postgres, Medplum files and Orthanc,
   then starts them again.
5. Check `https://<host>/api/health`, sign in, open a patient with images.

Rehearse this on a spare machine at least twice a year, and record how long it
took (that time is the recovery time objective). The nightly backup sets the
data you can lose: at most one day, unless backups run more often.

### The drill (28.4)

On the spare machine (normally the staging server, section 8), with both
stacks installed and running:

```bash
sudo EHR_URL=https://ehr-staging.hospital.local \
     PRODUCTION_HOSTNAME=<production server's hostname> \
     ORTHANC_PASSWORD_FILE=/opt/unitech-ehr/infrastructure/production/secrets/orthanc_password \
     backup/restore-drill.sh /var/backups/unitech-ehr/<set> --on-spare-machine
```

It runs `restore.sh verify`, then `restore.sh restore` over the spare
machine's data, waits for `/api/health` to answer 200, then checks that the
live patient and study counts match the backup. Each step is timed. The
report goes to `/var/lib/unitech-ehr/drills/drill-<time>.md` (and `.json`):

- **RTO:** restore plus time until healthy.
- **RPO:** the age of the backup set when the drill started.

The script refuses to run without `--on-spare-machine`, and on the host named
in `PRODUCTION_HOSTNAME`. It exits non-zero unless every step passed. Finish
the manual checks listed in the report (staff sign-in, a patient with notes and
results, a study in the viewer, a portal sign-in), then sign it and keep it
with the go-live records.

## 8. Staging (30.1)

A second server with the same stacks, used for the restore drill, the
real-modality tests (26.2) and the pilot (30.4). It needs at least the
production server's disk space for one backup set plus the restored data.

1. Install it exactly like production (sections 0–4), with its own
   `EHR_HOSTNAME` (for example `ehr-staging.hospital.local`) and its own
   certificate. Keep `ENABLED_HOSPITAL_CODES` to the launch hospital.
2. Copy production's `medplum_client_secret` to staging's `secrets/`
   (secure copy, never by email). A restored database holds production's
   ClientApplication, so staging's API must use the same secret. Generate
   the other secrets fresh.
3. Get a backup set onto staging, either from the off-site copy (`OFFSITE_CMD`)
   or with `rsync` from production, then run the drill (section 7).
4. Install the health check on staging too (section 6), with
   `PRODUCTION_HOSTNAME` set in `/etc/unitech-ehr/backup.env`.

**Staging on Windows or macOS (Docker Desktop).** Docker Desktop has no
journald, so add the desktop override to every `docker compose` command in
both stacks: `docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d`.
Run the scripts from Git Bash with `MSYS_NO_PATHCONV=1` set, so Docker volume
paths such as `/data` are not rewritten into Windows paths. Use free ports
(`HTTP_PORT`, `HTTPS_PORT`, `ORTHANC_DICOM_BIND`, `MEDPLUM_ADMIN_BIND`) if
other projects run on the machine. A desktop machine is fine for rehearsals,
but repeat the drill on the Linux production server before go-live.

**After a drill, staging holds real patient data.** Protect it exactly like
production: same firewall rules (section below), only IT and named pilot users
get accounts, and backups of staging follow the same rules. Don't use it for
classroom training (30.3). Train on a separate instance with made-up patients,
or on staging before the first restore.

## 9. Training environment (30.3)

A separate copy of both stacks with fictional data, so staff can practise
without touching real records. Training material is in `docs/training/`.

1. Make a separate checkout of the repository (the stacks bind-mount their
   `secrets/` and `Caddyfile` from it).
2. In both `.env` files set a project name and network of its own, so it can
   run on the same machine as staging. Also give it its own ports and hostname:

   - `medplum/.env`:
     - `COMPOSE_PROJECT_NAME=unitech-training-medplum`
     - `MEDPLUM_NETWORK=unitech-training-medplum`
     - `MEDPLUM_ADMIN_BIND=127.0.0.1:18104`
   - `.env`:
     - `COMPOSE_PROJECT_NAME=unitech-training`
     - `MEDPLUM_NETWORK=unitech-training-medplum`
     - `EHR_HOSTNAME=training.<domain>`
     - free `HTTP_PORT`, `HTTPS_PORT` and `ORTHANC_DICOM_BIND`
3. Fill it from a backup of **test** data, never of production, with
   `backup/restore-drill.sh`. Point the container and volume variables
   (`MEDPLUM_PG_CONTAINER=unitech-training-medplum-postgres-1`, …) at the
   training containers.
4. Seed the training accounts and patients:
   `node --env-file=<seed.env> scripts/seed-training.mjs --training-environment`
   (in `services/hospital-api`; the variables are listed at the top of the
   script). The account sheet with the shared password is written to
   `TRAINING_ACCOUNTS_FILE`. Keep it outside the repository and give it to
   the trainers only.
5. Between training groups, restore and seed again to start from the same data.

## Firewall

| Port | Allow from |
|---|---|
| 443/tcp | Hospital staff network |
| 80/tcp | Same (redirect only) |
| 4242/tcp | Modality IPs only (CT, MR, CR …) |
| Medplum 8103/3000 | Nothing: bound to loopback, reached by admins over SSH |

## Operations

- **Upgrade:** `git pull && docker compose up -d --build`.
- **Rotate a secret:** delete the file in `secrets/`, run
  `./generate-secrets.sh`, then `docker compose up -d`. If you rotate
  `orthanc_password`, restart both `orthanc` and `api`.
- **Backups:** see section 5. Keep a copy of both `secrets/` directories and
  `.env` files off the server too; backups do not include them.
- **Client IPs in the audit log:** the API trusts `X-Forwarded-For` only from
  the proxy (`TRUST_PROXY=uniquelocal`).

## Not covered here

- **The central log server itself** (Loki, Graylog, a SIEM): the stack writes
  to the host journal and the hospital forwards it (section 6).
- **An external secrets vault:** files with tight permissions are the baseline;
  a vault (for example HashiCorp Vault) can later write the same files.
