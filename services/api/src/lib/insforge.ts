import {
  createInsforgeHttpClient,
  type InsforgeBucketRecord,
  type InsforgeClientType
} from "@mystt/insforge-bridge";

import {
  apiConfig,
  isInsforgeAdminConfigured,
  isInsforgeConfigured,
  isInsforgeStorageShadowWriteEnabled
} from "../config";

export interface InsforgeAuthRuntimeStatus {
  configured: boolean;
  adminConfigured: boolean;
  shadowWriteEnabled: boolean;
  baseUrl?: string;
  lastPublicConfigOk: boolean | null;
  lastSessionOk: boolean | null;
  lastStorageOk: boolean | null;
  lastShadowWriteOk: boolean | null;
  lastError?: string;
}

const runtimeStatus: InsforgeAuthRuntimeStatus = {
  configured: isInsforgeConfigured(),
  adminConfigured: isInsforgeAdminConfigured(),
  shadowWriteEnabled: isInsforgeStorageShadowWriteEnabled(),
  baseUrl: apiConfig.INSFORGE_BASE_URL,
  lastPublicConfigOk: null,
  lastSessionOk: null,
  lastStorageOk: null,
  lastShadowWriteOk: null
};

function updateRuntimeStatus(input: Partial<InsforgeAuthRuntimeStatus>) {
  Object.assign(runtimeStatus, input, {
    configured: isInsforgeConfigured(),
    adminConfigured: isInsforgeAdminConfigured(),
    shadowWriteEnabled: isInsforgeStorageShadowWriteEnabled(),
    baseUrl: apiConfig.INSFORGE_BASE_URL
  });
}

function getInsforgeClient() {
  if (!isInsforgeConfigured()) {
    throw new Error("INSFORGE_BASE_URL is not configured.");
  }

  return createInsforgeHttpClient({
    baseUrl: apiConfig.INSFORGE_BASE_URL!
  });
}

function getInsforgeAdminToken() {
  if (!isInsforgeAdminConfigured()) {
    throw new Error("INSFORGE_ADMIN_TOKEN is not configured.");
  }

  return apiConfig.INSFORGE_ADMIN_TOKEN!;
}

export function getInsforgeRuntimeStatus() {
  return {
    ...runtimeStatus
  };
}

export function getInsforgeArtifactBucketName() {
  return apiConfig.INSFORGE_STORAGE_ARTIFACTS_BUCKET;
}

export function getInsforgeAudioBucketName() {
  return apiConfig.INSFORGE_STORAGE_AUDIO_BUCKET;
}

export async function fetchInsforgePublicAuthConfig() {
  try {
    const result = await getInsforgeClient().fetchPublicAuthConfig();
    updateRuntimeStatus({
      lastPublicConfigOk: true,
      lastError: undefined
    });
    return result;
  } catch (error) {
    updateRuntimeStatus({
      lastPublicConfigOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function signInToInsforge(input: {
  email: string;
  password: string;
  clientType?: InsforgeClientType;
}) {
  return getInsforgeClient().signInWithPassword({
    email: input.email,
    password: input.password,
    clientType: input.clientType ?? "server"
  });
}

export async function signUpToInsforge(input: {
  email: string;
  password: string;
  name?: string;
  redirectTo?: string;
  clientType?: InsforgeClientType;
}) {
  return getInsforgeClient().signUpWithPassword({
    email: input.email,
    password: input.password,
    name: input.name,
    redirectTo: input.redirectTo,
    clientType: input.clientType ?? "server"
  });
}

export async function refreshInsforgeServerSession(input: {
  refreshToken: string;
  clientType?: InsforgeClientType;
}) {
  return getInsforgeClient().refreshSession({
    refreshToken: input.refreshToken,
    clientType: input.clientType ?? "server"
  });
}

export async function fetchInsforgeCurrentSession(accessToken: string) {
  try {
    const result = await getInsforgeClient().getCurrentSession(accessToken);
    updateRuntimeStatus({
      lastSessionOk: true,
      lastError: undefined
    });
    return result;
  } catch (error) {
    updateRuntimeStatus({
      lastSessionOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function listInsforgeStorageBuckets() {
  try {
    const result = await getInsforgeClient().listBuckets(getInsforgeAdminToken());
    updateRuntimeStatus({
      lastStorageOk: true,
      lastError: undefined
    });
    return result;
  } catch (error) {
    updateRuntimeStatus({
      lastStorageOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function ensureInsforgeStorageBuckets(input?: {
  buckets?: string[];
}) {
  const client = getInsforgeClient();
  const adminToken = getInsforgeAdminToken();
  const expectedBuckets = input?.buckets ?? [
    getInsforgeAudioBucketName(),
    getInsforgeArtifactBucketName()
  ];
  const current = await client.listBuckets(adminToken);
  const existing = new Set(current.map((bucket: InsforgeBucketRecord) => bucket.name));
  const created: string[] = [];

  for (const bucketName of expectedBuckets) {
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

  updateRuntimeStatus({
    lastStorageOk: true,
    lastError: undefined
  });

  return {
    existing: current.map((bucket) => bucket.name),
    created
  };
}

export async function requestInsforgeUploadStrategy(input: {
  bucketName: string;
  filename: string;
  contentType?: string;
  size?: number;
  accessToken?: string;
}) {
  const token = input.accessToken ?? getInsforgeAdminToken();

  return getInsforgeClient().requestUploadStrategy({
    token,
    bucketName: input.bucketName,
    filename: input.filename,
    contentType: input.contentType,
    size: input.size
  });
}

export async function confirmInsforgeUpload(input: {
  bucketName: string;
  objectKey: string;
  size: number;
  contentType?: string;
  etag?: string;
  accessToken?: string;
}) {
  const token = input.accessToken ?? getInsforgeAdminToken();

  return getInsforgeClient().confirmUpload({
    token,
    bucketName: input.bucketName,
    objectKey: input.objectKey,
    size: input.size,
    contentType: input.contentType,
    etag: input.etag
  });
}

function buildInsforgeObjectKey(sessionId: string, fileName: string) {
  return `sessions/${sessionId}/${fileName}`;
}

function resolveStoredObjectLocation(input: {
  bucket: string;
  key: string;
}) {
  return `insforge://${input.bucket}/${input.key}`;
}

function guessContentType(fileName: string) {
  if (fileName.endsWith(".json")) {
    return "application/json";
  }

  if (fileName.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (fileName.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }

  if (fileName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return "application/octet-stream";
}

export async function shadowWriteInsforgeArtifact(input: {
  sessionId: string;
  fileName: string;
  content: string | Uint8Array;
}) {
  if (!isInsforgeStorageShadowWriteEnabled()) {
    return null;
  }

  const objectKey = buildInsforgeObjectKey(input.sessionId, input.fileName);
  const content =
    typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;

  try {
    const stored = await getInsforgeClient().uploadObject({
      token: getInsforgeAdminToken(),
      bucketName: getInsforgeArtifactBucketName(),
      objectKey,
      fileName: input.fileName,
      content,
      contentType: guessContentType(input.fileName)
    });

    updateRuntimeStatus({
      lastShadowWriteOk: true,
      lastError: undefined
    });

    return {
      ...stored,
      location: resolveStoredObjectLocation({
        bucket: stored.bucket,
        key: stored.key
      })
    };
  } catch (error) {
    updateRuntimeStatus({
      lastShadowWriteOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn(
      "[insforge] Shadow artifact write failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
