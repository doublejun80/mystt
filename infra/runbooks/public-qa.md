# Public QA Tunnel

`mystt.doublejun.digital` is the temporary HTTPS entrypoint for iOS, Android, and
mobile-browser QA. Keep the public surface narrow: route only the mystt web
portal through Cloudflared, and let the web portal proxy `/health` and `/v1/*`
to the local API.

## Runtime

- DNS: `mystt.doublejun.digital` CNAME to the `affine` Cloudflare tunnel.
- Cloudflared ingress: `mystt.doublejun.digital -> http://127.0.0.1:3203`.
- Web portal for quick local QA: `WEB_HOST=0.0.0.0 WEB_PORT=3203 pnpm --filter @mystt/web dev`.
- Web portal for public multi-device QA: `pnpm --filter @mystt/web build`, then
  `WEB_HOST=0.0.0.0 WEB_PORT=3203 pnpm --filter @mystt/web start`.
- API: `MYSTT_OWNER_EMAIL="$MYSTT_OWNER_EMAIL" MYSTT_OWNER_PASSWORD="$MYSTT_OWNER_PASSWORD" MYSTT_AUTH_SECRET="$MYSTT_AUTH_SECRET" pnpm --filter @mystt/api dev`.
- Optional fallback API gate: `MYSTT_QA_TOKEN=$(cat .data/qa/public-access-token)`.
- Soniox webhook: `SONIOX_WEBHOOK_URL=https://mystt.doublejun.digital/v1/webhooks/soniox`.
- Mobile dev client:
  `EXPO_PUBLIC_API_BASE_URL=https://mystt.doublejun.digital pnpm mobile:dev-client`.

## Access Control

- Preferred owner gate:
  - Set the same `MYSTT_OWNER_EMAIL`, `MYSTT_OWNER_PASSWORD`, and
    `MYSTT_AUTH_SECRET` on both API and web processes.
  - Browser entry: open `https://mystt.doublejun.digital/login` and enter the
    configured email and password. The API sets an httpOnly
    `mystt_owner_session` cookie.
  - API/mobile entry: call `POST /v1/auth/login` with
    `{ "email": "...", "password": "..." }`, then send the returned token as
    `Authorization: Bearer <token>` or keep the returned cookie in the browser.
- Temporary fallback:
  - Set `MYSTT_QA_TOKEN` on both API and web processes only for short QA windows.
  - Browser entry: open `https://mystt.doublejun.digital/?qa=<token>` once. The
    middleware stores an httpOnly `mystt_qa_token` cookie.
  - Do not ship shared fallback tokens in `EXPO_PUBLIC_*` mobile builds. Use the
    owner login endpoint and a short-lived bearer token for device testing.
- `/health` stays public for liveness checks.
- `/v1/webhooks/soniox` stays outside the QA gate because Soniox webhook auth is
  handled by `SONIOX_WEBHOOK_SECRET`.

## Do Not Expose

- Do not route Portainer, MinIO console, Postgres, Redis, or Mailpit through the
  mystt hostname.
- Do not store permanent Soniox or OpenAI API keys in mobile or web bundles.
- Do not leave the tunnel open longer than the QA window if real meeting audio
  or live provider keys are attached.

## Observability

- `GET /health`: public liveness only.
- `GET /ready`: public readiness only. The response must stay minimal:
  `{ "ok": true, "service": "api" }` or the same shape with `ok: false`.
- `GET /v1/diagnostics/ready`: detailed provider, persistence, mail, and queue
  status. Keep this behind the owner/API gate.
- `pnpm ops:status`: local API/web/worker process and health/readiness summary.
- `MYSTT_PUBLIC_BASE_URL=https://mystt.doublejun.digital pnpm ops:status`:
  verifies public `/health` and `/ready` are minimal, and checks that common
  admin/storage paths are not exposed on the mystt hostname.
- API logs: `401` rates, `/v1/auth/login` failures, upload status, process
  status, cleanup status.
- Session audit events: source audio upload, transcription status, cleanup events.
- MinIO/Postgres growth: confirm source audio and artifacts land in the expected
  layout and are not deleted before upload plus hash verification.
- Cloudflared logs: tunnel reconnects, 4xx/5xx spikes, origin connection errors.

