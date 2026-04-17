# mystt Desktop

노트북 장시간 녹음을 브라우저 탭 수명보다 안정적인 앱 셸에서 열기 위한 Tauri 레인입니다.

## What It Does

- 로컬 개발 포털 `http://127.0.0.1:3203`
- 운영 포털 `https://mystt.doublejun.digital`
- 둘 중 먼저 살아 있는 대상을 자동으로 열려고 시도
- `@mystt/audio-core`의 shared recorder contract를 그대로 읽어 120분 레일 상태를 보여 줌
- macOS에서는 설정 안에서 `장시간 녹음 보호`를 켜면 `caffeinate` 기반 keep-awake 레인을 사용
- Tauri recorder ledger가 `runtime-state.json` 과 `sessions.json` 을 앱 데이터 경로 아래에 유지

## Commands

```bash
pnpm --filter @mystt/desktop typecheck
pnpm --filter @mystt/desktop build
pnpm --filter @mystt/desktop tauri dev
```

## Notes

- 이 셸은 `노트북 2시간 레인`을 위한 진입점이자, 이후 recorder adapter를 붙일 자리다.
- 로컬 recorder 루트와 runtime-state 경로는 설정에서 직접 확인할 수 있다.
- 복구 후보가 있으면 설정 안 `Recorder 생존 상태`에서 최근 evidence와 saved session count를 함께 확인할 수 있다.
- 장시간 세션 전에는 `장시간 녹음 보호`를 켜 두고, 종료 후 다시 끄는 절차를 권장한다.
- 실제 `화면 꺼짐` 생존성은 모바일 네이티브 또는 Tauri 모바일 네이티브 플러그인 증거가 핵심이다.
- dev에서는 로컬 포털이 켜져 있지 않으면 운영 도메인으로 수동 전환할 수 있다.
