import type {
  InsforgeClientType,
  InsforgeCurrentSessionRecord,
  InsforgePublicAuthConfig,
  InsforgeSessionRecord,
  InsforgeStorageUploadStrategy
} from "@mystt/insforge-bridge";

import { getMobileApiBaseUrl } from "./api";

async function requestJson<T>(path: string, init?: RequestInit, accessToken?: string) {
  const response = await fetch(`${getMobileApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchInsforgeMobilePublicConfig() {
  const payload = await requestJson<{ data: InsforgePublicAuthConfig }>(
    "/v1/insforge/auth/public-config"
  );
  return payload.data;
}

export async function signInWithInsforgeMobile(input: {
  email: string;
  password: string;
  clientType?: InsforgeClientType;
}) {
  const payload = await requestJson<{ data: InsforgeSessionRecord }>(
    "/v1/insforge/auth/sign-in",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...input,
        clientType: input.clientType ?? "mobile"
      })
    }
  );

  return payload.data;
}

export async function fetchInsforgeMobileSession(accessToken: string) {
  const payload = await requestJson<{ data: InsforgeCurrentSessionRecord }>(
    "/v1/insforge/auth/session",
    undefined,
    accessToken
  );
  return payload.data;
}

export async function requestInsforgeMobileUploadStrategy(input: {
  accessToken: string;
  bucketName: string;
  filename: string;
  contentType?: string;
  size?: number;
}) {
  const payload = await requestJson<{ data: InsforgeStorageUploadStrategy }>(
    "/v1/insforge/storage/upload-strategy",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    },
    input.accessToken
  );
  return payload.data;
}
