import { describe, expect, test } from "vitest";

import { createSessionRecord } from "@mystt/audio-core";

import {
  describePortalStorageState,
  hasPortalSourceAudio,
  hasReadyPortalArtifact,
  isRemotePersistenceReady
} from "./session-assets";

describe("hasPortalSourceAudio", () => {
  test("treats a sanitized filename label as downloadable source audio", () => {
    const session = createSessionRecord({
      id: "sess_1",
      title: "Demo",
      mode: "meeting",
      localAudioPath: "source-audio.m4a"
    });

    expect(hasPortalSourceAudio(session)).toBe(true);
  });

  test("treats an empty source audio label as unavailable", () => {
    const session = createSessionRecord({
      id: "sess_2",
      title: "Demo",
      mode: "meeting",
      localAudioPath: ""
    });

    expect(hasPortalSourceAudio(session)).toBe(false);
  });
});

describe("hasReadyPortalArtifact", () => {
  test("relies on artifact readiness instead of internal storage locations", () => {
    const session = {
      ...createSessionRecord({
        id: "sess_3",
        title: "Demo",
        mode: "meeting"
      }),
      artifacts: [
        {
          kind: "meeting_notes_docx" as const,
          status: "ready" as const
        }
      ]
    };

    expect(hasReadyPortalArtifact(session, "meeting_notes_docx")).toBe(true);
  });
});

describe("isRemotePersistenceReady", () => {
  test("returns true only when Postgres and MinIO are both remote", () => {
    expect(
      isRemotePersistenceReady({
        persistence: {
          postgres: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          },
          minio: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          }
        }
      })
    ).toBe(true);
    expect(
      isRemotePersistenceReady({
        persistence: {
          postgres: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          },
          minio: {
            configured: true,
            mode: "local-fallback",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          }
        }
      })
    ).toBe(false);
  });
});

describe("describePortalStorageState", () => {
  test("uses the same fallback semantics as the desktop shell", () => {
    expect(
      describePortalStorageState({
        persistence: {
          postgres: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          },
          minio: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          }
        }
      })
    ).toEqual({
      ready: true,
      label: "서버 persistence 연결됨"
    });

    expect(
      describePortalStorageState({
        persistence: {
          postgres: {
            configured: true,
            mode: "remote",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          },
          minio: {
            configured: true,
            mode: "local-fallback",
            lastLoadOk: true,
            lastWriteOk: true,
            lastReadOk: true
          }
        }
      })
    ).toEqual({
      ready: false,
      label: "로컬 fallback 저장 중"
    });
  });
});
