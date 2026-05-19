import { normalizeSonioxTranscript } from "@mystt/transcript-normalizer";
import { buildCleanupTargets } from "@mystt/soniox-client";

import { apiConfig } from "../config";
import { generateStructuredNotes } from "./openai";
import {
  cleanupAsyncTranscriptionResources,
  convertTranscriptToPackageShape,
  createAsyncTranscriptionJob,
  getAsyncTranscription,
  getAsyncTranscript,
  transcriptionSummary
} from "./soniox";
import {
  getSession,
  getSessionSnapshot,
  getStoredTranscription,
  refreshStore,
  recordAuditEvent,
  saveNormalizedTranscript,
  saveSourceAudio,
  saveStructuredNotes,
  saveTranscriptionMetadata,
  updateSessionStatus
} from "./store";

const SOURCE_AUDIO_FETCH_TIMEOUT_MS = 60_000;
const SOURCE_AUDIO_MAX_BYTES = 512 * 1024 * 1024;
export const finalTranscriptionProcessingTimeoutMs = 10 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

async function fetchSourceAudio(input: { audioUrl: string }) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SOURCE_AUDIO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(input.audioUrl, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > SOURCE_AUDIO_MAX_BYTES) {
      throw new Error(
        `Source audio is too large: ${contentLength} bytes exceeds ${SOURCE_AUDIO_MAX_BYTES} bytes`
      );
    }

    const contentType = response.headers.get("content-type");
    const chunks: Uint8Array[] = [];
    let byteLength = 0;

    if (response.body) {
      const reader = response.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        byteLength += value.byteLength;

        if (byteLength > SOURCE_AUDIO_MAX_BYTES) {
          controller.abort();
          throw new Error(
            `Source audio is too large: ${byteLength} bytes exceeds ${SOURCE_AUDIO_MAX_BYTES} bytes`
          );
        }

        chunks.push(value);
      }
    } else {
      const fallbackContent = new Uint8Array(await response.arrayBuffer());
      byteLength = fallbackContent.byteLength;
      chunks.push(fallbackContent);
    }

    const content = new Uint8Array(byteLength);
    let offset = 0;

    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }

    if (content.byteLength > SOURCE_AUDIO_MAX_BYTES) {
      throw new Error(
        `Source audio is too large: ${content.byteLength} bytes exceeds ${SOURCE_AUDIO_MAX_BYTES} bytes`
      );
    }

    return {
      content,
      contentType
    };
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      throw new Error(
        `Source audio fetch timed out after ${SOURCE_AUDIO_FETCH_TIMEOUT_MS}ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type AsyncTranscription = Awaited<ReturnType<typeof createAsyncTranscriptionJob>>;
type StoredTranscriptionSnapshot = NonNullable<ReturnType<typeof getStoredTranscription>>;
type FinalizerSideEffectResult = {
  finalizerSideEffectsFailed: boolean;
  finalizerSideEffectError?: string;
};

function isResumableTranscription(
  transcription: ReturnType<typeof getStoredTranscription>
): transcription is NonNullable<ReturnType<typeof getStoredTranscription>> {
  return (
    transcription?.status === "queued" ||
    transcription?.status === "processing" ||
    transcription?.status === "completed"
  );
}

function isTerminalStoredTranscription(transcription: StoredTranscriptionSnapshot) {
  return transcription.status === "completed" || transcription.status === "error";
}

function cleanupAlreadySatisfied(transcription: StoredTranscriptionSnapshot) {
  return (
    transcription.cleanupStatus === "completed" ||
    transcription.cleanupStatus === "skipped"
  );
}

function cleanupErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function retryTerminalTranscriptionCleanup(input: {
  sessionId: string;
  transcription?: StoredTranscriptionSnapshot;
}): Promise<FinalizerSideEffectResult | undefined> {
  if (
    !input.transcription ||
    !isTerminalStoredTranscription(input.transcription) ||
    cleanupAlreadySatisfied(input.transcription)
  ) {
    return undefined;
  }

  try {
    await cleanupAsyncTranscriptionResources({
      transcriptionId: input.transcription.transcriptionId,
      fileId: input.transcription.fileId
    });
    await saveTranscriptionMetadata(input.sessionId, {
      transcriptionId: input.transcription.transcriptionId,
      status: input.transcription.status,
      createdAt: input.transcription.createdAt,
      cleanupStatus: "completed",
      cleanupCompletedAt: new Date().toISOString(),
      cleanupLastError: undefined
    });
    return {
      finalizerSideEffectsFailed: false
    };
  } catch (cleanupError) {
    const message = cleanupErrorMessage(cleanupError);
    await saveTranscriptionMetadata(input.sessionId, {
      transcriptionId: input.transcription.transcriptionId,
      status: input.transcription.status,
      createdAt: input.transcription.createdAt,
      cleanupStatus: "failed",
      cleanupLastError: message
    });
    return {
      finalizerSideEffectsFailed: true,
      finalizerSideEffectError: message
    };
  }
}

function transcriptionFromStored(input: {
  sessionId: string;
  transcription: NonNullable<ReturnType<typeof getStoredTranscription>>;
}): AsyncTranscription {
  return {
    id: input.transcription.transcriptionId,
    status: input.transcription.status,
    created_at: input.transcription.createdAt,
    filename: input.transcription.filename ?? `transcription-${input.transcription.transcriptionId}`,
    audio_url: input.transcription.audioUrl ?? null,
    file_id: input.transcription.fileId ?? null,
    client_reference_id: input.sessionId,
    error_message: input.transcription.errorMessage ?? null
  };
}

function cleanupTargetsForTranscription(input: {
  transcriptionId: string;
  fileId?: string;
  existingTargets?: string[];
}) {
  if (input.existingTargets && input.existingTargets.length > 0) {
    return input.existingTargets;
  }

  return buildCleanupTargets({
    transcriptionId: input.transcriptionId,
    fileId: input.fileId
  });
}

export async function waitForTerminalSessionSnapshot(input: {
  sessionId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await refreshStore();
    const snapshot = getSessionSnapshot(input.sessionId);

    if (!snapshot) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (snapshot.session.status === "completed" || snapshot.session.status === "failed") {
      return {
        timedOut: false,
        snapshot
      };
    }

    await sleep(pollIntervalMs);
  }

  await refreshStore();
  return {
    timedOut: true,
    snapshot: getSessionSnapshot(input.sessionId)
  };
}

function inferExtensionFromContentType(contentType?: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const normalized = contentType.toLowerCase();
  if (normalized.includes("mpeg")) {
    return "mp3";
  }
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("webm")) {
    return "webm";
  }

  return undefined;
}

function resolveSourceAudioFileName(input: {
  sessionId: string;
  audioUrl: string;
  contentType?: string | null;
}): string {
  try {
    const parsed = new URL(input.audioUrl);
    const candidate = parsed.pathname.split("/").pop();

    if (candidate && candidate.includes(".")) {
      return candidate;
    }
  } catch {
    // Fall back to a deterministic generated name.
  }

  const extension = inferExtensionFromContentType(input.contentType) ?? "bin";
  return `source-${input.sessionId}.${extension}`;
}

function buildMeetingPurpose(input: {
  title: string;
  mode: string;
}): string {
  if (input.mode === "meeting") {
    return `${input.title} 회의에서 결정사항, 액션 아이템, 미결사항, 리스크를 근거 발화와 함께 남긴다.`;
  }

  if (input.mode === "interview") {
    return `${input.title} 인터뷰의 질문, 답변, 핵심 인사이트를 근거 발화와 함께 남긴다.`;
  }

  return `${input.title} 세션의 핵심 메시지와 근거 발화를 보존한다.`;
}

export async function processSessionVerticalSlice(input: {
  sessionId: string;
  audioUrl?: string;
  fileId?: string;
  wait?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}) {
  const session = getSession(input.sessionId);

  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }

  const existingSnapshot = getSessionSnapshot(session.id);
  if (!input.audioUrl && existingSnapshot?.notes) {
    const cleanupResult = await retryTerminalTranscriptionCleanup({
      sessionId: session.id,
      transcription: getStoredTranscription(session.id)
    });

    if (existingSnapshot.session.status !== "completed") {
      await updateSessionStatus(session.id, "completed");
      await refreshStore();
    } else if (cleanupResult) {
      await refreshStore();
    }

    return {
      accepted: false,
      snapshot: getSessionSnapshot(session.id) ?? existingSnapshot,
      ...(cleanupResult ?? {})
    };
  }

  if (input.audioUrl) {
    await updateSessionStatus(session.id, "uploading");

    try {
      const { content, contentType } = await fetchSourceAudio({
        audioUrl: input.audioUrl
      });
      const fileName = resolveSourceAudioFileName({
        sessionId: session.id,
        audioUrl: input.audioUrl,
        contentType
      });

      await saveSourceAudio({
        sessionId: session.id,
        fileName,
        content,
        contentType: contentType ?? undefined,
        sourceUrl: input.audioUrl
      });
    } catch (error) {
      await updateSessionStatus(session.id, "failed");

      try {
        await recordAuditEvent({
          sessionId: session.id,
          kind: "source_audio.stage_failed",
          payload: {
            sourceUrl: input.audioUrl,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } catch {
        // Best effort only: never let audit persistence block the terminal failed state.
      }

      return {
        accepted: false,
        snapshot: getSessionSnapshot(session.id)
      };
    }
  }

  await updateSessionStatus(session.id, "transcribing");

  let startupTranscription:
    | Awaited<ReturnType<typeof createAsyncTranscriptionJob>>
    | undefined;
  let startupSummary: ReturnType<typeof transcriptionSummary> | undefined;
  let startupStage: "create_async_transcription_job" | "save_transcription_metadata" =
    "create_async_transcription_job";

  try {
    const participantNames = (session.participants ?? []).map((participant) => participant.name);
    const existingTranscription = getStoredTranscription(session.id);

    if (isResumableTranscription(existingTranscription)) {
      startupTranscription = transcriptionFromStored({
        sessionId: session.id,
        transcription: existingTranscription
      });
      startupSummary = transcriptionSummary(startupTranscription);

      try {
        await recordAuditEvent({
          sessionId: session.id,
          kind: "transcription.resume_existing",
          payload: {
            transcriptionId: existingTranscription.transcriptionId,
            status: existingTranscription.status,
            cleanupTargets: existingTranscription.cleanupTargets ?? [],
            cleanupStatus: existingTranscription.cleanupStatus ?? null
          }
        });
      } catch {
        // Best effort only: resume should continue even if audit persistence is down.
      }
    } else {
      startupTranscription = await createAsyncTranscriptionJob({
        sessionId: session.id,
        mode: session.mode,
        title: session.title,
        project: session.projectKey ?? "general",
        audioUrl: input.audioUrl,
        fileId: input.fileId,
        languageHints: session.languageHints,
        expectedSpeakerCount: participantNames.length > 0 ? participantNames.length : undefined,
        knownTerms: session.projectKey ? [session.projectKey] : undefined,
        participantNames,
        meetingPurpose: buildMeetingPurpose({
          title: session.title,
          mode: session.mode
        }),
        context: [
          `Project: ${session.projectKey ?? "general"}`,
          `Title: ${session.title}`
        ]
      });

      startupSummary = transcriptionSummary(startupTranscription);
      startupStage = "save_transcription_metadata";
      await saveTranscriptionMetadata(session.id, {
        transcriptionId: startupSummary.transcriptionId,
        status: startupSummary.status,
        createdAt: startupSummary.createdAt,
        filename: startupSummary.filename,
        audioUrl: startupSummary.audioUrl,
        fileId: startupSummary.fileId,
        cleanupTargets: buildCleanupTargets({
          transcriptionId: startupSummary.transcriptionId,
          fileId: startupSummary.fileId
        }),
        cleanupStatus: "pending",
        cleanupRequestedAt: new Date().toISOString(),
        errorMessage: startupSummary.errorMessage
      });
    }
  } catch (error) {
    await updateSessionStatus(session.id, "failed");

    try {
      await recordAuditEvent({
        sessionId: session.id,
        kind: "transcription.start_failed",
        payload: {
          stage: startupStage,
          transcriptionId: startupSummary?.transcriptionId ?? null,
          fileId: startupSummary?.fileId ?? null,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    } catch {
      // Best effort only: never let audit persistence block the terminal failed state.
    }

    if (startupStage === "save_transcription_metadata" && startupTranscription) {
      try {
        await cleanupAsyncTranscriptionResources({
          transcriptionId: startupTranscription.id,
          fileId: startupTranscription.file_id ?? undefined
        });
      } catch {
        // Best effort only: do not block the failed snapshot on cleanup retries.
      }
    }

    return {
      accepted: false,
      snapshot: getSessionSnapshot(session.id)
    };
  }

  const transcription = startupTranscription;
  if (!transcription) {
    throw new Error("Transcription not created.");
  }

  if (input.wait === false) {
    return {
      accepted: true,
      snapshot: getSessionSnapshot(session.id)
    };
  }

  const timeoutMs = input.timeoutMs ?? finalTranscriptionProcessingTimeoutMs;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let current = transcription;

  while (
    current.status !== "completed" &&
    current.status !== "error" &&
    Date.now() < deadline
  ) {
    await sleep(pollIntervalMs);
    const refreshed = await getAsyncTranscription(current.id);
    if (!refreshed) {
      continue;
    }
    current = refreshed;
  }

  const finalSummary = transcriptionSummary(current);
  const storedTranscription = getStoredTranscription(session.id);
  const finalFileId = finalSummary.fileId ?? storedTranscription?.fileId;
  const finalCleanupTargets = cleanupTargetsForTranscription({
    transcriptionId: finalSummary.transcriptionId,
    fileId: finalFileId,
    existingTargets: storedTranscription?.cleanupTargets
  });
  await saveTranscriptionMetadata(session.id, {
    transcriptionId: finalSummary.transcriptionId,
    status: finalSummary.status,
    createdAt: finalSummary.createdAt,
    filename: finalSummary.filename,
    audioUrl: finalSummary.audioUrl,
    fileId: finalFileId,
    cleanupTargets: finalCleanupTargets,
    errorMessage: finalSummary.errorMessage
  });

  if (current.status === "error") {
    try {
      await cleanupAsyncTranscriptionResources({
        transcriptionId: finalSummary.transcriptionId,
        fileId: finalFileId
      });
      await saveTranscriptionMetadata(session.id, {
        transcriptionId: finalSummary.transcriptionId,
        status: finalSummary.status,
        createdAt: finalSummary.createdAt,
        cleanupStatus: "completed",
        cleanupCompletedAt: new Date().toISOString(),
        cleanupLastError: undefined
      });
    } catch (cleanupError) {
      await saveTranscriptionMetadata(session.id, {
        transcriptionId: finalSummary.transcriptionId,
        status: finalSummary.status,
        createdAt: finalSummary.createdAt,
        cleanupStatus: "failed",
        cleanupLastError:
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      });
    }

    await updateSessionStatus(session.id, "failed");
    return {
      accepted: false,
      snapshot: getSessionSnapshot(session.id)
    };
  }

  if (current.status !== "completed") {
    return {
      accepted: true,
      timedOut: true,
      snapshot: getSessionSnapshot(session.id)
    };
  }

  const transcript = await getAsyncTranscript(current.id);
  if (!transcript) {
    throw new Error(`Transcript not found for transcription: ${current.id}`);
  }

  await updateSessionStatus(session.id, "summarizing");
  const rawTranscript = convertTranscriptToPackageShape(session.id, transcript);
  const normalizedTranscript = normalizeSonioxTranscript({
    mode: session.mode,
    transcript: rawTranscript
  });

  await saveNormalizedTranscript(session.id, {
    rawTranscript,
    normalizedTranscript
  });

  const notes = await generateStructuredNotes({
    mode: session.mode,
    transcript: normalizedTranscript,
    sessionTitle: session.title
  });

  await updateSessionStatus(session.id, "emailing");
  await saveStructuredNotes(session.id, {
    model: apiConfig.OPENAI_MODEL,
    notes
  });

  const cleanupResult = await retryTerminalTranscriptionCleanup({
    sessionId: session.id,
    transcription: {
      transcriptionId: finalSummary.transcriptionId,
      status: finalSummary.status,
      createdAt: finalSummary.createdAt,
      filename: finalSummary.filename,
      audioUrl: finalSummary.audioUrl,
      fileId: finalFileId,
      cleanupTargets: finalCleanupTargets,
      cleanupStatus: storedTranscription?.cleanupStatus ?? "pending",
      cleanupRequestedAt: storedTranscription?.cleanupRequestedAt,
      cleanupCompletedAt: storedTranscription?.cleanupCompletedAt,
      cleanupLastError: storedTranscription?.cleanupLastError,
      errorMessage: finalSummary.errorMessage
    }
  });

  await updateSessionStatus(session.id, "completed");

  return {
    accepted: false,
    snapshot: getSessionSnapshot(session.id),
    ...(cleanupResult?.finalizerSideEffectsFailed ? cleanupResult : {})
  };
}
