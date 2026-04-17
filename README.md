# mystt

`plan.md`를 실행 가능한 제품/엔지니어링 골격으로 옮긴 모노레포입니다.

핵심 원칙은 세 가지입니다.

1. 모바일은 항상 로컬 원본 오디오를 먼저 남깁니다.
2. 실시간 자막은 편의 기능이고, 최종 산출물은 Soniox async transcript 기준으로 만듭니다.
3. Codex는 단순 코드 생성기가 아니라 작업 분업과 검증 규칙을 가진 하네스 위에서 움직입니다.

## Workspace Map

- `apps/mobile`: Expo 기반 레코더 앱 골격
- `apps/desktop`: Tauri 기반 노트북 장시간 녹음 셸
- `apps/web`: 세션 검토/검색/다운로드 포털 골격
- `services/api`: temp key, 세션 API, webhook entrypoint
- `services/worker-session`: Redis queue를 소비하는 세션 파이프라인 워커
- `services/worker-transcribe`: Soniox async job orchestration 골격
- `services/worker-summarize`: structured notes 생성 파이프라인 골격
- `services/worker-mail`: 메일 렌더링/발송 골격
- `packages/*`: 오디오 도메인, Soniox payload, transcript normalize, notes schema, UI tokens
- `infra/*`: Docker Compose, reverse proxy, Portainer 운영 메모, 백업 가이드
- `infra/postgres`, `infra/minio`, `infra/runbooks`: persistence schema와 복구 절차
- `evals/*`: golden set, 요약 평가, 디바이스 매트릭스
- `.agents/skills/*`: Codex 재사용 워크플로

## Quick Start

```bash
corepack enable
pnpm install
pnpm smoke
pnpm dev
```

```bash
cp .env.example .env
pnpm compose:infra
pnpm --filter @mystt/api dev
pnpm --filter @mystt/worker-session dev
WEB_HOST=0.0.0.0 WEB_PORT=3203 pnpm --filter @mystt/web dev
pnpm --filter @mystt/mobile dev
pnpm --filter @mystt/desktop tauri dev
```

- 로컬 개발 기본 포트는 충돌을 피하려고 `web=3200`, `api=4100`, `postgres=55432`, `redis=56379`, `minio=19000/19001`, `mailpit=11025/18025`를 사용합니다.
- Docker 내부 서비스는 `postgres`, `redis`, `minio`, `mailpit` 호스트명으로 자동 override 되므로, 로컬 `pnpm dev`와 Docker 실행을 섞어도 됩니다.

```bash
pnpm exec tsx scripts/vertical-slice.ts --audio_url https://soniox.com/media/examples/coffee_shop.mp3 --title "Smoke" --mode meeting --project smoke
```

- 로컬 하네스에서는 `API_DOMAIN=api.localhost`일 때 Soniox webhook URL을 자동으로 생략합니다.
- 운영에서 Soniox webhook을 켜려면 `.env`에 `SONIOX_WEBHOOK_URL=https://<public-api-domain>/v1/webhooks/soniox`를 넣으면 됩니다.
- `REDIS_URL`이 유효하면 `POST /v1/sessions/:sessionId/process`는 Redis에 job을 enqueue 하고 `worker-session`이 전체 vertical slice를 처리합니다.
- 로컬 브라우저 기본 진입점은 `http://127.0.0.1:3203`, API는 `http://127.0.0.1:4100/health`입니다.
- 같은 와이파이의 핸드폰에서 웹을 열려면 `http://<개발 머신 LAN IP>:3203`으로 접속하면 됩니다.
- 웹 포털은 `/health`, `/v1/*`를 same-origin으로 API에 프록시하므로, 핸드폰 브라우저는 `3200` 한 포트만 보면 됩니다.
- 다만 핸드폰 브라우저에서 마이크 녹음을 실제로 쓰려면 `HTTPS secure context`가 필요할 수 있습니다. `http://192.168.x.x` 같은 LAN 주소는 브라우저 정책상 녹음 권한이 막힐 수 있으므로, 이 경우에는 HTTPS 터널이나 네이티브 앱을 써야 합니다.
- `화면 꺼짐 + 2시간 연속`을 제품 요구로 보장하려면 모바일 브라우저가 아니라 `apps/mobile` 네이티브 레코더 레인을 기준으로 가야 합니다.
- `apps/mobile`은 Expo `expo-audio` 기반으로 로컬 원본 오디오를 먼저 저장하고, 개발 중에는 `Constants.expoConfig.hostUri`로 로컬 API 호스트를 추론합니다. 운영에서는 `EXPO_PUBLIC_API_BASE_URL=https://mystt.doublejun.digital` 같은 HTTPS 도메인을 우선 사용합니다.
- iPhone 네이티브 테스트는 퍼블릭 호스팅이 필수가 아닙니다. 같은 와이파이에서 `pnpm mobile:lan`으로 Expo 앱을 띄우면, 앱이 자동으로 `http://<개발 머신 LAN IP>:4100` API를 보게 됩니다.
- 잠금 화면/백그라운드 검증은 Expo Go만으로 끝내지 않고, `pnpm mobile:dev-client`, `pnpm --filter @mystt/mobile ios:device`, `pnpm --filter @mystt/mobile android:device`, `apps/mobile/eas.json` development profile을 우선 경로로 둡니다.
- 네트워크를 벗어나거나 Expo LAN이 안 잡히면 `pnpm mobile:tunnel`을 쓰되, 이 경우 API는 공개 도메인(`https://mystt.doublejun.digital`) 또는 별도 HTTPS 터널이 필요합니다.
- Safari에서 웹 포털을 여는 것과 iPhone 네이티브 recorder 검증은 다른 문제입니다. 웹 포털은 검토/공유용이고, 잠금 화면 120분 증거는 반드시 네이티브 앱에서 확인해야 합니다.
- `apps/desktop`은 Tauri 셸로 로컬 `http://127.0.0.1:3203` 또는 운영 `https://mystt.doublejun.digital` 포털을 앱 창에 띄우고, InsForge auth/storage는 설정 모달에서 다루는 노트북 레인입니다.
- 데스크톱 셸 설정에는 로컬 recorder 루트, runtime-state 경로, sessions 인덱스, keep-awake(`caffeinate`) 상태가 표시됩니다.
- 세션 처리 완료 후 API는 `raw_transcript_json`, `clean_transcript_md`, `meeting_notes_json`, `meeting_notes_html`, `meeting_notes_docx`, `email_preview_html`를 생성합니다.
- `POSTGRES_URL`과 MinIO 설정이 유효하면 API는 Postgres/MinIO에 write-through 하고, 실패하면 `.data` fallback을 유지합니다.
- `INSFORGE_BASE_URL`이 있으면 API는 `/v1/insforge/*` auth/storage bridge를 같이 엽니다.
- `INSFORGE_ADMIN_TOKEN`과 `INSFORGE_STORAGE_SHADOW_WRITE=true`를 주면 transcript/notes artifact를 InsForge storage로 shadow write 합니다.
- `pnpm insforge:check`는 InsForge public auth config를 확인하고, `--ensure-buckets`를 붙이면 `audio`, `artifacts` private bucket 생성을 시도합니다.
- `audioUrl` 기반 세션 처리에서는 원본 오디오를 `audio/<session_id>/...` 또는 `.data/audio/sessions/<session_id>/...`에 먼저 보관하려고 시도합니다.
- 웹 레코더는 장시간 녹음에서 raw PCM 전체를 메모리에만 쌓지 않고, 압축 오디오와 IndexedDB 로컬 보존을 우선 사용합니다.
- 세션별 운영 추적은 `GET /v1/sessions/:sessionId/audit-events`에서 확인할 수 있습니다.
- `/health` 응답에는 persistence 상태와 함께 queue mode/depth가 포함되어 하네스에서 worker lane을 바로 점검할 수 있습니다.

