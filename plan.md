# 제 권장안

당장 제품으로 가려면 **Soniox = 음성 계층**, **OpenAI 또는 Gemini = 회의록/요약 계층**, **모바일은 네이티브 계층이 있는 앱**, **웹은 검토·검색·공유 포털**로 나누는 쪽이 맞습니다.
당신 요구사항의 핵심은 “핸드폰 화면이 꺼져도 녹음이 계속돼야 한다”인데, 이건 브라우저보다 **iOS의 `UIBackgroundModes audio`**, **Android의 microphone foreground service** 같은 OS 레벨 기능이 더 중요합니다. Soniox 쪽은 실시간 WebSocket 전사/번역, 비동기 파일 전사, 화자 분리, 언어 식별, 컨텍스트 주입, 웹훅까지는 공개 문서가 잘 되어 있습니다. 반면 Soniox App의 Smart Scribe는 “자동 요약·액션 아이템”을 내세우지만, 제가 확인한 **공개 STT API 문서에는 같은 수준의 요약 API 엔드포인트가 드러나지 않았습니다.** 그래서 커스텀 서비스라면 **Soniox + LLM 1개(OpenAI 또는 Gemini)** 조합이 현실적입니다. ([Soniox | Speech-to-Text AI][1])

---

## 1) Soniox가 맡아야 할 영역

Soniox는 여기까지 맡기면 됩니다.

- **실시간 STT**: WebSocket API로 라이브 오디오를 낮은 지연으로 전사합니다. 실시간 번역, 화자 분리, 컨텍스트, 수동 finalization까지 같은 연결에서 다룹니다. ([Soniox | Speech-to-Text AI][1])
- **비동기 STT**: `audio_url`이나 `file_id`로 녹음 파일을 올리면 백그라운드로 처리되고, 폴링이나 웹훅으로 완료를 받습니다. 회의 종료 후 최종본 생성에는 이 경로가 더 안정적입니다. ([Soniox | Speech-to-Text AI][2])
- **실시간 번역**: one-way, two-way 번역 모드가 있고, 일본어↔한국어 같은 양방향 예시도 공식 문서에 나옵니다. 실시간 자막/통역 기능 추가에 바로 쓸 수 있습니다. ([Soniox | Speech-to-Text AI][3])
- **언어 자동 식별 + 혼용 언어 대응**: language identification은 지원 언어 전체에서 사용 가능하고, Soniox는 60+ 언어를 실시간/비동기 양쪽에서 지원합니다. 한·영 혼용 회의에 유리합니다. ([Soniox | Speech-to-Text AI][4])
- **화자 분리**: speaker diarization으로 회의, 인터뷰, 팟캐스트 같은 다화자 상황을 speaker-labeled transcript로 뽑을 수 있습니다. ([Soniox | Speech-to-Text AI][5])
- **도메인 용어 보정**: `context`에 도메인, 주제, 참가자 이름, 중요한 용어, 번역 용어를 넣어 정확도를 높일 수 있습니다. 회사명, 제품명, 벤더명, 약어가 많은 회의에서 꽤 중요합니다. ([Soniox | Speech-to-Text AI][6])
- **타임스탬프 / confidence / speaker / language 단위 출력**: segment와 token에 `start_ms`, `end_ms`, `speaker`, `language`, `confidence`가 들어갑니다. 그래서 “몇 시점에 누가 뭐라고 했는지”를 재구성하기 좋습니다. ([Soniox | Speech-to-Text AI][7])
- **클라이언트 임시키**: 브라우저/앱에서 실시간 연결을 할 때는 서버가 temporary API key를 발급하는 구조가 공식 예제로 나옵니다. 영구 키를 모바일 앱에 심으면 안 됩니다. ([Soniox | Speech-to-Text AI][8])

---

## 2) Soniox만으로 끝나나? 아니면 OpenAI / Gemini가 꼭 필요한가?

제 판단은 명확합니다. **커스텀 앱이라면 LLM 계층이 필요합니다.**

