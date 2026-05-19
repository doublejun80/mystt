import {
  finalProcessingTimeoutMs,
  processPortalSession,
  type SessionSnapshotRecord,
  type SourceAudioUploadResponse,
  uploadPortalSourceAudio
} from "./api";

type FinalizePortalRecordingInput = {
  sessionId: string;
  file: Blob;
  fileName: string;
  wait?: boolean;
  onSourceAudioUploaded?: (upload: SourceAudioUploadResponse) => void | Promise<void>;
  uploadPortalSourceAudio?: typeof uploadPortalSourceAudio;
  processPortalSession?: typeof processPortalSession;
};

const clientHashWholeBlobRiskBytes = 64 * 1024 * 1024;

function warnWhenClientHashReadsWholeBlob(blob: Blob) {
  if (!Number.isFinite(blob.size) || blob.size <= clientHashWholeBlobRiskBytes) {
    return;
  }

  globalThis.console?.warn?.(
    "[mystt] source_audio.client_sha_whole_blob_memory_risk",
    {
      byteLength: blob.size,
      thresholdBytes: clientHashWholeBlobRiskBytes,
      mitigation: "streaming_sha256_required"
    }
  );
}

async function sha256Hex(blob: Blob) {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error(
      "원본 음성 업로드 전 해시 계산을 지원하지 않아 처리를 중단했습니다."
    );
  }

  try {
    warnWhenClientHashReadsWholeBlob(blob);
    const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`원본 음성 업로드 전 해시 계산에 실패했습니다: ${detail}`);
  }
}

export async function finalizePortalRecording(
  input: FinalizePortalRecordingInput
): Promise<SessionSnapshotRecord> {
  const localSha256 = await sha256Hex(input.file);
  const upload = await (input.uploadPortalSourceAudio ?? uploadPortalSourceAudio)({
    sessionId: input.sessionId,
    file: input.file,
    fileName: input.fileName
  });

  if (
    typeof input.file.size === "number" &&
    upload.byteLength !== input.file.size
  ) {
    throw new Error(
      `원본 음성 업로드 크기 검증에 실패했습니다. expected=${input.file.size}, actual=${upload.byteLength}`
    );
  }

  const uploadSha256 = upload.sha256?.toLowerCase();

  if (!uploadSha256) {
    throw new Error("원본 음성 업로드 해시 응답이 없어 처리를 중단했습니다.");
  }

  if (localSha256 !== uploadSha256) {
    throw new Error("원본 음성 업로드 해시 검증에 실패했습니다.");
  }

  await input.onSourceAudioUploaded?.(upload);

  return (input.processPortalSession ?? processPortalSession)({
    sessionId: input.sessionId,
    fileId: upload.fileId,
    wait: input.wait ?? true,
    timeoutMs: finalProcessingTimeoutMs
  });
}
