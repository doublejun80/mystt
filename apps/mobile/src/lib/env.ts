import Constants from "expo-constants";

function inferExpoDevApiBaseUrl() {
  const hostUri = Constants.expoConfig?.hostUri;

  if (!hostUri) {
    return null;
  }

  const host = hostUri.split(":")[0];

  if (!host) {
    return null;
  }

  return `http://${host}:4100`;
}

export const mobileEnv = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    inferExpoDevApiBaseUrl() ??
    "http://127.0.0.1:4100",
  appName: "mystt Recorder"
};
