import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "mystt Recorder",
  slug: "mystt-recorder",
  scheme: "mystt",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  experiments: {
    typedRoutes: true
  },
  ios: {
    bundleIdentifier: "com.mystt.recorder",
    icon: "./assets/icon.png",
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription:
        "회의 녹음과 실시간 자막 생성을 위해 마이크 접근이 필요합니다."
    }
  },
  android: {
    package: "com.mystt.recorder",
    permissions: ["RECORD_AUDIO", "FOREGROUND_SERVICE", "WAKE_LOCK"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0B1020"
    }
  },
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#0B1020"
  },
  web: {
    favicon: "./assets/icon.png"
  },
  extra: {
    recorder: {
      backgroundAudioMode: "audio",
      uploadStrategy: "rolling-chunks",
      sessionContract: "local-first source of truth",
      targetDurationMinutes: 120,
      estimatedBitRate: 64000
    },
    nativeScaffolds: {
      ios: "apps/mobile/native/ios/Info.plist.scaffold.plist",
      android: "apps/mobile/native/android/AndroidManifest.scaffold.xml"
    }
  },
  plugins: [
    "expo-router",
    "expo-audio",
    [
      "expo-dev-client",
      {
        launchMode: "last-opened"
      }
    ]
  ]
};

export default config;
