# Database backup / restore: optional environment variables

All variables are optional. Add them to `Server/.env` only to override a default.
Settings resolve in this order: per-organisation override (Superadmin UI) ->
global value saved in the Superadmin UI -> these environment defaults.

```ini
# --- Reminders -------------------------------------------------------------
# BACKUP_REMINDER_ENABLED=true        # send "time to back up" reminders (default true)
# BACKUP_REMINDER_DAYS=7              # remind when last backup is older than N days (1-90, default 7)
# BACKUP_REMINDER_CRON=0 9 * * *      # when the reminder job runs, IST (default 09:00 daily)
# BACKUP_ALERT_EMAIL=                 # superadmin reminder/alert recipient (default: EMAIL_USER)

# --- Retention / limits ----------------------------------------------------
# BACKUP_RETENTION_HOURS=48           # how long generated backup files are kept (1-720, default 48)
# BACKUP_MAX_UPLOAD_MB=2048           # max size of an uploaded backup for restore (default 2048)
# BACKUP_PRE_RESTORE_KEEP_DAYS=       # days to keep pre-restore safety databases (engine default applies if unset)
# BACKUP_TMP_DIR=                     # scratch directory for dumps/uploads (engine default applies if unset)

# --- Organisation permissions ---------------------------------------------
# BACKUP_ORG_DOWNLOAD_ENABLED=true    # org admins may take/download their own backup (default true)
# BACKUP_ORG_RESTORE_ENABLED=false    # org admins may restore their own backup (default false)

# --- Platform restore ------------------------------------------------------
# BACKUP_ALLOW_PLATFORM_RESTORE=      # enable restoring the platform DB / all orgs (engine default applies if unset)

# --- Tool paths (if not on PATH) -------------------------------------------
# PG_DUMP_PATH=pg_dump
# PSQL_PATH=psql
```

Boolean values accept `true/false`, `1/0`, `yes/no`, `on/off`.
`BACKUP_REMINDER_DAYS` and `BACKUP_RETENTION_HOURS` are clamped to their ranges.
There is no `Server/.env.example` in the repo, which is why this file exists.
