# InsForge Phase 1

`mystt`의 1차 InsForge 연동은 `인증 + 스토리지 연결 시작`까지만 다룹니다.
이번 단계의 목표는 현재 Postgres/MinIO 기반 파이프라인을 깨지 않고, InsForge를 제품 경로에 안전하게 끼워 넣는 것입니다.

## Scope

- 인증: InsForge Auth public config, sign-in, refresh, current session 검증
- 스토리지: bucket 점검/생성, upload strategy, confirm-upload, artifact shadow write
- 유지: 기존 Postgres, Redis, Soniox, OpenAI, MinIO primary path

## Why This Order

1. 원본 오디오 생존을 깨지 않기 위해 raw audio primary path는 유지한다.
2. artifact는 재생성 가능하므로 InsForge storage shadow write 대상에 먼저 넣는다.
3. auth를 먼저 붙여야 mobile/desktop/web 포털이 같은 user/workspace 모델을 공유할 수 있다.

## Phase 1 Changes

### API

- `INSFORGE_BASE_URL`, `INSFORGE_ADMIN_TOKEN`, bucket/env flags를 추가한다.
- `/v1/insforge/auth/public-config`
- `/v1/insforge/auth/sign-up`
- `/v1/insforge/auth/sign-in`
- `/v1/insforge/auth/refresh`
- `/v1/insforge/auth/session`
- `/v1/insforge/storage/buckets`
- `/v1/insforge/storage/buckets/ensure`
- `/v1/insforge/storage/upload-strategy`
- `/v1/insforge/storage/confirm-upload`

### Storage

- `meeting_notes_*`, transcript artifact 같은 재생성 가능한 결과물만 InsForge로 shadow write 한다.
- shadow write는 health/runtime status에 드러나야 한다.
- raw audio는 이번 단계에서 InsForge를 primary로 바꾸지 않는다.

### Clients

- web/mobile/desktop에 InsForge auth bootstrap helper를 추가한다.
- desktop Tauri는 메인에서 원래 포털을 띄우고, InsForge auth/storage 패널은 설정 모달로 숨긴다.
- desktop 설정 모달에서 `계정 만들기`, `로그인`, `세션 확인`, `버킷 보장`을 처리할 수 있어야 한다.
- 실제 UI wiring은 다음 단계에서 하더라도, 각 앱이 auth/session/storage strategy를 호출할 수 있어야 한다.

## Required Dashboard Work

작업 위치: [https://insforge.doublejun.digital/](https://insforge.doublejun.digital/)

1. `Authentication`
2. `Storage`
3. `Storage` 안에서 `audio`, `artifacts` private bucket 확인 또는 생성
4. server-side runtime용 admin token 확보

## Rollback

- `INSFORGE_STORAGE_SHADOW_WRITE=false`
- `INSFORGE_BASE_URL` 또는 `INSFORGE_ADMIN_TOKEN` 제거
- 기존 MinIO/Postgres path는 그대로 유지되므로 기능 롤백은 env 단위로 가능하다.

## Observability

- `/health`에 InsForge runtime status 노출
- storage shadow write 성공/실패 로그
- bucket ensure 결과 기록
- auth public config/session check 실패 원인 기록

## Test Criteria

- `GET /v1/insforge/auth/public-config` 성공
- `POST /v1/insforge/auth/sign-up` 성공
- `POST /v1/insforge/auth/sign-in` 성공
- `GET /v1/insforge/auth/session` 성공
- `GET /v1/insforge/storage/buckets` 성공
- `POST /v1/insforge/storage/buckets/ensure`로 `audio`, `artifacts` 보장
- `INSFORGE_STORAGE_SHADOW_WRITE=true`일 때 artifact shadow write 성공
- `pnpm --filter @mystt/desktop tauri dev`에서 설정 모달을 열어 현재 세션과 bucket 목록 확인

## Not Done Yet

- workspace/user ownership schema
- raw audio direct-to-InsForge presigned upload as primary path
- mobile/desktop background recorder와 token lifecycle 통합
- screen-off 120m 실기기 검증
