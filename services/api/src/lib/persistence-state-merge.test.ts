import { describe, expect, it } from "vitest";

import { createSessionRecord, type SessionRecord } from "@mystt/audio-core";

import {
  mergeLocalOnlyPersistedApiState,
  type PersistedApiState
} from "./persistence";

function buildSession(input: {
  id: string;
  title: string;
  startedAt: string;
}): SessionRecord {
  return {
    ...createSessionRecord({
      id: input.id,
      title: input.title,
      mode: "meeting",
      startedAt: input.startedAt,
      languageHints: ["ko"],
      localAudioPath: `${input.id}.m4a`
    }),
    status: "completed",
    endedAt: input.startedAt
  };
}

function buildState(
  overrides: Partial<PersistedApiState> = {}
): PersistedApiState {
  return {
    sessions: [],
    webhookFingerprints: [],
    sessionByTranscriptionId: {},
    transcriptionBySessionId: {},
    sourceAudioUploadsBySessionId: {},
    normalizedTranscripts: {},
    rawTranscriptText: {},
    notesBySessionId: {},
    providerChecks: {},
    auditEvents: [],
    ...overrides
  };
}

describe("mergeLocalOnlyPersistedApiState", () => {
  it("preserves local-only fallback sessions when Postgres has older state", () => {
    const remoteSession = buildSession({
      id: "remote-session",
      title: "Remote session",
      startedAt: "2026-05-18T00:00:00.000Z"
    });
    const localOnlySession = buildSession({
      id: "local-only-session",
      title: "Recovered local session",
      startedAt: "2026-05-19T00:00:00.000Z"
    });
    const remote = buildState({
      sessions: [remoteSession],
      rawTranscriptText: {
        "remote-session": "remote transcript"
      }
    });
    const local = buildState({
      sessions: [remoteSession, localOnlySession],
      sessionByTranscriptionId: {
        local_transcription: "local-only-session"
      },
      transcriptionBySessionId: {
        "local-only-session": {
          transcriptionId: "local_transcription",
          status: "completed",
          createdAt: "2026-05-19T00:01:00.000Z"
        }
      },
      sourceAudioUploadsBySessionId: {
        "local-only-session": [
          {
            sessionId: "local-only-session",
            sha256: "abc",
            byteLength: 123,
            sourceLocation: "/tmp/local-only.m4a",
            sonioxFileId: "file-id",
            sonioxFileName: "local-only.m4a",
            uploadedAt: "2026-05-19T00:02:00.000Z",
            contentType: "audio/mp4",
            sourceFileName: "local-only.m4a"
          }
        ]
      },
      rawTranscriptText: {
        "local-only-session": "local transcript"
      },
      auditEvents: [
        {
          eventId: "local-event",
          sessionId: "local-only-session",
          kind: "session.completed",
          payload: {},
          createdAt: "2026-05-19T00:03:00.000Z"
        }
      ]
    });

    const merged = mergeLocalOnlyPersistedApiState(remote, local);

    expect(merged.localOnlySessionIds).toEqual(["local-only-session"]);
    expect(merged.state.sessions.map((session) => session.id)).toEqual([
      "local-only-session",
      "remote-session"
    ]);
    expect(merged.state.transcriptionBySessionId["local-only-session"]).toEqual(
      local.transcriptionBySessionId["local-only-session"]
    );
    expect(merged.state.sourceAudioUploadsBySessionId["local-only-session"]).toEqual(
      local.sourceAudioUploadsBySessionId["local-only-session"]
    );
    expect(merged.state.rawTranscriptText["remote-session"]).toBe("remote transcript");
    expect(merged.state.rawTranscriptText["local-only-session"]).toBe("local transcript");
    expect(merged.state.auditEvents.map((event) => event.eventId)).toEqual([
      "local-event"
    ]);
  });

  it("does not overwrite remote session data with stale local copies", () => {
    const remoteSession = buildSession({
      id: "same-session",
      title: "Remote title",
      startedAt: "2026-05-19T00:00:00.000Z"
    });
    const staleLocalSession = {
      ...remoteSession,
      title: "Stale local title"
    };

    const merged = mergeLocalOnlyPersistedApiState(
      buildState({
        sessions: [remoteSession],
        rawTranscriptText: {
          "same-session": "remote transcript"
        }
      }),
      buildState({
        sessions: [staleLocalSession],
        rawTranscriptText: {
          "same-session": "stale transcript"
        }
      })
    );

    expect(merged.localOnlySessionIds).toEqual([]);
    expect(merged.state.sessions).toEqual([remoteSession]);
    expect(merged.state.rawTranscriptText["same-session"]).toBe("remote transcript");
  });

  it("drops local audit events that reference sessions missing from merged state", () => {
    const remoteSession = buildSession({
      id: "remote-session",
      title: "Remote session",
      startedAt: "2026-05-19T00:00:00.000Z"
    });

    const merged = mergeLocalOnlyPersistedApiState(
      buildState({
        sessions: [remoteSession]
      }),
      buildState({
        sessions: [remoteSession],
        auditEvents: [
          {
            eventId: "kept-event",
            sessionId: "remote-session",
            kind: "session.completed",
            payload: {},
            createdAt: "2026-05-19T00:03:00.000Z"
          },
          {
            eventId: "orphan-event",
            sessionId: "deleted-session",
            kind: "session.deleted",
            payload: {},
            createdAt: "2026-05-19T00:04:00.000Z"
          }
        ]
      })
    );

    expect(merged.state.auditEvents.map((event) => event.eventId)).toEqual([
      "kept-event"
    ]);
  });
});
