import { describe, expect, test } from "vitest";

import { createSessionRecord } from "@mystt/audio-core";

import {
  buildPortalAuditEvent,
  buildPortalSessionRecord,
  buildPortalSessionSnapshot
} from "./session-presenters";

describe("buildPortalSessionRecord", () => {
  test("replaces internal source audio paths with a safe filename label and strips artifact locations", () => {
    const session = {
      ...createSessionRecord({
        id: "sess_1",
        title: "Demo",
        mode: "meeting",
        localAudioPath: "minio://audio/sessions/sess_1/source-audio.m4a"
      }),
      artifacts: [
        {
          kind: "meeting_notes_docx" as const,
          status: "ready" as const,
          location: "minio://artifacts/sessions/sess_1/meeting_notes.docx"
        }
      ]
    };

    const result = buildPortalSessionRecord(session);

    expect(result.localAudioPath).toBe("source-audio.m4a");
    expect(result.artifacts[0]?.location).toBeUndefined();
  });
});

describe("buildPortalSessionSnapshot", () => {
  test("presents sessions with completed notes as completed even if stored status is stale", () => {
    const snapshot = {
      session: {
        ...createSessionRecord({
          id: "sess_notes_ready",
          title: "Notes Ready",
          mode: "meeting",
          localAudioPath: "minio://audio/sessions/sess_notes_ready/source-audio.mp3"
        }),
        status: "recording" as const
      },
      notes: {
        model: "gpt-5.4-mini",
        createdAt: "2026-05-10T00:00:00.000Z",
        notes: {
          mode: "meeting" as const,
          title: "Notes Ready",
          summary: "정리 완료",
          decisions: [],
          actionItems: [],
          risks: [],
          openQuestions: [],
          nextAgenda: [],
          speakerHighlights: []
        }
      }
    };

    const result = buildPortalSessionSnapshot(snapshot);

    expect(result.session.status).toBe("completed");
  });

  test("presents abandoned post-upload recordings as failed after the queue grace window", () => {
    const snapshot = {
      session: {
        ...createSessionRecord({
          id: "sess_abandoned",
          title: "Abandoned",
          mode: "meeting",
          startedAt: "2026-05-10T00:00:00.000Z"
        }),
        status: "recording" as const,
        localAudioPath: ""
      }
    };

    const result = buildPortalSessionSnapshot(snapshot, {
      now: new Date("2026-05-10T00:05:01.000Z")
    });

    expect(result.session.status).toBe("failed");
  });

  test("presents long-stale processing sessions as failed while preserving source audio", () => {
    const snapshot = {
      session: {
        ...createSessionRecord({
          id: "sess_stale_transcribing",
          title: "Long Stale",
          mode: "meeting",
          startedAt: "2026-05-10T00:00:00.000Z",
          localAudioPath:
            "minio://audio/sessions/sess_stale_transcribing/source-audio.mp3"
        }),
        status: "transcribing" as const
      }
    };

    const result = buildPortalSessionSnapshot(snapshot, {
      now: new Date("2026-05-10T00:45:01.000Z")
    });

    expect(result.session.status).toBe("failed");
    expect(result.session.localAudioPath).toBe("source-audio.mp3");
  });

  test("keeps recent processing sessions active", () => {
    const snapshot = {
      session: {
        ...createSessionRecord({
          id: "sess_recent_transcribing",
          title: "Recent",
          mode: "meeting",
          startedAt: "2026-05-10T00:00:00.000Z",
          localAudioPath:
            "minio://audio/sessions/sess_recent_transcribing/source-audio.mp3"
        }),
        status: "transcribing" as const
      }
    };

    const result = buildPortalSessionSnapshot(snapshot, {
      now: new Date("2026-05-10T00:44:59.000Z")
    });

    expect(result.session.status).toBe("transcribing");
  });
});

describe("buildPortalAuditEvent", () => {
  test("removes internal storage path fields while preserving user-facing metadata", () => {
    const result = buildPortalAuditEvent({
      eventId: "evt_1",
      sessionId: "sess_1",
      kind: "source_audio.staged",
      createdAt: "2026-04-18T00:00:00.000Z",
      payload: {
        location: "minio://audio/sessions/sess_1/source-audio.m4a",
        rawTranscriptPath: "minio://artifacts/sessions/sess_1/raw_transcript.json",
        fileName: "source-audio.m4a",
        byteLength: 123
      }
    });

    expect(result.payload).toEqual({
      fileName: "source-audio.m4a",
      byteLength: 123
    });
  });

  test("removes provider resource identifiers from public audit payloads", () => {
    const result = buildPortalAuditEvent({
      eventId: "evt_2",
      sessionId: "sess_1",
      kind: "source_audio.soniox_uploaded",
      createdAt: "2026-04-18T00:00:00.000Z",
      payload: {
        fileId: "file_secret",
        transcriptionId: "tr_secret",
        jobId: "job_secret",
        sha256: "deadbeef",
        byteLength: 123,
        reusedExistingSourceAudio: true
      }
    });

    expect(result.payload).toEqual({
      sha256: "deadbeef",
      byteLength: 123,
      reusedExistingSourceAudio: true
    });
  });
});
