import Foundation

// TODO: Tauri 2 iOS plugin entrypoint.
// This scaffold intentionally mirrors the recorder ledger contract used by the desktop shell.
//
// Required responsibilities:
// - start / pause / resume / stop native recording
// - persist runtime-state.json before background transitions
// - persist sessions.json and recordings/<session-id>/session.json on save
// - keep original audio until upload + hash verification completes
//
// The shared JSON contract lives in:
// /Volumes/mac_dock/github/mystt/packages/audio-core/src/tauri-recorder.ts

final class MysttRecorderPluginScaffold {
  func startRecording() {
    // TODO: wire AVAudioRecorder / AVAudioEngine background recorder.
  }

  func pauseRecording() {
    // TODO
  }

  func resumeRecording() {
    // TODO
  }

  func stopRecording() {
    // TODO
  }
}
