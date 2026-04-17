import { useEffect, useState } from "react";

import type { SessionRecord } from "@mystt/audio-core";

import {
  createMobileRecorderSession,
  buildRecorderDomainSnapshot,
  recorderPhases,
  type RecorderDomainSnapshot
} from "../../domain/background-recorder";
import {
  fetchWorkspaceHealth,
  fetchWorkspaceSessions,
  requestSonioxTempKey,
  type MobileApiHealth,
  type MobileTempKeyProbe
} from "../../lib/api";

const localFallbackSession = createMobileRecorderSession();

export interface RecorderPreviewState {
  session: SessionRecord;
  phaseSnapshot: RecorderDomainSnapshot;
  apiHealth: MobileApiHealth | null;
  tempKeyProbe: MobileTempKeyProbe | null;
  pipelineSessions: SessionRecord[];
  connectionLabel: string;
  connectionDetail: string;
  pipelineSummary: string[];
  activeLaneCount: number;
  readyArtifactCount: number;
  error: string | null;
  isRefreshing: boolean;
  refreshWorkspace: () => Promise<void>;
  probeTempKey: () => Promise<void>;
}

export function useRecorderPreview(): RecorderPreviewState {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [apiHealth, setApiHealth] = useState<MobileApiHealth | null>(null);
  const [pipelineSessions, setPipelineSessions] = useState<SessionRecord[]>([]);
  const [tempKeyProbe, setTempKeyProbe] = useState<MobileTempKeyProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhaseIndex((current) => (current + 1) % recorderPhases.length);
    }, 2600);

    return () => clearInterval(timer);
  }, []);

  async function refreshWorkspace() {
    setIsRefreshing(true);
    try {
      const [health, sessions] = await Promise.all([
        fetchWorkspaceHealth(),
        fetchWorkspaceSessions()
      ]);

      setApiHealth(health);
      setPipelineSessions(sessions);
      setError(null);
    } catch (refreshError) {
      setApiHealth(null);
      setPipelineSessions([localFallbackSession]);
      setError(
        refreshError instanceof Error ? refreshError.message : "Failed to refresh workspace"
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function probeTempKey() {
    const targetSession = pipelineSessions[0] ?? localFallbackSession;

    try {
      const payload = await requestSonioxTempKey(targetSession.id);
      setTempKeyProbe(payload);
      setError(null);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : "Temp-key probe failed");
    }
  }

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  const sourceSession = pipelineSessions[0] ?? localFallbackSession;
  const phase = recorderPhases[phaseIndex] ?? "recording_foreground";
  const phaseSnapshot = buildRecorderDomainSnapshot({
    phase,
    session: sourceSession
  });
  const session = phaseSnapshot.session;

  const activeLaneCount = pipelineSessions.filter((item) =>
    ["recording", "uploading", "transcribing", "summarizing", "emailing"].includes(item.status)
  ).length;
  const readyArtifactCount = pipelineSessions.reduce(
    (count, item) =>
      count + item.artifacts.filter((artifact) => artifact.status === "ready").length,
    0
  );

  const connectionLabel = apiHealth?.ok ? "connected" : "fallback";
  const connectionDetail = apiHealth
    ? `${apiHealth.service} healthy at ${new Date(apiHealth.now).toLocaleTimeString()}`
    : "local demo data with API fallback";
  const pipelineSummary = [
    `${pipelineSessions.length} session(s) loaded from API`,
    `${activeLaneCount} active lane(s) across recording and upload`,
    `${readyArtifactCount} artifact(s) ready for review`,
    ...phaseSnapshot.progressSummary
  ];

  return {
    session,
    phaseSnapshot,
    apiHealth,
    tempKeyProbe,
    pipelineSessions,
    connectionLabel,
    connectionDetail,
    pipelineSummary,
    activeLaneCount,
    readyArtifactCount,
    error,
    isRefreshing,
    refreshWorkspace,
    probeTempKey
  };
}
