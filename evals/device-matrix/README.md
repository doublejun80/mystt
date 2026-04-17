# Device Matrix

릴리즈 전 최소 검증 매트릭스입니다.

## iOS

- iPhone 14 / iOS 18 / local speaker / screen locked 30m
- iPhone 15 Pro / iOS 18 / Bluetooth mic / incoming call interruption
- iPhone 15 Pro / iOS 18 / native recorder / screen locked 120m / local save survives

## Android

- Pixel 8 / Android 15 / foreground service 유지
- Galaxy S24 / Android 15 / battery optimization enabled
- Galaxy S24 / Android 15 / Bluetooth mic / screen off 120m / local save survives

## Desktop

- macOS Sonoma / Tauri shell / local portal 3203 / 120m foreground recording
- Windows 11 / Tauri shell / hosted domain / 120m foreground recording

## Required Evidence

- 세션 시작/종료 로그
- chunk flush 타임라인
- 업로드 큐 길이
- webhook 완료 후 artifact 상태
- 모바일 로컬 `.m4a` 경로와 `session.json` sidecar
- 데스크톱 셸에서 열린 target URL