이유는 두 가지입니다.

1. **Soniox App** 쪽 공식 페이지는 Smart Scribe 기능으로 **live transcription, automatic summaries, action items**를 전면에 내세웁니다. 한국어 페이지도 요약, takeaways, action items, speaker-structured transcript를 명시합니다. ([Soniox | Speech-to-Text AI][9])
2. 그런데 제가 확인한 **공개 STT API 문서**는 실시간/비동기 전사, 번역, 언어 식별, 화자 분리, 컨텍스트, 웹훅, 파일 업로드/삭제는 문서화하지만, **Smart Scribe 수준의 공개 summary/action-items API 엔드포인트는 찾지 못했습니다.** 안전하게 제품화하려면 요약 계층은 별도 LLM으로 설계하는 게 맞습니다. ([Soniox | Speech-to-Text AI][1])

여기서 중요한 판단은 하나입니다.
**Soniox + OpenAI** 또는 **Soniox + Gemini** 중 하나로 먼저 가고, **둘 다 동시에 붙이지는 않는 것**이 좋습니다. v1에서 멀티 LLM은 품질보다 운영 복잡도만 먼저 늘어납니다.

---

## 3) OpenAI vs Gemini: 요약/회의록 계층은 무엇이 더 맞나

### 제 기본 추천: **v1은 OpenAI**

이유는 개발 운영까지 같이 보면 더 자연스럽기 때문입니다.

- OpenAI 공식 문서는 **Codex가 GPT-5 계열과 잘 맞고**, 일반적인 코드 생성 기본값으로 `gpt-5.4`를 권장합니다. 코딩 에이전트 하네스를 이미 염두에 두고 있다면, 개발 스택과 요약 스택을 한 벤더로 맞추는 편이 관리가 단순합니다. ([OpenAI 개발자][10])
- OpenAI API는 **structured outputs (`json_schema`)**를 공식적으로 지원합니다. 회의록 요약을 자유 텍스트로 받지 말고, `summary`, `decisions[]`, `action_items[]`, `owners[]`, `risks[]`, `open_questions[]` 같은 JSON으로 강제하는 데 유리합니다. ([OpenAI 플랫폼][11])
- `gpt-5.4`는 1,050,000 context window, `gpt-5.4 mini`는 400,000 context window와 structured outputs를 지원합니다. 긴 회의록에도 충분히 여유가 있습니다. ([OpenAI 플랫폼][12])
- 가격도 명확합니다. 공식 가격 페이지 기준으로 `GPT-5.4 mini`는 입력 $0.75 / 1M tokens, 출력 $4.50 / 1M tokens입니다. 회의록 요약 같은 텍스트 후처리는 보통 오디오 STT보다 비용보다 운영 품질이 더 중요한 구간입니다. ([OpenAI][13])

### Gemini가 더 나은 경우

- Google 공식 문서는 Gemini가 **1 million tokens** long context를 강조하고, **JSON schema structured outputs**, **Files API**, **context caching**, **Batch API 50% cost reduction**을 제공합니다. 문서 묶음, 긴 회의록, 첨부자료까지 한 번에 태워서 후처리할 때는 Gemini가 매력적입니다. ([Google AI for Developers][14])

### 그래서 어떻게 고르나

- **Codex 중심으로 개발 조직을 짤 것**이면: **OpenAI**
- **아주 긴 문맥 / Google 생태계 / 대용량 배치 최적화**가 더 중요하면: **Gemini**

저라면 v1은 **Soniox + OpenAI**로 시작합니다.
나중에 Gemini는 **fallback lane**이나 **A/B 평가 lane**으로 붙입니다.

---

## 4) 웹으로 할지, Tauri로 할지, 네이티브 모바일로 갈지

### 순수 웹 서비스만으로 가는 건 비추천

Soniox는 브라우저에서 temporary API key를 써서 마이크를 직접 WebSocket으로 스트리밍하는 “direct stream” 가이드를 공식으로 제공합니다. 데스크톱 브라우저에서 실시간 자막을 띄우는 용도로는 좋습니다. 다만 브라우저 마이크는 secure context(HTTPS) 전제가 붙고, 당신 요구사항의 핵심인 **“폰 화면이 꺼져도 녹음 유지”**는 결국 **iOS background audio mode**와 **Android microphone foreground service**처럼 OS 권한/라이프사이클을 정면으로 다뤄야 합니다. 이 요구는 웹보다 앱이 맞습니다. ([Soniox | Speech-to-Text AI][15])

### Tauri 모바일은 “가능”하지만 v1 주력으로는 비추천

Tauri 공식 문서는 모바일 플러그인을 **Android는 Kotlin 클래스**, **iOS는 Swift 클래스**로 개발한다고 설명하고, Android 쪽도 결국 공식 Android 관행이 그대로 적용된다고 말합니다. 즉, 당신 요구사항의 제일 어려운 부분인 **백그라운드 녹음 / foreground service / background upload / 오디오 스트리밍**은 Tauri를 써도 결국 Kotlin/Swift 네이티브 코드를 꽤 써야 합니다. “웹 기술로 끝난다”가 아닙니다. ([Tauri][16])

### 가장 현실적인 선택: **React Native + Expo prebuild(또는 bare)**

- Soniox는 공식으로 **React Native SDK**를 제공하고, React Native/Expo와 동작한다고 적어 둡니다. 다만 예제는 PCM 스트리밍을 위해 **custom AudioSource**를 감싸는 방식까지 보여 줍니다. 즉, 가능하지만 오디오 파이프라인을 진지하게 붙여야 합니다. ([Soniox | Speech-to-Text AI][8])
- Expo의 `expo-audio` 문서는 **background recording**을 공식적으로 다루며, Android에서는 foreground service와 persistent notification, iOS에서는 `audio` background mode를 붙입니다. “screen lock 상태에서도 recording continues in background” 예시도 문서에 나옵니다. ([Expo Documentation][17])

**판정**

- **모바일 녹음기 본체**: React Native + Expo prebuild/bare
- **검토/검색/공유 포털**: 당신 도메인 아래의 웹
- **Tauri**: 데스크톱 관리자 앱이면 고려 가능, 모바일 v1 주력으로는 비추천

---

## 5) 제일 중요한 아키텍처 원칙: “실시간 스트림은 편의 기능, 로컬 녹음이 원본”

이 부분이 실패하면 앱 전체가 흔들립니다.

Apple 문서는 background URLSession이 **앱이 돌고 있지 않아도 uploads/downloads**를 계속할 수 있다고 설명합니다. 반면 WebSocket 관련 문서는 WebSocket task 자체를 설명할 뿐, 같은 수준의 background transfer 보장을 말하지 않습니다. 그래서 **iPhone 화면이 꺼진 상태에서 WebSocket 실시간 STT만 믿고 제품 약속을 하는 건 위험**합니다. 저는 그걸 핵심 경로로 두지 않겠습니다. ([Apple Developer][18])

그래서 설계는 이렇게 갑니다.

### A. 녹음은 항상 폰에 로컬 저장

- 세션 시작 시 앱이 **원본 오디오 파일**을 로컬에 기록합니다.
- 긴 회의면 5분 또는 10분 단위로 **rolling chunk**도 같이 만듭니다.
- 이 오디오가 진짜 source of truth입니다.

### B. 앱이 foreground일 때만 Soniox 실시간 스트림

- 사용자가 앱을 보고 있을 때는 Soniox WebSocket으로 PCM을 보내서 **라이브 자막 / 부분 전사 / 실시간 번역**을 보여 줍니다. ([Soniox | Speech-to-Text AI][1])
- 앱이 background/locked로 가면, 라이브 뷰는 포기해도 됩니다. 핵심은 **녹음이 안 끊기는 것**입니다.

### C. 세션 종료 직후 또는 chunk 단위로 백엔드 업로드

- iOS는 background upload, Android는 foreground service/작업 스케줄과 결합해서 업로드를 이어 갑니다. Android는 microphone foreground service를 **앱이 보일 때 시작**해야 하며, 그 후 background microphone capture를 이어가는 형태가 정석입니다. ([Android Developers][19])
- Soniox async transcription은 `audio_url` 또는 `file_id` 기반으로 백그라운드 처리되며, 웹훅으로 완료를 받습니다. ([Soniox | Speech-to-Text AI][2])

### D. 최종 회의록은 async transcript 기준으로 생성

- 실시간 자막은 사용자 경험용입니다.
- 회의 종료 후 **최종본은 async transcript**를 받아서 생성합니다.
- 이 transcript를 OpenAI/Gemini에 넣어 요약, 결정사항, 액션 아이템, 제목, 메일 본문, 첨부 문서를 만듭니다.

이 구조가 좋은 이유는 단순합니다.
**화면이 꺼져도 녹음이 살아남고**, **네트워크가 흔들려도 원본이 남고**, **최종 문서는 더 안정적인 비동기 STT 기준으로 뽑히기 때문**입니다.

---

## 6) 내가 실제로 만들 앱 구조

### 제품 표면은 2개로 나눕니다

1. **모바일 앱**
   - 회의/연설 시작
   - 실시간 자막 보기
   - 잠금 화면에서도 녹음 유지
   - 종료 후 “업로드 중 / 회의록 생성 중 / 메일 발송 완료” 상태 표시

2. **웹 포털 (`app.yourdomain.com`)**
   - 지난 세션 검색
   - transcript / summary / action items 검토
   - 메일 재전송
   - DOCX/PDF 다운로드
   - 조직/프로젝트별 관리

### 백엔드(`api.yourdomain.com`)는 Mac mini에 둡니다

당신 환경 기준으로는 Mac mini + OrbStack + Portainer에 이 정도 구성이 가장 자연스럽습니다.

- `reverse-proxy` : TLS, 도메인 라우팅
- `api` : 인증, 세션, Soniox temp key 발급, 업로드 URL 발급
- `worker-transcribe` : Soniox async job 생성 / 웹훅 처리
- `worker-summarize` : OpenAI 또는 Gemini 호출
- `worker-mail` : 메일 발송
- `postgres` : 세션/메타데이터/검색 인덱스
- `minio` : 오디오, transcript 원본 JSON, 산출물 보관
- `redis` : 큐
- `web` : 리뷰 포털

Soniox 웹훅 URL은 **Soniox 서버에서 도달 가능한 공개 주소**여야 합니다. 홈 맥미니에 둘 거면, 퍼블릭 리버스 프록시나 터널 구성이 필요합니다. Soniox 문서도 개발용으로 Cloudflare tunnel 같은 방법을 예시로 듭니다. ([Soniox | Speech-to-Text AI][20])

### Soniox 키 관리

모바일/브라우저에는 영구 키를 넣지 않습니다.
서버가 **temporary API key endpoint**를 제공하고, 앱은 거기서 짧은 수명의 키를 받아 WebSocket을 엽니다. ([Soniox | Speech-to-Text AI][8])

### Soniox 데이터 정리 정책

비동기 경로를 쓰면 Soniox의 uploaded files와 transcriptions가 쌓입니다. 공식 문서 기준으로 async API는 기본 10GB / 1000 files / 300분 파일 길이 / 2000 transcriptions 제한이 있고, **파일은 자동 삭제되지 않습니다.** 완료 후 받아 왔으면 즉시 삭제하는 잡을 넣어야 합니다. 삭제 API도 별도로 있습니다. ([Soniox | Speech-to-Text AI][21])

### 데이터 프라이버시 쪽 포인트

Soniox는 data residency를 프로젝트 단위로 제공하고, 선택한 region 안에 audio/transcripts를 두는 구조를 문서화합니다. 또한 API에 보낸 content는 모델 학습에 쓰지 않는다고 명시합니다. 민감 회의가 많으면 region을 먼저 정하고 계약 조건을 보는 게 좋습니다. ([Soniox | Speech-to-Text AI][22])

---

## 7) 메인 기능 외에 Soniox를 써서 추가할 만한 기능 4개

당신이 “2~3개 더 넣고 싶다”고 했으니, 저는 아래 4개 중 3개를 고르겠습니다.

### 1. 실시간 양방향 통역 / 이중 자막

회의 중 한국어 발화를 영어로, 영어 발화를 한국어로 바로 보여 주는 기능입니다. Soniox는 one-way와 two-way real-time translation을 공식 문서로 제공합니다. 국제 미팅에서 체감 가치가 큽니다. ([Soniox | Speech-to-Text AI][3])

### 2. 혼용 언어 자동 처리 + 회사 용어 사전

한·영이 섞이는 회의에서 language identification을 켜고, Soniox `context`에 제품명/회사명/프로젝트명/벤더명을 넣습니다. “오타 없는 전문 회의록” 쪽으로 가려면 이 기능이 중요합니다. ([Soniox | Speech-to-Text AI][4])

### 3. 화자별 회의록 + 발언 시간 분석

speaker diarization과 timestamps가 있으니, 단순 transcript가 아니라

- 화자별 발언 모음
- 발언 시간 합계
- 누가 어떤 액션 아이템을 받았는지
- 특정 화자만 다시 보기
  같은 파생 기능이 가능합니다. ([Soniox | Speech-to-Text AI][5])

### 4. 낮은 confidence 단어 하이라이트

Soniox는 token confidence를 기본 포함합니다. 그래서 “잘 안 들린 단어”, “고유명사 의심 구간”, “배경 소음으로 오염된 부분”을 표시해 두고, 사용자가 나중에 빠르게 검토하게 만들 수 있습니다. 회의록 신뢰도 관리에 좋습니다. ([Soniox | Speech-to-Text AI][23])

추가로, Soniox의 **endpoint detection**은 발화가 끝났다는 신호(`<end>`)를 줄 수 있으니, 회의 중간중간 **“방금 발화 단락만 임시 요약”** 같은 기능도 가능합니다. ([Soniox | Speech-to-Text AI][24])

---

## 8) 내가 잡는 실제 기능 명세

### 모드 3개

같은 STT 엔진을 써도 회의, 연설, 인터뷰는 산출물이 달라야 합니다.

#### 회의 모드

- 제목
- 한 문단 요약
- 의사결정 목록
- 액션 아이템(담당자/기한/근거 발언)
- 논점/쟁점
- 다음 회의 안건
- 화자별 요약
- 풀스크립트

#### 연설/강연 모드

- 발표 제목
- 핵심 메시지 3~7개
- 인용 가능한 문장
- 섹션별 요약
- 청중 Q&A 분리
- 풀스크립트

#### 인터뷰 모드

- 질문-답변 구조화
- 핵심 인사이트
- follow-up question 후보
- 민감 발언 표시
- 풀스크립트

### 산출물 형식

서버는 결과를 최소 4개로 만듭니다.

- `raw_transcript.json` : Soniox 원본 구조
- `clean_transcript.md` : 화자/시간 정리된 풀스크립트
- `meeting_notes.json` : LLM structured output
- `meeting_notes.html` 또는 `meeting_notes.docx` : 메일 첨부용

### 메일 발송

메일 본문은 너무 길게 하지 않습니다.

- 제목: `[회의록] 프로젝트명 / 날짜 / 회의명`
- 본문 상단: 5줄 요약
- 본문 중간: 액션 아이템 표
- 하단: 웹 포털 링크 + 풀스크립트 첨부

발송은 폰이 아니라 서버에서 합니다.
도메인 메일로 보낼 거면 SPF/DKIM/DMARC를 먼저 맞춰 놓는 게 전달률에 중요합니다.

---

## 9) Codex 하네스 엔지니어링은 이렇게 짜는 게 맞다

이건 “코딩 도우미” 수준으로 쓰면 안 됩니다.
**개발 조직 운영체제**처럼 써야 합니다.

OpenAI 공식 문서는 Codex best practice로 `AGENTS.md`, skills, subagents, worktrees, 테스트/리뷰 루프를 강조합니다. `AGENTS.md`는 글로벌/레포/하위 디렉터리 단위로 계층화할 수 있고, skills는 `$HOME/.agents/skills` 또는 레포 내부 `.agents/skills`에 둘 수 있습니다. Agents SDK 가이드는 Codex CLI를 MCP 서버로 띄워 **multi-agent workflow**, **handoffs**, **guardrails**, **traces**를 갖춘 파이프라인을 만들 수 있다고 설명합니다. OpenAI의 harness engineering 글도 “Humans steer. Agents execute.”라는 문장 그대로, 사람은 방향을 잡고 에이전트가 구현·테스트·문서화까지 담당하는 모델을 제시합니다. ([OpenAI 개발자][25])

### 내가 권하는 에이전트 분업

#### 1. Product Spec Agent

- PRD 작성
- 유저 시나리오/수용 기준 정의
- 회의/연설/인터뷰 모드 요구사항 분리
- “done when” 문구 정의

#### 2. Mobile Recorder Agent

- React Native 화면
- 세션 시작/종료 UX
- 권한 요청
- 상태 머신
- 백그라운드 전환 처리

#### 3. Native Audio Agent

- iOS background audio
- Android foreground microphone service
- PCM 스트리밍 브리지
- chunking / file rotation
- call interruption / Bluetooth input 처리

#### 4. Soniox Integration Agent

- temp key endpoint
- realtime WebSocket client
- async transcription job 생성
- webhook receiver
- transcript normalization

#### 5. LLM Notes Agent

- OpenAI/Gemini prompt 설계
- JSON schema 설계
- hallucination 방지 규칙
- 회의/연설/인터뷰별 템플릿 관리

#### 6. Backend Platform Agent

- API
- queue
- storage
- document rendering
- email dispatch
- retry / idempotency

#### 7. Infra / SRE Agent

- Mac mini 배포
- OrbStack / Portainer stack
- reverse proxy
- TLS
- backup
- observability
- alerting

#### 8. QA / Eval Agent

- golden audio set 유지
- CER/WER/요약 품질/메일 성공률 측정
- 디바이스 테스트 스크립트
- 회귀 테스트 자동화

#### 9. Security / Privacy Agent

- 키 보관
- Soniox 파일 정리
- retention 정책
- PII redaction 옵션
- 접근 통제 검토

#### 10. Red Team Reviewer Agent

- 구현안 깨보기
- 잘못된 요약 사례 수집
- background 실패 케이스 찾기
- 메일 중복 발송, 업로드 누락, 재시도 폭주 검토

### “서로 견제”는 이렇게 걸어야 한다

- 구현 에이전트 1명으로 끝내지 말고, **리뷰 에이전트 + 평가 에이전트**를 따로 둡니다.
- 배경 녹음 코드가 바뀌면 **iOS 실기기 로그 + Android 실기기 로그**가 없으면 머지 금지.
- 요약 프롬프트가 바뀌면 golden set 20개 이상에 대해 **이전 버전 대비 차이 리포트** 없으면 머지 금지.
- 메일 템플릿이 바뀌면 스냅샷 테스트 + 실제 SMTP sandbox 테스트 없으면 머지 금지.
- Soniox async 처리 변경 시 webhook 재전송/중복 수신/idempotency 테스트 없으면 머지 금지.

---

## 10) 레포 구조는 이렇게 잡는 게 좋다

```text
repo/
  AGENTS.md
  .agents/
    skills/
      mobile-background-audio/
        SKILL.md
      soniox-realtime/
        SKILL.md
      soniox-async-webhooks/
        SKILL.md
      meeting-summary-schema/
        SKILL.md
      artifact-email/
        SKILL.md
      privacy-retention/
        SKILL.md
      release-smoke/
        SKILL.md

  apps/
    mobile/
      AGENTS.md
    web/
      AGENTS.md

  services/
    api/
      AGENTS.md
    worker-transcribe/
      AGENTS.md
    worker-summarize/
      AGENTS.md
    worker-mail/
      AGENTS.md

  packages/
    audio-core/
    soniox-client/
    transcript-normalizer/
    notes-schema/
    ui-kit/

  infra/
    AGENTS.md
    docker/
    portainer/
    reverse-proxy/
    backups/

  evals/
    audio-golden-set/
    summary-golden-set/
    device-matrix/
```

### 루트 `AGENTS.md`에는 꼭 들어가야 할 것

- 영구 API 키를 클라이언트에 넣지 말 것
- 로컬 원본 오디오는 서버 업로드/검증 전 삭제 금지
- background audio 관련 변경은 실기기 증거 필수
- Soniox async 파일/전사는 완료 후 삭제 잡 필수
- 모든 feature PR은 테스트 + 관찰 로그 + 롤백 계획 포함
- 요약 모델은 자유 텍스트가 아니라 JSON schema 출력 우선
- 동일 파일 동시 작업은 worktree로 분리

OpenAI 문서는 `AGENTS.md`를 짧고 정확하게 유지하고, 반복 실수가 나오면 업데이트하라고 권합니다. skills는 재사용 워크플로를 패키징하는 형식입니다. ([OpenAI 개발자][25])

---

## 11) 품질을 잡으려면 평가 하네스를 먼저 깔아야 한다

### 오디오 golden set

최소 이 8개는 필요합니다.

- 조용한 회의실 2인 회의
- 4인 회의
- 강의/연설 단일 화자 60분
- 카페 소음 환경
- 한국어-영어 혼용 회의
- 블루투스 이어폰 마이크 입력
- 화면 잠금 90분 연속 녹음
- 네트워크 끊김/복귀 상황

### 측정 지표

- STT: CER/WER, speaker attribution accuracy, low-confidence token 비율
- 제품: background survival rate, dropped-audio rate, upload success rate, time-to-final-email
- 요약: decision recall, action-item precision, owner extraction accuracy, hallucination rate
- 운영: Soniox job retry rate, webhook duplication handling, 메일 bounce rate

한국어는 띄어쓰기 영향이 커서 WER만 보지 말고 **CER도 같이 보는 것**이 낫습니다. 이건 모델 선택보다 실사용 정확도 판단에 중요합니다.

---

## 12) 현실적인 개발 순서

### V1

- 모바일 앱에서 로컬 녹음
- 세션 종료 후 파일 업로드
- Soniox async transcript
- OpenAI 요약
- 메일 발송
- 웹 포털에서 검색/다운로드

여기까지면 이미 제품 가치가 있습니다.

### V1.5

- 앱 foreground에서 실시간 자막
- rolling chunk 업로드
- 회의 중간 임시 요약
- speaker color labeling
- confidence highlight

### V2

- 양방향 번역 자막
- 팀 워크스페이스
- 프로젝트별 용어 사전
- CRM / 캘린더 / task 연동
- 회의 유형 자동 분류
- 발화자별 analytics

---

## 13) 내가 지금 이 프로젝트에 내리는 최종 판단

**기술 스택**

- **모바일**: React Native + Expo prebuild/bare
- **웹 포털**: 당신 도메인 하위 웹 서비스
- **STT**: Soniox
- **요약/회의록**: OpenAI 우선
- **저장**: Mac mini + OrbStack + Portainer + Postgres + MinIO + Redis
- **메일**: 서버 발송

**버려야 할 선택**

- 순수 웹을 주력 레코더로 쓰는 것
- 모바일 v1을 Tauri-first로 가는 것
- Soniox 실시간 WebSocket만 믿고 원본 파일 없이 가는 것
- Soniox + OpenAI + Gemini를 동시에 v1에 다 넣는 것

**꼭 넣을 추가 기능 3개**

- 실시간 양방향 번역 자막
- 혼용 언어 + 회사 용어 보정
- 화자별 구조화 회의록 + confidence 검토

첫 번째 의사결정은 하나입니다.
**v1에서 “실시간으로 멋져 보이는 자막”보다 “화면이 꺼져도 안 끊기는 녹음”을 더 우선할지**입니다. 저는 무조건 후자를 택하겠습니다. 그 선택이 맞아야 나중에 요약, 메일, 검색, 공유가 전부 쌓입니다.

[1]: https://soniox.com/docs/stt/api-reference/websocket-api "https://soniox.com/docs/stt/api-reference/websocket-api"
[2]: https://soniox.com/docs/stt/async/async-transcription "https://soniox.com/docs/stt/async/async-transcription"
[3]: https://soniox.com/docs/stt/rt/real-time-translation "https://soniox.com/docs/stt/rt/real-time-translation"
[4]: https://soniox.com/docs/stt/concepts/language-identification "https://soniox.com/docs/stt/concepts/language-identification"
[5]: https://soniox.com/docs/stt/concepts/speaker-diarization "https://soniox.com/docs/stt/concepts/speaker-diarization"
[6]: https://soniox.com/docs/stt/concepts/context "https://soniox.com/docs/stt/concepts/context"
[7]: https://soniox.com/docs/stt/SDKs/node-SDK/reference/types "https://soniox.com/docs/stt/SDKs/node-SDK/reference/types"
[8]: https://soniox.com/docs/stt/SDKs/react-native-SDK "https://soniox.com/docs/stt/SDKs/react-native-SDK"
[9]: https://soniox.com/soniox-app "https://soniox.com/soniox-app"
[10]: https://developers.openai.com/api/docs/guides/code-generation?gallery=open&galleryItem=employee-skills-matrix-5.2 "https://developers.openai.com/api/docs/guides/code-generation?gallery=open&galleryItem=employee-skills-matrix-5.2"
[11]: https://platform.openai.com/docs/api-reference/chat?_clear=true&lang=node.js&utm_source=chatgpt.com "https://platform.openai.com/docs/api-reference/chat?_clear=true&lang=node.js&utm_source=chatgpt.com"
[12]: https://platform.openai.com/docs/models/compare?model=gpt-5.1-codex "https://platform.openai.com/docs/models/compare?model=gpt-5.1-codex"
[13]: https://openai.com/api/pricing/ "https://openai.com/api/pricing/"
[14]: https://ai.google.dev/gemini-api/docs/long-context "https://ai.google.dev/gemini-api/docs/long-context"
[15]: https://soniox.com/docs/stt/guides/direct-stream "https://soniox.com/docs/stt/guides/direct-stream"
[16]: https://v2.tauri.app/develop/plugins/develop-mobile/ "https://v2.tauri.app/develop/plugins/develop-mobile/"
[17]: https://docs.expo.dev/versions/latest/sdk/audio/ "https://docs.expo.dev/versions/latest/sdk/audio/"
[18]: https://developer.apple.com/documentation/foundation/urlsession "https://developer.apple.com/documentation/foundation/urlsession"
[19]: https://developer.android.com/develop/background-work/services/fgs/service-types "https://developer.android.com/develop/background-work/services/fgs/service-types"
[20]: https://soniox.com/docs/stt/async/webhooks "https://soniox.com/docs/stt/async/webhooks"
[21]: https://soniox.com/docs/stt/async/limits-and-quotas "https://soniox.com/docs/stt/async/limits-and-quotas"
[22]: https://soniox.com/docs/stt/data-residency "https://soniox.com/docs/stt/data-residency"
[23]: https://soniox.com/docs/stt/concepts/confidence-scores "https://soniox.com/docs/stt/concepts/confidence-scores"
[24]: https://soniox.com/docs/stt/rt/endpoint-detection "https://soniox.com/docs/stt/rt/endpoint-detection"
[25]: https://developers.openai.com/codex/learn/best-practices "https://developers.openai.com/codex/learn/best-practices"
