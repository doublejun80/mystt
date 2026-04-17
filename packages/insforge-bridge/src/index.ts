export type InsforgeClientType = "web" | "mobile" | "desktop" | "server";

export interface InsforgePublicAuthConfig {
  oAuthProviders: string[];
  customOAuthProviders?: string[];
  requireEmailVerification: boolean;
  passwordMinLength: number;
  requireNumber: boolean;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireSpecialChar: boolean;
  verifyEmailMethod: string;
  resetPasswordMethod: string;
  allowedRedirectUrls?: string[];
}

export interface InsforgeUserRecord {
  id: string;
  email?: string;
  role?: string;
  emailVerified?: boolean;
  providers?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface InsforgeSessionRecord {
  user: InsforgeUserRecord;
  accessToken?: string | null;
  refreshToken?: string | null;
  csrfToken?: string | null;
  requireEmailVerification?: boolean;
}

export interface InsforgeSignUpInput {
  email: string;
  password: string;
  name?: string;
  redirectTo?: string;
  clientType?: InsforgeClientType;
}

export interface InsforgeCurrentSessionRecord {
  user: InsforgeUserRecord;
}

export interface InsforgeBucketRecord {
  name: string;
  public: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

export interface InsforgeCreateBucketResponse {
  message: string;
  bucket: string;
}

export interface InsforgeStorageUploadStrategy {
  method: "presigned" | "direct";
  uploadUrl: string;
  fields?: Record<string, string>;
  key: string;
  confirmRequired: boolean;
  confirmUrl?: string;
  expiresAt?: string;
}

export interface InsforgeStoredObjectRecord {
  bucket: string;
  key: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  url: string;
}

export interface InsforgeHttpClientOptions {
  baseUrl: string;
}

function stripTrailingSlash(input: string) {
  return input.replace(/\/+$/, "");
}

function toApiUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath.startsWith("/api/")) {
    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  return `${normalizedBaseUrl}/api${normalizedPath}`;
}

function withClientType(path: string, clientType?: InsforgeClientType) {
  if (!clientType) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}client_type=${encodeURIComponent(clientType)}`;
}

function resolveAbsoluteUrl(baseUrl: string, value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${stripTrailingSlash(baseUrl)}${value.startsWith("/") ? value : `/${value}`}`;
}

async function readErrorDetail(response: Response) {
  try {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
      nextActions?: string;
    };
    return payload.message ?? payload.error ?? payload.nextActions ?? response.statusText;
  } catch {
    try {
      const text = await response.text();
      return text.trim() || response.statusText;
    } catch {
      return response.statusText;
    }
  }
}

function createHeaders(token?: string, extraHeaders?: RequestInit["headers"]) {
  const headers = new Headers();

  if (extraHeaders instanceof Headers) {
    extraHeaders.forEach((value: string, key: string) => {
      headers.set(key, value);
    });
  } else if (Array.isArray(extraHeaders)) {
    for (const entry of extraHeaders) {
      const [key, value] = entry;
      if (typeof key === "string" && typeof value === "string") {
        headers.set(key, value);
      }
    }
  } else if (extraHeaders && typeof extraHeaders === "object") {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return headers;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  token?: string
): Promise<T> {
  const response = await fetch(toApiUrl(baseUrl, path), {
    ...init,
    headers: createHeaders(token, init?.headers)
  });

  if (!response.ok) {
    const error = new Error(
      `InsForge request failed: ${await readErrorDetail(response)}`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}

export function createInsforgeHttpClient(options: InsforgeHttpClientOptions) {
  const baseUrl = stripTrailingSlash(options.baseUrl);

  return {
    baseUrl,
    resolveAbsoluteUrl(value: string) {
      return resolveAbsoluteUrl(baseUrl, value);
    },
    async fetchPublicAuthConfig() {
      return requestJson<InsforgePublicAuthConfig>(baseUrl, "/auth/public-config");
    },
    async signInWithPassword(input: {
      email: string;
      password: string;
      clientType?: InsforgeClientType;
    }) {
      return requestJson<InsforgeSessionRecord>(
        baseUrl,
        withClientType("/auth/sessions", input.clientType),
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email: input.email,
            password: input.password
          })
        }
      );
    },
    async signUpWithPassword(input: InsforgeSignUpInput) {
      return requestJson<InsforgeSessionRecord>(
        baseUrl,
        withClientType("/auth/users", input.clientType),
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            name: input.name,
            redirectTo: input.redirectTo
          })
        }
      );
    },
    async refreshSession(input: {
      refreshToken: string;
      clientType?: InsforgeClientType;
    }) {
      return requestJson<InsforgeSessionRecord>(
        baseUrl,
        withClientType("/auth/refresh", input.clientType),
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            refreshToken: input.refreshToken
          })
        }
      );
    },
    async getCurrentSession(accessToken: string) {
      return requestJson<InsforgeCurrentSessionRecord>(
        baseUrl,
        "/auth/sessions/current",
        undefined,
        accessToken
      );
    },
    async listBuckets(adminToken: string) {
      return requestJson<InsforgeBucketRecord[]>(
        baseUrl,
        "/storage/buckets",
        undefined,
        adminToken
      );
    },
    async createBucket(input: {
      adminToken: string;
      bucketName: string;
      isPublic?: boolean;
    }) {
      return requestJson<InsforgeCreateBucketResponse>(
        baseUrl,
        "/storage/buckets",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            bucketName: input.bucketName,
            isPublic: input.isPublic ?? false
          })
        },
        input.adminToken
      );
    },
    async requestUploadStrategy(input: {
      token: string;
      bucketName: string;
      filename: string;
      contentType?: string;
      size?: number;
    }) {
      return requestJson<InsforgeStorageUploadStrategy>(
        baseUrl,
        `/storage/buckets/${encodeURIComponent(input.bucketName)}/upload-strategy`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            filename: input.filename,
            contentType: input.contentType,
            size: input.size
          })
        },
        input.token
      );
    },
    async confirmUpload(input: {
      token: string;
      bucketName: string;
      objectKey: string;
      size: number;
      contentType?: string;
      etag?: string;
    }) {
      return requestJson<InsforgeStoredObjectRecord>(
        baseUrl,
        `/storage/buckets/${encodeURIComponent(input.bucketName)}/objects/${encodeURIComponent(input.objectKey)}/confirm-upload`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            size: input.size,
            contentType: input.contentType,
            etag: input.etag
          })
        },
        input.token
      );
    },
    async uploadObject(input: {
      token: string;
      bucketName: string;
      objectKey: string;
      fileName: string;
      content: Uint8Array;
      contentType?: string;
    }) {
      const formData = new FormData() as any;
      const blob = new Blob([input.content as any], {
        type: input.contentType ?? "application/octet-stream"
      } as any);
      formData.append("file", blob, input.fileName);

      const response = await fetch(
        toApiUrl(
          baseUrl,
          `/storage/buckets/${encodeURIComponent(input.bucketName)}/objects/${encodeURIComponent(input.objectKey)}`
        ),
        {
          method: "PUT",
          headers: createHeaders(input.token),
          body: formData as any
        }
      );

      if (!response.ok) {
        const error = new Error(
          `InsForge request failed: ${await readErrorDetail(response)}`
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return response.json() as Promise<InsforgeStoredObjectRecord>;
    }
  };
}
