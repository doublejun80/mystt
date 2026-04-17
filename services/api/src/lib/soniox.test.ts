import { describe, expect, it } from "vitest";

import { resolveSonioxWebhookUrl } from "./soniox";

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
        INSFORGE_BASE_URL: undefined,
        INSFORGE_ADMIN_TOKEN: undefined,
        INSFORGE_STORAGE_AUDIO_BUCKET: "audio",
        INSFORGE_STORAGE_ARTIFACTS_BUCKET: "artifacts",
        INSFORGE_STORAGE_SHADOW_WRITE: false,
        SONIOX_API_KEY: "test",
        SONIOX_WEBHOOK_URL: undefined,
        SONIOX_WEBHOOK_SECRET: undefined,
        SONIOX_RT_MODEL: "stt-rt-v4",
        SONIOX_ASYNC_MODEL: "stt-async-v4",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "gpt-5.4-mini",
        OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
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
        INSFORGE_BASE_URL: undefined,
        INSFORGE_ADMIN_TOKEN: undefined,
        INSFORGE_STORAGE_AUDIO_BUCKET: "audio",
        INSFORGE_STORAGE_ARTIFACTS_BUCKET: "artifacts",
        INSFORGE_STORAGE_SHADOW_WRITE: false,
        SONIOX_API_KEY: "test",
        SONIOX_WEBHOOK_URL: "https://api.example.com/v1/webhooks/soniox",
        SONIOX_WEBHOOK_SECRET: undefined,
        SONIOX_RT_MODEL: "stt-rt-v4",
        SONIOX_ASYNC_MODEL: "stt-async-v4",
        OPENAI_API_KEY: "test",
        OPENAI_MODEL: "gpt-5.4-mini",
        OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
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
