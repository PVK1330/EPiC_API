# Database backup and restore

Backs up and restores the platform database and each organisation's own database.
Backups are downloaded to the user's own machine; the server only keeps them for a limited time.

## File formats

| Scope | File | Contents |
|---|---|---|
| `organisation` | `<org-slug>-<YYYYMMDD-HHmmss>.sql.gz` | plain SQL from `pg_dump --no-owner --no-privileges`, gzip |
| `platform` | `<platform-db>-<YYYYMMDD-HHmmss>.sql.gz` | same, for the platform DB |
| `all` (superadmin, download only) | `epic-all-<YYYYMMDD-HHmmss>.zip` | one `.sql.gz` per organisation DB + platform + `README.txt` |

The first line of every `.sql.gz` is a manifest comment used to validate a restore:

```
-- EPIC-BACKUP {"v":1,"scope":"organisation","organisation_id":12,"database_name":"epic_acme","created_at":"...","app":"epic","pg_server_version":"17.9"}
```

Restoring an `all` zip is not supported. Extract the single `.sql.gz` you need and restore it
for that organisation (or the platform, if enabled).

## How it works

* Backups run in the background. `POST` returns `202` with a job; poll `GET /:id`.
  One job runs at a time (in-process queue). Jobs left `running` by a crashed process are marked `failed`.
* Files are written to `BACKUP_TMP_DIR` (default `Server/storage/private/temp/backups`, never served statically)
  and removed after `expires_at` (`BACKUP_RETENTION_HOURS`, default 48; pre-restore safety backups keep 7 days).
  `cleanupExpiredBackups()` (hourly cron, registered by `jobs/index.js`) removes expired files, marks rows `expired`,
  sweeps orphan temp files, and calls `dropOldPreRestoreDatabases()`.
* Download requires re-entering the account password (and a TOTP code if 2FA is enabled). Failed re-auth
  returns **403** (not 401, so the SPA does not log the user out) with `code` = `REAUTH_FAILED`,
  `PASSWORD_REQUIRED` or `TOTP_REQUIRED`, and writes a platform audit entry.
  Download and restore are rate limited (10 per 15 min per user).
* Every backup, download, delete, restore and rejected re-auth is written to `platform_audit_logs`
  (category `Backup`).

## Restore procedure (organisation)

1. Upload `.sql.gz` (multipart, streamed to disk, size limit `BACKUP_MAX_UPLOAD_MB`, gzip magic bytes checked)
   with `confirm_name` (must equal the organisation name exactly), `password` (+ `totp`).
2. The manifest must have `v=1`, `scope=organisation` and the same `organisation_id` AND `database_name`
   as the target. A backup from another organisation is rejected.
3. A new empty database `<db>_restore_<ts>` is created and the file is loaded with
   `psql -v ON_ERROR_STOP=1 --single-transaction`. Core tables (`users`, `roles`, `cases`) are verified.
   On any failure the temp DB is dropped and the live DB is untouched (job `failed`, with `stage` and error).
4. A safety backup of the current DB is taken (`kind=backup`, `meta.safety=true`, kept 7 days, downloadable).
   If it fails, the restore is aborted.
5. Swap: the organisation is put behind a maintenance gate (API returns `503 "Organisation is being restored,
   try again shortly"` for that organisation), connections are terminated, `live` is renamed to
   `<db>_pre_restore_<ts>` and the restored DB is renamed to `live`. If the second rename fails the first is reverted.
   The gate is always lifted afterwards.
6. Per-tenant SQL migrations are run so an older backup is brought up to the current schema
   (a failure is reported in the job `error`; the restore itself stays completed).
   A backup from a newer schema than the code cannot be reliably detected.
7. The upload is deleted. The `_pre_restore_` DB is kept for `BACKUP_PRE_RESTORE_KEEP_DAYS` (default 7) for manual
   recovery (`ALTER DATABASE` rename back), then dropped.

The restoring DB user must own the tenant databases (they are created by the tenant-DB creator user,
`TENANT_DB_CREATOR_USER`, which also performs create/rename/drop here) and needs `CREATEDB`.

### Platform restore

Superadmin only, and only when `BACKUP_ALLOW_PLATFORM_RESTORE=true`. It never swaps the live platform DB:
it restores into `<DB_NAME>_restored_<ts>`; the job result (`error` text and `meta.restored_db_name`) tells the
admin to review it, then set `DB_NAME` to that name and restart the API manually.

## Endpoints

Superadmin (`/api/superadmin/backups`, platform permission `platform.backups.view|manage`; mutations need `manage`;
`platform` and `all` scopes and all restores are superadmin only):

* `GET /` `?page&limit&organisation_id&kind&status`
* `GET /organisations`
* `POST /` `{scope, organisation_id?}` -> 202
* `GET /:id`, `DELETE /:id`
* `POST /:id/download` `{password, totp?}` -> file stream
* `POST /restore` multipart: `file, scope, organisation_id?, confirm_name, password, totp?` -> 202
* `GET|PUT /settings` (settings, separate module)

Organisation admin (`/api/admin/backups`, tenant admin only, always scoped to the caller's organisation):

* `GET /status`, `GET /`, `POST /` (403 if downloads disabled), `GET /:id`, `DELETE /:id`
* `POST /:id/download` `{password, totp?}`
* `POST /restore` multipart: `file, confirm_name, password, totp?` (403 unless restore is enabled)

All responses use `{status, message, data}`. Job JSON never contains the server file path.
Note: while an organisation is being swapped, tenant-scoped requests for it (including job polling through
`/api/admin/backups`) answer 503 for a few seconds; clients should retry.

## Environment variables

See `docs/backup-env.md` for the settings-related ones. Engine variables:

| Variable | Default | Purpose |
|---|---|---|
| `PG_DUMP_PATH` / `PSQL_PATH` | `pg_dump` / `psql` | binaries |
| `BACKUP_TMP_DIR` | `Server/storage/private/temp/backups` | dumps and uploads |
| `BACKUP_RETENTION_HOURS` | 48 | file expiry |
| `BACKUP_MAX_UPLOAD_MB` | 2048 | restore upload limit |
| `BACKUP_PRE_RESTORE_KEEP_DAYS` | 7 | keep `_pre_restore_` DBs |
| `BACKUP_ALLOW_PLATFORM_RESTORE` | unset (disabled) | enable platform restore |
| `TENANT_DB_CREATOR_USER/PASSWORD`, `DB_MAINTENANCE_DATABASE` | existing | privileged connection for create/rename/drop and restore |

## VPS requirements

* `postgresql-client` of the **same major version as the server** (pg_dump refuses to dump a newer server).
  Windows example: `PG_DUMP_PATH="C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"`.
* Disk space of at least 2x the largest database in `BACKUP_TMP_DIR`, plus the database cluster needs room for
  the temp restore DB and the kept `_pre_restore_` copy.
* Single API instance (PM2 fork mode, `instances: 1`): the maintenance gate is in process memory.
  If you move to cluster mode, the gate needs to be shared (DB/Redis backed).
