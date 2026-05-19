import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import {
  apiConfig,
  isMinioConfigured,
  isPostgresConfigured
} from "../config";

let postgresPool: Pool | null = null;
let s3Client: S3Client | null = null;

export function getPostgresPool(): Pool {
  if (!isPostgresConfigured()) {
    throw new Error("POSTGRES_URL is not configured.");
  }

  if (!postgresPool) {
    postgresPool = new Pool({
      connectionString: apiConfig.POSTGRES_URL
    });
    postgresPool.on("error", (error) => {
      console.warn("Postgres idle connection error; pool will reconnect on demand.", error);
    });
  }

  return postgresPool;
}

export function getArtifactBucketName(): string {
  return apiConfig.MINIO_BUCKET_ARTIFACTS;
}

export function getAudioBucketName(): string {
  return apiConfig.MINIO_BUCKET_AUDIO;
}

export function getS3StorageClient(): S3Client {
  if (!isMinioConfigured()) {
    throw new Error("MinIO artifact storage is not fully configured.");
  }

  s3Client ??= new S3Client({
    endpoint: apiConfig.MINIO_ENDPOINT,
    region: apiConfig.MINIO_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: apiConfig.MINIO_ACCESS_KEY!,
      secretAccessKey: apiConfig.MINIO_SECRET_KEY!
    }
  });

  return s3Client;
}
