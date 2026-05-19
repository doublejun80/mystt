import { resolve } from "node:path";
import process from "node:process";
import { z } from "zod";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env")
];

for (const candidate of envCandidates) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    // Try the next candidate until one exists.
  }
}

const envSchema = z.object({
  API_PORT: z.coerce.number().default(4100),
  APP_DOMAIN: z.string().default("app.localhost"),
  API_DOMAIN: z.string().default("api.localhost"),
  POSTGRES_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET_AUDIO: z.string().default("audio"),
  MINIO_BUCKET_ARTIFACTS: z.string().default("artifacts"),
  MINIO_REGION: z.string().default("us-east-1"),
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_WEBHOOK_URL: z.string().optional(),
  SONIOX_WEBHOOK_SECRET: z.string().optional(),
  SONIOX_RT_MODEL: z.string().default("stt-rt-v4"),
  SONIOX_ASYNC_MODEL: z.string().default("stt-async-v4"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_AUDIO_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  MYSTT_QA_TOKEN: z.string().optional(),
  MYSTT_OWNER_EMAIL: z.string().email().optional(),
  MYSTT_OWNER_PASSWORD: z.string().optional(),
  MYSTT_AUTH_SECRET: z.string().optional(),
  MYSTT_SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 12),
  MYSTT_ALLOW_UNAUTHENTICATED_DEV: z.coerce.boolean().default(false),
  MYSTT_REQUIRE_REMOTE_BACKENDS: z.coerce.boolean().default(false),
  MAIL_DELIVERY_MODE: z.enum(["auto", "smtp", "mailapp"]).default("auto"),
  MAIL_FROM: z.string().default("notes@mystt.local"),
  MAIL_HOST: z.string().default("127.0.0.1"),
  MAIL_PORT: z.coerce.number().default(11025),
  MAIL_SECURE: z.coerce.boolean().default(false),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional()
});

export const apiConfig = envSchema.parse(process.env);

export function isSonioxConfigured(): boolean {
  return Boolean(apiConfig.SONIOX_API_KEY);
}

export function isOpenAIConfigured(): boolean {
  return Boolean(apiConfig.OPENAI_API_KEY);
}

export function isPostgresConfigured(): boolean {
  return Boolean(apiConfig.POSTGRES_URL);
}

export function isRedisConfigured(): boolean {
  return Boolean(apiConfig.REDIS_URL);
}

export function isMinioConfigured(): boolean {
  return Boolean(
    apiConfig.MINIO_ENDPOINT &&
      apiConfig.MINIO_ACCESS_KEY &&
      apiConfig.MINIO_SECRET_KEY &&
      apiConfig.MINIO_BUCKET_ARTIFACTS
  );
}
