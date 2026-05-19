package digital.doublejun.mystt.recorder

// TODO: Tauri 2 Android plugin entrypoint.
// This scaffold intentionally mirrors the recorder ledger contract used by the desktop shell.
//
// Required responsibilities:
// - foreground service microphone capture
// - runtime-state.json flush on background/service lifecycle changes
// - sessions.json + recordings/<session-id>/session.json persistence on save
// - original audio retention until upload + hash verification completes
//
// Shared JSON contract:
// packages/audio-core/src/tauri-recorder.ts

class MysttRecorderPluginScaffold {
  fun startRecording() {
    // TODO
  }

  fun pauseRecording() {
    // TODO
  }

  fun resumeRecording() {
    // TODO
  }

  fun stopRecording() {
    // TODO
  }
}
