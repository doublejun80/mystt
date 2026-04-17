export const sessionModes = ["meeting", "speech", "interview"] as const;
export type SessionMode = (typeof sessionModes)[number];

export const sessionStatuses = [
  "draft",
  "recording",
  "paused",
  "uploading",
  "transcribing",
  "summarizing",
  "emailing",
  "completed",
  "failed"
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const artifactKinds = [
  "raw_transcript_json",
  "clean_transcript_md",
  "meeting_notes_json",
  "meeting_notes_html",
  "meeting_notes_docx",
  "email_preview_html"
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export interface Participant {
  id: string;
  name: string;
  role?: string;
}

export interface RecordingProfile {
  chunkMinutes: number;
  uploadStrategy: "session-end" | "rolling-chunks";
  backgroundSurvivalCritical: boolean;
  allowForegroundRealtime: boolean;
  minimumBatteryPercentToStream: number;
}

export interface ArtifactRecord {
  kind: ArtifactKind;
  status: "pending" | "ready" | "failed";
  location?: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  projectKey?: string;
  participants: Participant[];
  languageHints: string[];
  localAudioPath: string;
  profile: RecordingProfile;
  realtimePolicy: "foreground-only" | "disabled";
  pendingChunkCount: number;
  artifacts: ArtifactRecord[];
}

const defaultProfiles: Record<SessionMode, RecordingProfile> = {
  meeting: {
    chunkMinutes: 10,
    uploadStrategy: "rolling-chunks",
    backgroundSurvivalCritical: true,
    allowForegroundRealtime: true,
    minimumBatteryPercentToStream: 25
  },
  speech: {
    chunkMinutes: 15,
    uploadStrategy: "session-end",
    backgroundSurvivalCritical: true,
    allowForegroundRealtime: true,
    minimumBatteryPercentToStream: 20
  },
  interview: {
    chunkMinutes: 10,
    uploadStrategy: "rolling-chunks",
    backgroundSurvivalCritical: true,
    allowForegroundRealtime: true,
    minimumBatteryPercentToStream: 25
  }
};

export function getDefaultRecordingProfile(mode: SessionMode): RecordingProfile {
  return defaultProfiles[mode];
}

export function createSessionRecord(input: {
  id: string;
  title: string;
  mode: SessionMode;
  startedAt?: string;
  projectKey?: string;
  participants?: Participant[];
  languageHints?: string[];
  localAudioPath?: string;
}): SessionRecord {
  const profile = getDefaultRecordingProfile(input.mode);

  return {
    id: input.id,
    title: input.title,
    mode: input.mode,
    status: "draft",
    startedAt: input.startedAt ?? new Date().toISOString(),
    projectKey: input.projectKey,
    participants: input.participants ?? [],
    languageHints: input.languageHints ?? ["ko", "en"],
    localAudioPath:
      input.localAudioPath ?? `recordings/${input.id}/source-${input.id}.m4a`,
    profile,
    realtimePolicy: profile.allowForegroundRealtime
      ? "foreground-only"
      : "disabled",
    pendingChunkCount: 0,
    artifacts: artifactKinds.map((kind) => ({
      kind,
      status: "pending"
    }))
  };
}

export function buildRollingChunkPlan(
  durationMinutes: number,
  chunkMinutes: number
): Array<{ index: number; startMs: number; endMs: number }> {
  const safeChunkMinutes = Math.max(1, chunkMinutes);
  const totalChunks = Math.max(1, Math.ceil(durationMinutes / safeChunkMinutes));

  return Array.from({ length: totalChunks }, (_, index) => {
    const startMinutes = index * safeChunkMinutes;
    const endMinutes = Math.min(durationMinutes, startMinutes + safeChunkMinutes);

    return {
      index,
      startMs: startMinutes * 60_000,
      endMs: endMinutes * 60_000
    };
  });
}

export function canOpenRealtimeStream(input: {
  isForeground: boolean;
  batteryPercent: number;
  session: SessionRecord;
}): boolean {
  return (
    input.isForeground &&
    input.session.realtimePolicy === "foreground-only" &&
    input.batteryPercent >= input.session.profile.minimumBatteryPercentToStream &&
    (input.session.status === "recording" || input.session.status === "paused")
  );
}

export function deriveOperationalChecklist(session: SessionRecord): string[] {
  const items = [
    "Ensure local audio path exists before starting upload.",
    "Keep async transcript as the only source for final notes."
  ];

  if (session.profile.backgroundSurvivalCritical) {
    items.push("Collect real-device background audio evidence before release.");
  }

  if (session.profile.uploadStrategy === "rolling-chunks") {
    items.push("Verify chunk rotation and chunk-level retry behavior.");
  }

  return items;
}

export function createDemoSessions(): SessionRecord[] {
  return [
    {
      ...createSessionRecord({
        id: "sess_demo_meeting",
        title: "Q2 Launch Sync",
        mode: "meeting",
        startedAt: "2026-04-09T09:30:00.000Z",
        projectKey: "launch",
        participants: [
          { id: "p_1", name: "Mina", role: "PM" },
          { id: "p_2", name: "Jisoo", role: "Design" },
          { id: "p_3", name: "Alex", role: "Eng" }
        ]
      }),
      status: "summarizing",
      pendingChunkCount: 1
    },
    {
      ...createSessionRecord({
        id: "sess_demo_speech",
        title: "Founder Townhall",
        mode: "speech",
        startedAt: "2026-04-09T07:00:00.000Z",
        projectKey: "org"
      }),
      status: "completed",
      pendingChunkCount: 0
    }
  ];
}
