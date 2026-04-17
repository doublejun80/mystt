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
  refreshStore,
  recordAuditEvent,
  saveNormalizedTranscript,
  saveSourceAudio,
  saveStructuredNotes,
  saveTranscriptionMetadata,
  updateSessionStatus
} from "./store";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  if (input.audioUrl) {
    await updateSessionStatus(session.id, "uploading");

    try {
      const response = await fetch(input.audioUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type");
      const fileName = resolveSourceAudioFileName({
        sessionId: session.id,
        audioUrl: input.audioUrl,
        contentType
      });
      const content = new Uint8Array(await response.arrayBuffer());

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
    startupTranscription = await createAsyncTranscriptionJob({
      sessionId: session.id,
      mode: session.mode,
      audioUrl: input.audioUrl,
      fileId: input.fileId,
      languageHints: session.languageHints,
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

    if (startupTranscription) {
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

  const timeoutMs = input.timeoutMs ?? 180_000;
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
  await saveTranscriptionMetadata(session.id, {
    transcriptionId: finalSummary.transcriptionId,
    status: finalSummary.status,
    createdAt: finalSummary.createdAt,
    filename: finalSummary.filename,
    audioUrl: finalSummary.audioUrl,
    fileId: finalSummary.fileId,
    cleanupTargets: buildCleanupTargets({
      transcriptionId: finalSummary.transcriptionId,
      fileId: finalSummary.fileId
    }),
    errorMessage: finalSummary.errorMessage
  });

  if (current.status === "error") {
    try {
      await cleanupAsyncTranscriptionResources({
        transcriptionId: finalSummary.transcriptionId,
        fileId: finalSummary.fileId
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
    transcript: normalizedTranscript.text,
    sessionTitle: session.title
  });

  await updateSessionStatus(session.id, "emailing");
  await saveStructuredNotes(session.id, {
    model: apiConfig.OPENAI_MODEL,
    notes
  });

  try {
    await cleanupAsyncTranscriptionResources({
      transcriptionId: finalSummary.transcriptionId,
      fileId: finalSummary.fileId
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

  await updateSessionStatus(session.id, "completed");

  return {
    accepted: false,
    snapshot: getSessionSnapshot(session.id)
  };
}
