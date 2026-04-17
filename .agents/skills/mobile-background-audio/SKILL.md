# mobile-background-audio

모바일 녹음 경로를 바꿀 때 사용하는 스킬입니다.

## Focus

- 로컬 파일 보존
- chunk rotation
- interruption / route change 대응
- background 전환 시 상태 일관성

## Checklist

1. foreground와 background에서 각각 어떤 오디오 경로가 살아남는지 적는다.
2. 녹음 상태, 마지막 chunk flush 시각, 업로드 대기량을 UI 또는 로그로 노출한다.
3. iOS와 Android 차이를 주석이 아니라 명시적 타입/문서/테스트 포인트로 남긴다.
4. 실기기 검증 항목을 완료 기준에 넣는다.

## Evidence

- iOS lock screen 30분 이상 녹음 확인
- Android foreground service 유지 확인
- interruption 이후 복귀 시 chunk 무결성 확인