## Test Criteria

- Automated owner-auth gate:
  `MYSTT_OWNER_EMAIL="$MYSTT_OWNER_EMAIL" MYSTT_OWNER_PASSWORD="$MYSTT_OWNER_PASSWORD" EXPO_PUBLIC_API_BASE_URL=https://mystt.doublejun.digital node scripts/mobile-public-qa.mjs`.
  The script asserts wrong-password rejection, correct-password cookie session
  persistence, authenticated `/v1/sessions`, logout, and post-logout
  `/v1/sessions` rejection without printing the credentials.
- Public unauthenticated `GET https://mystt.doublejun.digital/health` returns
  only `ok` and `service`.
- Public unauthenticated `GET https://mystt.doublejun.digital/ready` returns
  only `ok` and `service`; detailed queue, provider, persistence, MinIO paths,
  and Postgres details must not appear there.
- Unauthenticated `GET https://mystt.doublejun.digital/` redirects to `/login`
  when owner auth is configured.
- Unauthenticated `GET https://mystt.doublejun.digital/v1/sessions` returns `401`.
- `https://mystt.doublejun.digital/minio`, `/mailpit`, and `/portainer` return
  `401`, `403`, `404`, or a login redirect. They must never render admin
  consoles or storage browsers.
- Owner email/password login sets `mystt_owner_session`, redirects to `/`, and
  renders the portal.
- Bearer-authenticated `GET https://mystt.doublejun.digital/v1/sessions` returns `200`.
- QA fallback `?qa=<token>` entry redirects to `/` and renders the portal when
  `MYSTT_QA_TOKEN` is enabled.
- Mobile dev client can create a session, upload source audio, enqueue processing,
  and preserve the local original audio after upload handoff.
- Soniox async plus OpenAI notes generation produces `meeting_notes_v2`, and
  cleanup status is recorded after completion.
- Rendered web detail, HTML, DOCX, share email text, and share email HTML contain
  no `seg_0001`-style segment ids, numeric speaker prefixes, `conf=`, `lang=`,
  `severity=`, `priority:`, `null::`, `undefined::`, `:null`, empty evidence
  brackets, or raw evidence reference labels.

## Postgres and MinIO Resilience

- Run `pnpm compose:infra` before public QA and after any host sleep/restart.
- Run `pnpm ops:status` locally. If API readiness, web proxy health, or the
  session worker fails, use the `recovery` restart command from the JSON output,
  then run `pnpm ops:status` again.
- Run
  `MYSTT_PUBLIC_BASE_URL=https://mystt.doublejun.digital pnpm ops:status` before
  mobile device QA. A failure means public ingress or origin health is not ready
  for real meeting audio.
- If Postgres restarted, expect `/ready` to go false until the API reconnects.
  Inspect `/v1/diagnostics/ready` locally or through an authenticated owner
  session for `persistence.postgres.lastReadOk` and `lastWriteOk`.
- If MinIO restarted, upload a short smoke recording before a live meeting.
  Confirm source audio upload returns `sha256`, and the audit trail records
  `source_audio.staged`, `source_audio.verified`, then
  `source_audio.soniox_uploaded`.
- Do not delete local source audio or MinIO source objects while investigating a
  failed readiness or hash mismatch. Recovery is retry/restart first, cleanup only
  after upload completion and hash verification.

## Rollback

- Remove the `mystt.doublejun.digital` ingress row from `~/.cloudflared/config.yml`.
- Run `launchctl kickstart -k gui/$(id -u)/com.doublejun.cloudflared.affine`.
- Stop API and web dev servers that were started with `MYSTT_OWNER_EMAIL`,
  `MYSTT_OWNER_PASSWORD`, `MYSTT_AUTH_SECRET`, or `MYSTT_QA_TOKEN`.
- Rotate `MYSTT_OWNER_PASSWORD`, `MYSTT_AUTH_SECRET`, and
  `.data/qa/public-access-token`.
- If owner auth causes a regression, unset `MYSTT_OWNER_EMAIL` and
  `MYSTT_OWNER_PASSWORD`, then use the short-lived `MYSTT_QA_TOKEN` fallback
  while debugging.
