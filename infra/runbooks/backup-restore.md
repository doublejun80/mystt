# Backup and Restore Runbook

## Daily Backup

1. `pg_dump mystt > backups/mystt-$(date +%F).sql`
2. Sync `minio` buckets `audio` and `artifacts`
3. Snapshot `.env`, `Caddyfile`, and compose overrides

## Restore Order

1. Bring up Postgres with the init schema
2. Restore `sessions`, `session_artifacts`, `transcription_jobs`, `note_artifacts`
3. Restore MinIO objects
4. Re-run provider connectivity checks
5. Re-run the live slice runbook

## Verification

- The portal can list sessions
- The session detail page can render transcript and notes
- A temp key probe works after restore

