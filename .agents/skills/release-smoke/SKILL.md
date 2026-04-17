# release-smoke

릴리즈 전 가장 위험한 경로를 빠르게 확인할 때 사용하는 스킬입니다.

## Focus

- 녹음 생존
- 업로드 성공
- async transcript 도착
- structured notes 생성
- 메일 발송
- live provider reachability

## Checklist

1. 모바일에서 세션 시작 후 local audio 경로가 생기는지 확인한다.
2. 업로드 완료 후 세션 상태가 `transcribing`으로 넘어가는지 본다.
3. webhook 수신 후 notes와 email artifact가 준비되는지 확인한다.
4. 포털에서 같은 세션을 검색하고 다운로드 링크를 확인한다.
5. live provider slice는 `pnpm exec tsx scripts/vertical-slice.ts`로 재현 가능한지 확인한다.
