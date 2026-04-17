import type {
  InsforgeClientType,
  InsforgeCurrentSessionRecord,
  InsforgePublicAuthConfig,
  InsforgeSessionRecord
} from "@mystt/insforge-bridge";

const defaultApiBaseUrl = "http://127.0.0.1:4100";

function getDesktopApiBaseUrl() {
  return defaultApiBaseUrl;
}

async function requestJson<T>(path: string, init?: RequestInit, accessToken?: string) {
  const response = await fetch(`${getDesktopApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as { message?: string; error?: string };
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // Keep fallback detail.
      }
    }

    throw new Error(`Request failed: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchInsforgeDesktopPublicConfig() {
  const payload = await requestJson<{ data: InsforgePublicAuthConfig }>(
    "/v1/insforge/auth/public-config"
  );
  return payload.data;
}

export async function signInWithInsforgeDesktop(input: {
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
        clientType: input.clientType ?? "desktop"
      })
    }
  );
  return payload.data;
}

export async function signUpWithInsforgeDesktop(input: {
  email: string;
  password: string;
  name?: string;
  redirectTo?: string;
  clientType?: InsforgeClientType;
}) {
  const payload = await requestJson<{ data: InsforgeSessionRecord }>(
    "/v1/insforge/auth/sign-up",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...input,
        clientType: input.clientType ?? "desktop"
      })
    }
  );
  return payload.data;
}

export async function refreshInsforgeDesktopSession(input: {
  refreshToken: string;
  clientType?: InsforgeClientType;
}) {
  const payload = await requestJson<{ data: InsforgeSessionRecord }>(
    "/v1/insforge/auth/refresh",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...input,
        clientType: input.clientType ?? "desktop"
      })
    }
  );
  return payload.data;
}

export async function fetchInsforgeDesktopSession(accessToken: string) {
  const payload = await requestJson<{ data: InsforgeCurrentSessionRecord }>(
    "/v1/insforge/auth/session",
    undefined,
    accessToken
  );
  return payload.data;
}
