import { StatusBar } from "expo-status-bar";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { modeLabels } from "@mystt/ui-kit";

import { useNativeRecorder } from "../src/features/recorder/use-native-recorder";
import { mobileEnv } from "../src/lib/env";

export default function RecorderHomeScreen() {
  const recorder = useNativeRecorder();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="light" />

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>MYSTT MOBILE RECORDER</Text>
        <Text style={styles.title}>화면이 꺼져도 살아남는 로컬 녹음기</Text>
        <Text style={styles.subtitle}>
          모바일 브라우저가 아니라 네이티브 레코더 기준으로 원본 오디오를 먼저 살리고,
          그다음 업로드 파이프라인을 이어갑니다.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>새 세션</Text>
        <TextInput
          value={recorder.draftTitle}
          onChangeText={recorder.setDraftTitle}
          placeholder="회의 제목"
          placeholderTextColor="#6d7392"
          style={styles.input}
        />
        <TextInput
          value={recorder.draftProjectKey}
          onChangeText={recorder.setDraftProjectKey}
          placeholder="프로젝트 키"
          placeholderTextColor="#6d7392"
          style={styles.input}
        />
        <View style={styles.modeRow}>
          {(["meeting", "speech", "interview"] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => recorder.setMode(mode)}
              style={[
                styles.modeChip,
                recorder.mode === mode ? styles.modeChipActive : null
              ]}
            >
              <Text
                style={[
                  styles.modeChipText,
                  recorder.mode === mode ? styles.modeChipTextActive : null
                ]}
              >
                {modeLabels[mode]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.statusGrid}>
        <View style={[styles.card, styles.statusCard]}>
          <Text style={styles.cardLabel}>현재 상태</Text>
          <Text style={styles.clock}>
            {formatDuration(recorder.recorderState.durationMillis)}
          </Text>
          <Text style={styles.statusLine}>
            전송 상태: <Text style={styles.statusValue}>{recorder.transportState}</Text>
          </Text>
          <Text style={styles.statusLine}>
            녹음 단계: <Text style={styles.statusValue}>{recorder.recorderSnapshot.machine.label}</Text>
          </Text>
          <Text style={styles.helper}>{recorder.recorderSnapshot.machine.description}</Text>
        </View>

        <View style={[styles.card, styles.statusCard]}>
          <Text style={styles.cardLabel}>생존성</Text>
          <Text style={styles.statusLine}>
            백그라운드 녹음:{" "}
            <Text style={styles.statusValue}>
              {recorder.recorderSnapshot.machine.canContinueBackground ? "가능" : "불가"}
            </Text>
          </Text>
          <Text style={styles.statusLine}>
            권한 상태: <Text style={styles.statusValue}>{recorder.permissionLabel}</Text>
          </Text>
          <Text style={styles.statusLine}>
            서버 큐 상태: <Text style={styles.statusValue}>{recorder.pipelineState}</Text>
          </Text>
          <Text style={styles.statusLine}>
            마지막 앱 상태: <Text style={styles.statusValue}>{recorder.lastKnownAppState}</Text>
          </Text>
          <Text style={styles.statusLine}>
            2시간 예상 용량:{" "}
            <Text style={styles.statusValue}>{recorder.estimatedTwoHourSizeMb}MB</Text>
          </Text>
          <Text style={styles.statusLine}>
            롤링 청크 수:{" "}
            <Text style={styles.statusValue}>
              {recorder.recorderSnapshot.chunkPlan.length}개
            </Text>
          </Text>
          <Text style={styles.statusLine}>
            background 전환:{" "}
            <Text style={styles.statusValue}>{recorder.backgroundTransitionCount}회</Text>
          </Text>
          <Text style={styles.helper}>{recorder.survivalSummary.headline}</Text>
          <Text style={styles.helper}>{recorder.survivalSummary.detail}</Text>
        </View>
      </View>

      {recorder.recoverySnapshot ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>복구 후보</Text>
          <Text style={styles.recordingTitle}>{recorder.recoverySnapshot.session.title}</Text>
          <Text style={styles.recordingSubtitle}>
            {recorder.recoverySnapshot.transportState} ·{" "}
            {recorder.recoverySnapshot.phase} ·{" "}
            {formatDateTime(recorder.recoverySnapshot.updatedAt)}
          </Text>
          <Text style={styles.statusLine}>
            마지막 앱 상태:{" "}
            <Text style={styles.statusValue}>
              {recorder.recoverySnapshot.lastKnownAppState}
            </Text>
          </Text>
          <Text style={styles.statusLine}>
            background 전환:{" "}
            <Text style={styles.statusValue}>
              {recorder.recoverySnapshot.backgroundTransitionCount}회
            </Text>
          </Text>
          <Text style={styles.statusLine}>
            선택 입력:{" "}
            <Text style={styles.statusValue}>
              {recorder.recoverySnapshot.selectedInput?.label ?? "기본 마이크"}
            </Text>
          </Text>
          <Text style={styles.recordingPath}>{recorder.runtimeStatePath}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>입력 장치</Text>
        {recorder.availableInputs.length > 0 ? (
          <View style={styles.inputChipWrap}>
            {recorder.availableInputs.map((input) => (
              <Pressable
                key={input.uid}
                onPress={() => recorder.selectInput(input.uid)}
                style={[
                  styles.inputChip,
                  recorder.selectedInputUid === input.uid ? styles.inputChipActive : null
                ]}
              >
                <Text
                  style={[
                    styles.inputChipTitle,
                    recorder.selectedInputUid === input.uid ? styles.inputChipTitleActive : null
                  ]}
                >
                  {input.label}
                </Text>
                <Text style={styles.inputChipMeta}>{input.type}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.helper}>
            아직 입력 장치 목록이 비어 있습니다. 폰에서는 기본 마이크가 바로 선택될 수
            있습니다.
          </Text>
        )}
        <Pressable style={styles.secondaryButton} onPress={() => void recorder.refreshInputs()}>
          <Text style={styles.secondaryButtonText}>입력 장치 새로고침</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>녹음 제어</Text>
        <View style={styles.actionGrid}>
          <ActionButton
            label="녹음 시작"
            enabled={recorder.canStart}
            onPress={() => void recorder.startRecording()}
          />
          <ActionButton
            label="일시정지"
            enabled={recorder.canPause}
            onPress={() => void recorder.pauseRecording()}
          />
          <ActionButton
            label="재개"
            enabled={recorder.canResume}
            onPress={() => void recorder.resumeRecording()}
          />
          <ActionButton
            label="로컬 저장"
            enabled={recorder.canSave}
            onPress={() => void recorder.saveRecording()}
          />
          <ActionButton
            label="서버 큐 등록"
            enabled={recorder.canQueueUpload}
            onPress={() => void recorder.queueLocalRecording()}
          />
          <ActionButton
            label="폐기"
            enabled={recorder.canDiscard}
            tone="danger"
            onPress={() => void recorder.discardRecording()}
          />
        </View>
        <Text style={styles.helper}>
          현재 경로: {recorder.activeSession.localAudioPath}
        </Text>
        <Text style={styles.helper}>런타임 상태: {recorder.runtimeStatePath}</Text>
        {recorder.error ? <Text style={styles.errorText}>{recorder.error}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>운영 포인트</Text>
        {[
          `저장 루트: ${recorder.recorderRootPath}`,
          `복구 상태 파일: ${recorder.runtimeStatePath}`,
          `API 베이스: ${mobileEnv.apiBaseUrl}`,
          `세션 모드: ${modeLabels[recorder.mode]}`,
          `대상 녹음: 120분`,
          `원본 오디오 보존 후 업로드 진행`
        ].map((line) => (
          <Text key={line} style={styles.listItem}>
            {`\u2022 ${line}`}
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>운영 로그</Text>
        {recorder.operationLog.length > 0 ? (
          recorder.operationLog.map((line) => (
            <Text key={line} style={styles.logLine}>
              {line}
            </Text>
          ))
        ) : (
          <Text style={styles.helper}>아직 기록된 동작이 없습니다.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>최근 로컬 저장</Text>
        {recorder.recentRecordings.length > 0 ? (
          recorder.recentRecordings.map((entry) => (
            <View key={entry.session.id} style={styles.recordingRow}>
              <View style={styles.recordingMeta}>
                <Text style={styles.recordingTitle}>{entry.session.title}</Text>
                <Text style={styles.recordingSubtitle}>
                  {modeLabels[entry.session.mode]} · {formatDuration(entry.durationMillis)} ·{" "}
                  {entry.uploadState}
                </Text>
                <Text style={styles.recordingSubtitle}>
                  background {entry.backgroundTransitionCount}회 ·{" "}
                  {entry.selectedInput?.label ?? "기본 마이크"}
                </Text>
                <Text style={styles.recordingSubtitle}>
                  md5 {entry.checksumMd5 ?? "계산 실패"}
                </Text>
                <Text style={styles.recordingPath}>{entry.session.localAudioPath}</Text>
                <Text style={styles.recordingPath}>{entry.sessionJsonPath}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.helper}>저장된 로컬 녹음이 아직 없습니다.</Text>
        )}
      </View>

      {recorder.lastSavedEntry ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>마지막 저장본</Text>
          <Text style={styles.recordingTitle}>{recorder.lastSavedEntry.session.title}</Text>
          <Text style={styles.recordingSubtitle}>
            {formatDuration(recorder.lastSavedEntry.durationMillis)} ·{" "}
            {recorder.lastSavedEntry.sizeBytes
              ? `${Math.round(recorder.lastSavedEntry.sizeBytes / 1024 / 1024)}MB`
              : "크기 확인 중"}
          </Text>
          <Text style={styles.recordingSubtitle}>
            background {recorder.lastSavedEntry.backgroundTransitionCount}회 ·{" "}
            {recorder.lastSavedEntry.selectedInput?.label ?? "기본 마이크"}
          </Text>
          <Text style={styles.recordingSubtitle}>
            md5 {recorder.lastSavedEntry.checksumMd5 ?? "계산 실패"}
          </Text>
          <Text style={styles.recordingPath}>{recorder.lastSavedEntry.session.localAudioPath}</Text>
          <Text style={styles.recordingPath}>{recorder.lastSavedEntry.sessionJsonPath}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ActionButton({
  enabled,
  label,
  onPress,
  tone = "primary"
}: {
  enabled: boolean;
  label: string;
  onPress: () => void;
  tone?: "primary" | "danger";
}) {
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      style={[
        styles.button,
        tone === "danger" ? styles.buttonDanger : styles.buttonPrimary,
        !enabled ? styles.buttonDisabled : null
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function formatDuration(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#070b17"
  },
  content: {
    padding: 20,
    gap: 16
  },
  hero: {
    gap: 10,
    paddingTop: 24
  },
  eyebrow: {
    color: "#7f86a8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2
  },
  title: {
    color: "#f5f7ff",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 42
  },
  subtitle: {
    color: "#a6b0d5",
    fontSize: 16,
    lineHeight: 24
  },
  card: {
    backgroundColor: "#0f1528",
    borderColor: "#1f2945",
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    gap: 12
  },
  cardLabel: {
    color: "#7f86a8",
    fontSize: 13,
    fontWeight: "700"
  },
  input: {
    borderColor: "#223054",
    borderWidth: 1,
    borderRadius: 16,
    color: "#f5f7ff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#121a31"
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  modeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a3558",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#121a31"
  },
  modeChipActive: {
    backgroundColor: "#3550ff",
    borderColor: "#5870ff"
  },
  modeChipText: {
    color: "#c6d0f5",
    fontSize: 15,
    fontWeight: "700"
  },
  modeChipTextActive: {
    color: "#ffffff"
  },
  statusGrid: {
    gap: 12
  },
  statusCard: {
    flex: 1
  },
  clock: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "800"
  },
  statusLine: {
    color: "#aeb9df",
    fontSize: 15,
    lineHeight: 22
  },
  statusValue: {
    color: "#f5f7ff",
    fontWeight: "700"
  },
  helper: {
    color: "#8e9ac3",
    fontSize: 14,
    lineHeight: 21
  },
  inputChipWrap: {
    gap: 10
  },
  inputChip: {
    borderWidth: 1,
    borderColor: "#2a3558",
    borderRadius: 18,
    backgroundColor: "#121a31",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4
  },
  inputChipActive: {
    borderColor: "#5b72ff",
    backgroundColor: "#1a2454"
  },
  inputChipTitle: {
    color: "#f5f7ff",
    fontSize: 15,
    fontWeight: "700"
  },
  inputChipTitleActive: {
    color: "#ffffff"
  },
  inputChipMeta: {
    color: "#8e9ac3",
    fontSize: 13
  },
  secondaryButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2a3558",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  secondaryButtonText: {
    color: "#d7def8",
    fontSize: 14,
    fontWeight: "700"
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  button: {
    minWidth: 116,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  buttonPrimary: {
    backgroundColor: "#3550ff"
  },
  buttonDanger: {
    backgroundColor: "#3a2030"
  },
  buttonDisabled: {
    opacity: 0.38
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center"
  },
  errorText: {
    color: "#ff9bb2",
    fontSize: 14,
    lineHeight: 20
  },
  listItem: {
    color: "#c6d0f5",
    fontSize: 15,
    lineHeight: 22
  },
  logLine: {
    color: "#cdd6fa",
    fontSize: 14,
    lineHeight: 20
  },
  recordingRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2945",
    backgroundColor: "#11172c",
    padding: 14
  },
  recordingMeta: {
    gap: 4
  },
  recordingTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800"
  },
  recordingSubtitle: {
    color: "#8e9ac3",
    fontSize: 14
  },
  recordingPath: {
    color: "#6f7aa6",
    fontSize: 12,
    lineHeight: 18
  }
});
