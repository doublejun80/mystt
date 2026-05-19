# Desktop Lane

이 lane은 Tauri recorder ledger와 portal target을 확인한다. 로컬 portal과 hosted domain target을 구분해서 적는다.

## What to Verify

- `appDataDir` 아래에 `recorderRoot`와 `recordingsRoot`가 생성되는지 본다.
- `sessions.json` ledger와 `runtime-state.json`이 둘 다 기대한 위치에 있는지 본다.
- `saved_session_count`와 `recent_sessions`가 실제 저장 수와 맞는지 본다.
- keep-awake 상태가 장시간 녹음 동안 유지되는지 본다.
- local portal vs hosted domain target이 실행 환경과 맞는지 본다.

## Automated Verification

- `pnpm desktop:preflight`
- store status 확인
- `recorderRoot`, `recordingsRoot`, `ledgerPath`, `runtimeStatePath` 검증
- `saved_session_count`, `recent_sessions`, `has_runtime_state` 확인
- `runtime-state.json` 존재 여부 확인

## Manual Evidence Required

- 실제 macOS 또는 Windows 실행 화면
- visible shell target에서 열린 portal URL 또는 host를 보여 주는 화면이나 status artifact
- keep-awake 상태가 켜진 화면
- 장시간 녹음 중 절전 방지 유지 증거

## Capture Checklist

- `appDataDir`
- `recorderRoot`
- `recordingsRoot`
- `sessions.json`
- `runtime-state.json`
- `saved_session_count`
- `recent_sessions`
- keep-awake status
- visible shell target portal URL / host

## Pass / Fail

- Pass: recorder root와 ledger가 유지되고, keep-awake와 portal target이 의도한 대로 보인다.
- Fail: ledger가 비거나, runtime state가 사라지거나, target URL이 잘못 열리거나, keep-awake가 꺼진다.
- Retry: 저장 경로와 shell target을 다시 확인한 뒤 재실행한다.

## Manual Run Order

1. `pnpm desktop:preflight`
2. 필요하면 `pnpm --filter @mystt/api dev`
3. 필요하면 `WEB_HOST=0.0.0.0 WEB_PORT=3203 pnpm --filter @mystt/web dev`
4. `pnpm --filter @mystt/desktop tauri dev`
5. Tauri 창에서 portal target, keep-awake, `appDataDir`, `recorderRoot`, `runtime-state path`를 캡처한다.
6. 결과를 `evidence-ledger.md` row와 desktop artifact에 연결한다.

## Verification Helper

- `VITE_DESKTOP_OPEN_DIAGNOSTICS=1 pnpm --filter @mystt/desktop tauri dev`
- `VITE_DESKTOP_AUTOSTART_KEEP_AWAKE=1`을 같이 주면 keep-awake card가 `켜짐` 상태로 열리도록 도울 수 있다.
- `VITE_DESKTOP_SCROLL_TARGET=settings-target-list|desktop-shell-summary|desktop-keep-awake-pill`로 필요한 diagnostics section을 바로 캡처한다.
