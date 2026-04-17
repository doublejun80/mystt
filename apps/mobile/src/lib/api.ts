import * as FileSystem from "expo-file-system";

import { mobileEnv } from "./env";

import type { SessionMode, SessionRecord } from "@mystt/audio-core";

export interface MobileApiHealth {
  ok: boolean;
  service: string;
  now: string;
}

export interface MobileTempKeyProbe {
  provider: string;
  sessionId: string;
  ttlSeconds: number;
  issuedAt: string;
  note: string;
}

export interface MobileSessionsEnvelope {
  data: SessionRecord[];
}

export interface MobileSourceAudioUploadResponse {
  sessionId: string;
  fileId: string;
  location: string;
  fileName: string;
  byteLength: number;
  createdAt: string;
}

const jsonHeaders = {
  "content-type": "application/json"
};

export function getMobileApiBaseUrl() {
  return mobileEnv.apiBaseUrl.replace(/\/$/, "");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getMobileApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...jsonHeaders,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchWorkspaceHealth(): Promise<MobileApiHealth> {
  return requestJson<MobileApiHealth>("/health");
}

export async function fetchWorkspaceSessions(): Promise<SessionRecord[]> {
  const payload = await requestJson<MobileSessionsEnvelope>("/v1/sessions");
  return payload.data;
}

export async function requestSonioxTempKey(sessionId: string): Promise<MobileTempKeyProbe> {
  const payload = await requestJson<{ data: MobileTempKeyProbe }>("/v1/soniox/temp-key", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      ttlSeconds: 900
    })
  });

  return payload.data;
}

export async function createMobileProcessingSession(input: {
  title: string;
  mode: SessionMode;
  projectKey?: string;
}) {
  const payload = await requestJson<{ data: SessionRecord }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      mode: input.mode,
      projectKey: input.projectKey,
      languageHints: ["ko", "en"]
    })
  });

  return payload.data;
}

export async function uploadMobileSourceAudio(input: {
  sessionId: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
}) {
  const response = await FileSystem.uploadAsync(
    `${getMobileApiBaseUrl()}/v1/uploads/source-audio`,
    input.fileUri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "file",
      mimeType: input.mimeType ?? "audio/mp4",
      parameters: {
        sessionId: input.sessionId
      }
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const payload = JSON.parse(response.body) as {
    data: MobileSourceAudioUploadResponse;
  };

  return payload.data;
}

export async function enqueueSessionFromFileId(input: {
  sessionId: string;
  fileId: string;
}) {
  return requestJson("/v1/sessions/" + input.sessionId + "/process", {
    method: "POST",
    body: JSON.stringify({
      fileId: input.fileId,
      wait: false
    })
  });
}
