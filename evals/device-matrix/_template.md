# Evidence Entry Template

## Run Header

- Run ID: `YYYY-MM-DD-01`
- Lane: `iphone-safari-portal | ios-native | android-native | desktop | soniox-live`
- Target: `device / OS / portal / API`
- Verification Type: `automated`, `manual`, or `manual + automated`
- Owner: `name`
- Date: `YYYY-MM-DD`

## Goal

- What was being proven:
- Why this run matters:

## Automated Verification

- Command / API / status check:
- Expected result:
- Actual result:

## Manual Evidence

- Device / browser / credential context:
- What was observed on the real target:
- Screenshot / log / webhook path:

## Code-Backed Fields

- Mobile: `runtime-state.json`, `recordings/<session-id>/session.json`, `checksumMd5`, `localSha256`, `remoteSha256`, `remoteByteLength`, `uploadVerifiedAt`, `backgroundTransitionCount`, `selectedInput`, `uploadQueuedAt`, `transportState`, `phase`, `lastKnownAppState`
- Desktop: `recorderRoot`, `recordingsRoot`, `sessions.json`, `runtime-state.json`, `saved_session_count`, `recent_sessions`, `appDataDir`, keep-awake status, local portal vs hosted domain target
- API / live: `source_audio.soniox_uploaded.fileId`, `source_audio.soniox_uploaded.location`, `source_audio.soniox_uploaded.fileName`, `source_audio.soniox_uploaded.byteLength`, `source_audio.soniox_uploaded.sha256`, `source_audio.soniox_uploaded.contentType`, `transcription.metadata.updated`, `transcription.cleanup.updated`, `cleanupStatus`, `cleanupLastError`, `cleanupTargets`, `session.process.enqueued`

## Result

- Status: `pass | fail | blocked`
- Gaps:
- Retry / rollback plan:

## Evidence Links

- Logs:
- Screenshots:
- JSON / API payloads:
- Notes:
