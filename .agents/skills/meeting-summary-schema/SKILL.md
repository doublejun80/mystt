# meeting-summary-schema

회의록 스키마와 프롬프트를 조정할 때 사용하는 스킬입니다.

## Focus

- mode-aware schema
- JSON 우선
- 근거 기반 action item 추출
- hallucination 억제

## Checklist

1. 회의/연설/인터뷰 스키마를 분리한다.
2. `summary`, `decisions`, `action_items`, `risks`, `open_questions` 같은 필수 필드를 명시한다.
3. due date와 owner는 transcript 근거가 약하면 `null` 허용으로 둔다.
4. 변경 후 golden set diff 관찰 포인트를 추가한다.

