# UNITECH-EHR

Hospital electronic health record built on [Medplum](https://www.medplum.com/) (FHIR R4).

| Part | Path | Port |
|---|---|---|
| Web app (React + Vite) | `apps/ehr-web` | 5173 |
| Hospital API (NestJS) | `services/hospital-api` | 4000 |
| Medplum server / app | Docker (upstream compose) | 8103 / 3000 |
| Orthanc PACS + OHIF viewer | Docker | 8042 (HTTP/DICOMweb), 4242 (DICOM) |

Workflow scope (stages 1–23) and acceptance results are in [`docs/`](docs/); the overall audit is [`docs/HP1_WORKFLOW_ACCEPTANCE_AUDIT.md`](docs/HP1_WORKFLOW_ACCEPTANCE_AUDIT.md).

## Run locally

Prerequisites: Node.js 20+, Docker.

### 1. Medplum

Start the local Medplum stack (Postgres, Redis, server, app) from a Medplum checkout, for example in `upstream/medplum`:

```bash
docker compose -f docker-compose.full-stack.yml -f docker-compose.recovery.yml up -d
```

Check it: `curl http://localhost:8103/healthcheck`. In the Medplum app (http://localhost:3000), create a ClientApplication for the hospital project and keep its client ID and secret for the `.env` files below.

### 2. Organizations and hospitals

```bash
cd scripts
cp .env.example .env        # fill in MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET
npm install
node create-org.mjs                 # healthcare group, HOSP-A, HOSP-B, departments, locations
node create-test-hospitals.mjs      # dedicated UAT hospitals HOSP-01..03 (tagged environment=uat)
```

### 3. PACS (Orthanc with the built-in OHIF viewer)

Orthanc runs with **authentication on** and a single service account for the API. Generate its password once; this writes both git-ignored files, which must match:

```bash
node -e "const pw=require('crypto').randomBytes(24).toString('base64url');require('fs').mkdirSync('infrastructure/orthanc',{recursive:true});require('fs').writeFileSync('infrastructure/orthanc/.env.orthanc','ORTHANC__REGISTERED_USERS={\"hospital-api\":\"'+pw+'\"}\n');require('fs').appendFileSync('services/hospital-api/.env','\nORTHANC_USERNAME=hospital-api\nORTHANC_PASSWORD='+pw+'\n')"
```

```bash
docker run -d --name hospital-ehr-orthanc --restart unless-stopped \
  -p 127.0.0.1:8042:8042 -p 127.0.0.1:4242:4242 \
  --env-file infrastructure/orthanc/.env.orthanc \
  -e ORTHANC__NAME=HOSPITAL-EHR-PACS \
  -e ORTHANC__AUTHENTICATION_ENABLED=true \
  -e ORTHANC__REMOTE_ACCESS_ALLOWED=true \
  -e ORTHANC__DICOM_AET=ORTHANC \
  -e DICOM_WEB_PLUGIN_ENABLED=true \
  -e OHIF_PLUGIN_ENABLED=true \
  -e ORTHANC__OHIF__DATA_SOURCE=dicom-web \
  -v hospital-ehr-orthanc-db:/var/lib/orthanc/db \
  orthancteam/orthanc:24.10.3
```

**Browsers never receive Orthanc credentials.** Orthanc has no per-user roles: anyone holding the account could also delete studies. Instead, the API serves the viewer and DICOMweb on its own origin (`http://localhost:4000/ohif/…`, `/dicom-web/…`) through a read-only proxy. The proxy requires a signed-in EHR session with the `radiology` or `clinical` permission, and the API adds the service credentials on the server side (`services/hospital-api/src/radiology/pacs-viewer.proxy.ts`). Set `OHIF_VIEWER_URL` and `VITE_OHIF_URL` to `http://localhost:4000/ohif`.

Studies are linked to radiology orders by **accession number**. The API syncs Orthanc every 15 s, or on demand via `POST /api/radiology/pacs/sync/accession/:accessionNumber`. Modalities send images over DICOM on port 4242, which uses AE titles rather than the HTTP account.

### 4. API and web app

```bash
cp services/hospital-api/.env.example services/hospital-api/.env   # fill in Medplum values and AUTH_SESSION_SECRET
cp apps/ehr-web/.env.example apps/ehr-web/.env.local
npm --prefix services/hospital-api install
npm --prefix apps/ehr-web install
```

Then, each in its own terminal:

```bash
npm --prefix services/hospital-api run start
```

```bash
npm --prefix apps/ehr-web run dev
```

Open http://localhost:5173. Sign-in is limited to the hospital in `ACTIVE_HOSPITAL_CODE` (default `HOSP-A`). For local development you can opt in to an admin login: set `AUTH_DEV_ADMIN_ENABLED=true` with your own `DEV_ADMIN_USERNAME` and `DEV_ADMIN_PASSWORD`. There are no built-in credentials, and the API refuses to start if this is enabled with `NODE_ENV=production`.

Logging out revokes the session durably. A hash of the token is stored in Medplum, so the logout survives restarts and reaches other API instances within `AUTH_REVOCATION_REFRESH_SECONDS`.

In the Claude desktop app, `.claude/launch.json` starts both servers.

## Tests

```bash
npm --prefix services/hospital-api test                     # unit tests
npm --prefix services/hospital-api run test:e2e             # static acceptance contract
```

Live acceptance runs against a running API and Medplum, using synthetic data in the dedicated UAT hospital (start the API with `ACTIVE_HOSPITAL_CODE=HOSP-01`):

```bash
cd services/hospital-api
HP1_HOSPITAL_CODE=HOSP-01 HP1_OTHER_HOSPITAL_CODE=HOSP-02 node test/live/hp1-live-uat.mjs
node test/live/security-uat.mjs
node test/live/load-concurrency-uat.mjs
```

The scripts pace themselves to stay under Medplum's rate limits. `security-uat.mjs` ends with a brute-force probe that triggers Medplum's per-address sign-in throttle for a few minutes.
