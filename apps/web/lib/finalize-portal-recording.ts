import {
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

export async function finalizePortalRecording(
  input: FinalizePortalRecordingInput
): Promise<SessionSnapshotRecord> {
  const upload = await (input.uploadPortalSourceAudio ?? uploadPortalSourceAudio)({
    sessionId: input.sessionId,
    file: input.file,
    fileName: input.fileName
  });

  await input.onSourceAudioUploaded?.(upload);

  return (input.processPortalSession ?? processPortalSession)({
    sessionId: input.sessionId,
    fileId: upload.fileId,
    wait: input.wait ?? true
  });
}
