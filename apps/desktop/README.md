# mystt Desktop

노트북 장시간 녹음을 브라우저 탭 수명보다 안정적인 앱 셸에서 열기 위한 Tauri 레인입니다.

## What It Does

- 로컬 개발 포털 `http://127.0.0.1:3203`
- 운영 포털 `https://mystt.doublejun.digital`
- 둘 중 먼저 살아 있는 대상을 자동으로 열려고 시도
- `@mystt/audio-core`의 shared recorder contract를 그대로 읽어 120분 레일 상태를 보여 줌
- macOS에서는 설정 안에서 `장시간 녹음 보호`를 켜면 `caffeinate` 기반 keep-awake 레인을 사용
- Tauri recorder ledger가 `runtime-state.json` 과 `sessions.json` 을 앱 데이터 경로 아래에 유지
- 장시간 세션 검증의 증거는 [evals/device-matrix/desktop/README.md](../../evals/device-matrix/desktop/README.md)에 남긴다.

## Commands

```bash
pnpm desktop:preflight
pnpm --filter @mystt/desktop typecheck
pnpm --filter @mystt/desktop build
pnpm --filter @mystt/desktop tauri dev
VITE_DESKTOP_OPEN_DIAGNOSTICS=1 VITE_DESKTOP_AUTOSTART_KEEP_AWAKE=1 pnpm --filter @mystt/desktop tauri dev
```

## Notes

- `pnpm desktop:preflight`는 `4100` API, `3203` 로컬 포털, 선택적으로 `1420` Tauri Vite dev shell, Docker daemon 상태를 한 번에 확인합니다.
- source-audio 다운로드 QA를 스크립트로 확인할 때는 아래처럼 최근 세션의 source-audio URL을 넣습니다. preflight는 URL을 `format=mp3`로 정규화하고, `audio/mpeg`, `.mp3` attachment filename, nonzero response bytes를 확인합니다.

```bash
MYSTT_DESKTOP_DOWNLOAD_QA_URL="http://127.0.0.1:3203/v1/sessions/<session-id>/source-audio" \
MYSTT_DESKTOP_DOWNLOAD_QA_FILE_NAME="qa-source.wav" \
pnpm desktop:preflight
```

- 포트 의미는 `4100=API`, `3203=desktop이 iframe으로 여는 로컬 포털`, `1420=Tauri dev shell` 입니다.
- preflight가 실패하면 출력된 명령부터 띄우고 다시 실행한 뒤 `tauri dev`로 넘어가면 됩니다.
- 검증 캡처가 필요하면 `VITE_DESKTOP_OPEN_DIAGNOSTICS=1`로 운영 상태 overlay를 자동으로 열 수 있습니다.
- `VITE_DESKTOP_AUTOSTART_KEEP_AWAKE=1`을 함께 주면 macOS `caffeinate` 기반 keep-awake 레인이 켜진 상태로 시작합니다.
- `VITE_DESKTOP_SCROLL_TARGET=<element-id>`를 같이 주면 diagnostics overlay가 특정 카드(`settings-target-list`, `desktop-shell-summary`, `desktop-keep-awake-pill`)까지 자동 스크롤됩니다.
- 이 셸은 `노트북 2시간 레인`을 위한 진입점이자, 이후 recorder adapter를 붙일 자리다.
- 로컬 recorder 루트와 runtime-state 경로는 설정에서 직접 확인할 수 있다.
- 복구 후보가 있으면 설정 안 `Recorder 생존 상태`에서 최근 evidence와 saved session count를 함께 확인할 수 있다.
- 장시간 세션 전에는 `장시간 녹음 보호`를 켜 두고, 종료 후 다시 끄는 절차를 권장한다.
- 이 desktop lane은 `Tauri shell`, `portal target`, `keep-awake`, `recorder ledger persistence`를 증명한다.
- 실제 `화면 꺼짐` 생존성, background audio, 그리고 마이크가 잠금 상태에서도 계속 살아 있는지는 모바일 네이티브 또는 Tauri 모바일 네이티브 플러그인 lane 증거가 필요하다.
- desktop에서의 long-session 통과만으로 mobile screen-off survivability를 주장하지 않는다.
- dev에서는 로컬 포털이 켜져 있지 않으면 운영 도메인으로 수동 전환할 수 있다.

## Manual Tauri Download QA Evidence

스크립트가 응답 바이트와 헤더를 확인해도, Tauri bridge가 실제 Downloads 폴더에 저장하는지는 앱에서 증거를 남겨야 합니다.

1. `pnpm desktop:preflight`를 통과시킨 뒤 `VITE_DESKTOP_OPEN_DIAGNOSTICS=1 pnpm --filter @mystt/desktop tauri dev`를 실행합니다.
2. 새 녹음을 만들고 업로드 완료 후 `방금 녹음한 파일 다운로드`를 누릅니다.
3. 포털 메시지 또는 Downloads 폴더에서 저장 경로를 캡처합니다. 파일명은 `.mp3`여야 하고 Finder 정보 또는 `ls -l ~/Downloads/<file>.mp3`로 크기가 0보다 큼을 남깁니다.
4. 최근 세션 목록에서 같은 세션의 음성 다운로드를 누릅니다.
5. 저장된 최근 세션 파일도 `.mp3` 파일명과 0보다 큰 크기를 캡처합니다.
6. API 또는 브라우저 개발자 도구에서 두 다운로드 요청이 모두 `/source-audio?format=mp3`였음을 남깁니다.

Rollback plan: MP3 다운로드가 실패하면 원본 source-audio 저장은 삭제하지 말고, 사용자는 웹 detail의 원본 다운로드 링크로 fallback 합니다. 관찰 포인트는 preflight의 `MP3 download QA` 행, Tauri `download-complete/download-failed` portal message, Downloads 폴더의 파일명/크기, API route의 `content-type` 및 `content-disposition` 입니다.
