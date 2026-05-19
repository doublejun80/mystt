import type { ApiHealth } from "./api";
import type { ArtifactKind, SessionRecord } from "@mystt/audio-core";

export function hasPortalSourceAudio(session: Pick<SessionRecord, "localAudioPath">) {
  return session.localAudioPath.trim().length > 0;
}

export function hasReadyPortalArtifact(
  session: Pick<SessionRecord, "artifacts">,
  kind: ArtifactKind
) {
  return session.artifacts.some(
    (artifact) => artifact.kind === kind && artifact.status === "ready"
  );
}

export function isRemotePersistenceReady(
  health?: Pick<ApiHealth, "persistence"> | null
) {
  return (
    health?.persistence?.postgres.mode === "remote" &&
    health?.persistence?.minio.mode === "remote"
  );
}

export function describePortalStorageState(
  health?: Pick<ApiHealth, "persistence"> | null
) {
  return {
    ready: isRemotePersistenceReady(health),
    label: isRemotePersistenceReady(health)
      ? "서버 persistence 연결됨"
      : "로컬 fallback 저장 중"
  };
}
