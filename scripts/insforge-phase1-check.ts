import { resolve } from "node:path";
import process from "node:process";

import { createInsforgeHttpClient } from "../packages/insforge-bridge/src/index.ts";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env")
];

for (const candidate of envCandidates) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    // try next
  }
}

const baseUrl = process.env.INSFORGE_BASE_URL;
const adminToken = process.env.INSFORGE_ADMIN_TOKEN;
const audioBucket = process.env.INSFORGE_STORAGE_AUDIO_BUCKET ?? "audio";
const artifactBucket = process.env.INSFORGE_STORAGE_ARTIFACTS_BUCKET ?? "artifacts";
const ensureBuckets = process.argv.includes("--ensure-buckets");

if (!baseUrl) {
  console.error("INSFORGE_BASE_URL is required");
  process.exit(1);
}

const client = createInsforgeHttpClient({
  baseUrl
});

const publicConfig = await client.fetchPublicAuthConfig();

const summary: Record<string, unknown> = {
  baseUrl,
  publicConfig: {
    passwordMinLength: publicConfig.passwordMinLength,
    requireEmailVerification: publicConfig.requireEmailVerification,
    oAuthProviders: publicConfig.oAuthProviders
  }
};

if (adminToken) {
  const currentBuckets = await client.listBuckets(adminToken);
  const existingBucketNames = currentBuckets.map((bucket) => bucket.name);
  const existing = new Set(existingBucketNames);
  const created: string[] = [];

  if (ensureBuckets) {
    for (const bucketName of [audioBucket, artifactBucket]) {
      if (existing.has(bucketName)) {
        continue;
      }

      await client.createBucket({
        adminToken,
        bucketName,
        isPublic: false
      });
      created.push(bucketName);
    }
  }

  summary.storage = {
    existingBuckets: existingBucketNames,
    createdBuckets: created
  };
} else {
  summary.storage = {
    warning: "INSFORGE_ADMIN_TOKEN is not set; storage admin checks were skipped."
  };
}

console.log(JSON.stringify(summary, null, 2));
