import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSonioxContext,
  cleanupAsyncTranscriptionResources,
  getAsyncTranscription,
  resolveSonioxWebhookUrl
} from "./soniox";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveSonioxWebhookUrl", () => {
  it("skips the default local api domain for dev harness runs", () => {
    expect(
      resolveSonioxWebhookUrl({
        API_PORT: 4000,
        APP_DOMAIN: "app.localhost",
        API_DOMAIN: "api.localhost",
        POSTGRES_URL: undefined,
        MINIO_ENDPOINT: undefined,
        MINIO_ACCESS_KEY: undefined,
        MINIO_SECRET_KEY: undefined,
        MINIO_BUCKET_AUDIO: "audio",
        MINIO_BUCKET_ARTIFACTS: "artifacts",
        MINIO_REGION: "us-east-1",
        SONIOX_API_KEY: "test",
        SONIOX_WEBHOOK_URL: undefined,
        SONIOX_WEBHOOK_SECRET: undefined,
        SONIOX_RT_MODEL: "stt-rt-v4",
        SONIOX_ASYNC_MODEL: "stt-async-v4",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "gpt-5.4-mini",
        OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
        MYSTT_OWNER_EMAIL: undefined,
        MYSTT_OWNER_PASSWORD: undefined,
        MYSTT_AUTH_SECRET: undefined,
        MYSTT_SESSION_TTL_SECONDS: 60 * 60 * 12,
        MYSTT_QA_TOKEN: undefined,
        MYSTT_ALLOW_UNAUTHENTICATED_DEV: false,
        MYSTT_REQUIRE_REMOTE_BACKENDS: false,
        MAIL_DELIVERY_MODE: "auto",
        MAIL_FROM: "notes@mystt.local",
        MAIL_HOST: "127.0.0.1",
        MAIL_PORT: 11025,
        MAIL_SECURE: false,
        MAIL_USER: undefined,
        MAIL_PASSWORD: undefined
      })
    ).toBeUndefined();
  });

  it("uses an explicit webhook url when provided", () => {
    expect(
      resolveSonioxWebhookUrl({
        API_PORT: 4000,
        APP_DOMAIN: "app.localhost",
        API_DOMAIN: "api.localhost",
        POSTGRES_URL: undefined,
        MINIO_ENDPOINT: undefined,
        MINIO_ACCESS_KEY: undefined,
        MINIO_SECRET_KEY: undefined,
        MINIO_BUCKET_AUDIO: "audio",
        MINIO_BUCKET_ARTIFACTS: "artifacts",
        MINIO_REGION: "us-east-1",
        SONIOX_API_KEY: "test",
        SONIOX_WEBHOOK_URL: "https://api.example.com/v1/webhooks/soniox",
        SONIOX_WEBHOOK_SECRET: undefined,
        SONIOX_RT_MODEL: "stt-rt-v4",
        SONIOX_ASYNC_MODEL: "stt-async-v4",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "gpt-5.4-mini",
        OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
        MYSTT_OWNER_EMAIL: undefined,
        MYSTT_OWNER_PASSWORD: undefined,
        MYSTT_AUTH_SECRET: undefined,
        MYSTT_SESSION_TTL_SECONDS: 60 * 60 * 12,
        MYSTT_QA_TOKEN: undefined,
        MYSTT_ALLOW_UNAUTHENTICATED_DEV: false,
        MYSTT_REQUIRE_REMOTE_BACKENDS: false,
        MAIL_DELIVERY_MODE: "auto",
        MAIL_FROM: "notes@mystt.local",
        MAIL_HOST: "127.0.0.1",
        MAIL_PORT: 11025,
        MAIL_SECURE: false,
        MAIL_USER: undefined,
        MAIL_PASSWORD: undefined
      })
    ).toBe("https://api.example.com/v1/webhooks/soniox");
  });
});

describe("buildSonioxContext", () => {
  it("builds rich bounded Soniox context for the meeting ledger", () => {
    const context = buildSonioxContext({
      sessionId: "sess_1",
      mode: "meeting",
      title: "구매 검토 회의",
      project: "procurement",
      templateTypeCandidates: ["general_meeting", "purchase_review"],
      expectedLanguages: ["ko", "en"],
      expectedSpeakerCount: 3,
      knownTerms: ["SOC2", "연간 계약"],
      participantNames: ["Mina", "Alex"],
      meetingPurpose: "예산과 도입 일정을 중심으로 구매 타당성을 검토한다.",
      additionalContext: ["보안팀 검토가 주요 선행 조건입니다."]
    });

    expect(context.general).toContainEqual({ key: "session_id", value: "sess_1" });
    expect(context.general).toContainEqual({ key: "mode", value: "meeting" });
    expect(context.general).toContainEqual({ key: "title", value: "구매 검토 회의" });
    expect(context.general).toContainEqual({ key: "project", value: "procurement" });
    expect(context.general).toContainEqual({
      key: "template_type_candidates",
      value: "general_meeting, purchase_review"
    });
    expect(context.general).toContainEqual({ key: "expected_languages", value: "ko, en" });
    expect(context.general).toContainEqual({ key: "expected_speaker_count", value: "3" });
    expect(context.text).toContain("회의 제목: 구매 검토 회의");
    expect(context.text).toContain("도메인 용어: SOC2, 연간 계약");
    expect(context.text.length).toBeLessThanOrEqual(10_000);
  });
});

describe("cleanupAsyncTranscriptionResources", () => {
  it("deletes the transcription and uploaded file independently", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cleanupAsyncTranscriptionResources({
        transcriptionId: "tr_123",
        fileId: "file_456"
      })
    ).resolves.toEqual({
      cleanupTargets: ["transcriptions/tr_123", "files/file_456"],
      deletedTargets: ["transcriptions/tr_123", "files/file_456"],
      skippedTargets: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.soniox.com/v1/transcriptions/tr_123",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.soniox.com/v1/files/file_456",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("still attempts uploaded file cleanup when transcription deletion fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "temporary failure"
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "temporary failure"
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "temporary failure"
      })
      .mockResolvedValueOnce({
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(
      cleanupAsyncTranscriptionResources({
        transcriptionId: "tr_123",
        fileId: "file_456"
      })
    ).rejects.toThrow("Soniox cleanup failed");
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.soniox.com/v1/files/file_456",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("treats already-deleted transcription and file resources as idempotent cleanup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not_found"
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not_found"
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cleanupAsyncTranscriptionResources({
        transcriptionId: "tr_deleted",
        fileId: "file_deleted"
      })
    ).resolves.toEqual({
      cleanupTargets: ["transcriptions/tr_deleted", "files/file_deleted"],
      deletedTargets: [],
      skippedTargets: ["transcriptions/tr_deleted", "files/file_deleted"]
    });
  });
});

describe("Soniox REST transport", () => {
  it("retries retryable Soniox HTTP failures before returning JSON", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limited"
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "tr_retry",
          status: "processing",
          created_at: "2026-04-17T09:00:00.000Z",
          filename: "meeting.m4a",
          audio_url: "https://example.com/audio.m4a",
          file_id: null,
          client_reference_id: "session_1",
          error_message: null
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = getAsyncTranscription("tr_retry");
    const assertion = expect(resultPromise).resolves.toMatchObject({
      id: "tr_retry",
      status: "processing"
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a stuck Soniox REST request instead of waiting forever", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = getAsyncTranscription("tr_timeout");
    const assertion = expect(resultPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
