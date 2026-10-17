# On-premise deployment (roadmap 24.7 and 24.8)

How to run UNITECH-EHR on the hospital's own server with HTTPS and properly
protected secrets. Everything lives in `infrastructure/production/`.

## What runs

| Container | Role | Reachable from the network |
|---|---|---|
| `proxy` (Caddy and the built web app) | TLS termination, security headers, serves the app, routes `/api`, `/ohif`, `/dicom-web` to the API | **Yes: 443 (HTTPS) and 80 (redirects to HTTPS)** |
| `api` (hospital API) | Business logic; talks to Medplum and Orthanc | No |
| `orthanc` (PACS and OHIF plugin) | Image storage, DICOMweb, viewer | Only DICOM port 4242, for modalities |
| Medplum (separate stack) | FHIR server and patient data | Only from the API (see below) |

Staff use a single address, for example `https://ehr.hospital.local`. The
browser never talks to Orthanc or Medplum directly and never receives their
credentials.

## Prerequisites

- A Linux server with Docker Engine and the Compose plugin.
- A DNS name on the hospital network (for example `ehr.hospital.local`) that
  points to the server.
- Medplum running (its own Docker stack), plus a **ClientApplication** for
  the API: its client ID and secret.
- A TLS certificate for the DNS name from hospital IT. This is recommended, so
  every hospital PC already trusts it.

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

## Firewall

| Port | Allow from |
|---|---|
| 443/tcp | Hospital staff network |
| 80/tcp | Same (redirect only) |
| 4242/tcp | Modality IPs only (CT, MR, CR …) |
| Medplum 8103/3000 | Not from staff PCs; only from the API, and admins on 3000 |

## Operations

- **Upgrade:** `git pull && docker compose up -d --build`.
- **Rotate a secret:** delete the file in `secrets/`, run
  `./generate-secrets.sh`, then `docker compose up -d`. If you rotate
  `orthanc_password`, restart both `orthanc` and `api`.
- **Backups:** the `orthanc-db` volume (images) and Medplum's Postgres (all
  clinical data); see roadmap 28.1.
- **Client IPs in the audit log:** the API trusts `X-Forwarded-For` only from
  the proxy (`TRUST_PROXY=uniquelocal`).

## Not covered here

- **Medplum's own hardening:** TLS for its admin app, and Postgres and Redis
  passwords. Follow Medplum's production guide.
- **An external secrets vault:** files with tight permissions are the baseline;
  a vault (for example HashiCorp Vault) can later write the same files.