## Graphify

Codex는 이 저장소에서 raw 파일을 바로 훑기 전에 `graphify-out/GRAPH_REPORT.md`와 `graphify-out/wiki/index.md`를 먼저 보도록 연결돼 있습니다.

```bash
pnpm graphify:build
pnpm graphify:query -- "processSessionVerticalSlice"
```

운영 메모, 검증 기준, rollback plan은 [docs/graphify.md](/Volumes/mac_dock/github/mystt/docs/graphify.md)에서 관리합니다.

## Delivery Model

- `V1`: local recording, async upload, Soniox transcript, OpenAI summary, email, web review
- `V1.5`: foreground realtime captions, rolling chunk upload, interim summary
- `V2`: bi-directional translation, team workspace, CRM/calendar/task integrations

## Persistence Model

- Postgres stores session metadata, transcription jobs, artifact state, provider checks, and audit events.
- Postgres also stores normalized transcript cache and webhook idempotency fingerprints for warm restarts.
- MinIO stores audio and generated artifacts using session-scoped object paths.
- Provider cleanup remains part of the operational contract, not an optional background task.

## Harness Rules

- 영구 API 키는 절대 클라이언트에 넣지 않습니다.
- 업로드와 무결성 검증이 끝나기 전에는 원본 오디오를 지우지 않습니다.
- background audio 변경에는 실기기 증거가 필요합니다.
- Soniox async 파일/전사 리소스는 완료 후 정리 잡으로 삭제합니다.
- 요약 산출물은 자유 텍스트가 아니라 schema 기반 JSON을 우선합니다.

## Native Recorder Notes

- 모바일 네이티브 레코더는 mono AAC `64kbps` 기준으로 2시간 녹음 시 대략 `56MB` 전후를 목표로 합니다.
- 모바일 앱은 `로컬 저장 -> API 업로드 -> Soniox fileId -> async queue` 순서를 따릅니다. 이번 라운드에서는 `로컬 저장`, `서버 큐 등록`, `백그라운드 오디오 모드`까지 연결했습니다.
- 노트북 장시간 사용은 브라우저 탭 대신 `apps/desktop` Tauri 셸을 우선 경로로 둡니다.
- Tauri recorder ledger는 `app data dir/mystt-recorder` 아래에 `runtime-state.json`, `sessions.json`, `recordings/<session-id>/session.json` 구조를 유지합니다.
- 모바일 Tauri 재사용 골격은 `apps/mobile/native/tauri-plugin-recorder` 아래에 정리합니다.
- 실기기 검증 없이 `화면 꺼짐 성공`으로 간주하지 않습니다. 검증 절차는 [mobile-native-recorder.md](/Volumes/mac_dock/github/mystt/infra/runbooks/mobile-native-recorder.md)에 정리합니다.
