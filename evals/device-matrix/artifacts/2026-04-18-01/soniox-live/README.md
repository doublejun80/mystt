# 2026-04-18-01 Soniox Live Artifacts

이 디렉터리는 역사적 forensic 용도로만 남겨 둔 stale artifact 묶음입니다.

- `run-summary.json`이 이 lane 전체를 `stale`로 재분류합니다.
- `health.json`, `upload-response.json`, `process-response.json`, `session-after-process.json`, `cleanup-response.json`은 현재 계약과 충돌하는 legacy 응답이라 내용 대신 stale marker로 교체했습니다.
- `audit-events-before-cleanup.json`, `audit-events-after-cleanup.json`, `create-session.json`, `session-id.txt`는 서버 내부 흐름 추적용 historical capture로만 유지합니다.
- current pass evidence가 필요하면 live credentials + infra가 준비된 상태에서 이 디렉터리를 fresh rerun으로 교체해야 합니다.
