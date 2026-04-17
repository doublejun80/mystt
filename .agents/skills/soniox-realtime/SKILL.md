# soniox-realtime

foreground 실시간 자막 기능을 다룰 때 사용하는 스킬입니다.

## Focus

- temporary API key만 사용
- realtime caption은 편의 기능으로 취급
- language identification / diarization / translation 옵션을 명시적으로 선택

## Checklist

1. temp key 발급 흐름을 서버 경유로 고정한다.
2. foreground에서만 realtime stream을 붙이는 정책을 유지한다.
3. realtime partial/final과 async final transcript의 provenance를 구분한다.
4. connection drop 후 로컬 녹음이 계속되는지 검토한다.

