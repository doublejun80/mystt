import { spawnSync } from "node:child_process";

const publicBaseUrl = (
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://mystt.doublejun.digital"
).replace(/\/$/, "");
const ownerEmail = process.env.MYSTT_OWNER_EMAIL?.trim();
const ownerPassword = process.env.MYSTT_OWNER_PASSWORD?.trim();

async function probe(label, url, expectedStatus = 200) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json, text/html"
      },
      signal: AbortSignal.timeout(10_000)
    });

    const ok = response.status === expectedStatus;
    return {
      label,
      ok,
      status: response.status,
      url
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: error instanceof Error ? error.message : String(error),
      url
    };
  }
}

function assertStatus(label, response, expectedStatus) {
  const ok = response.status === expectedStatus;
  return {
    label,
    ok,
    status: response.status,
    url: response.url
  };
}

function cookiePairsFromHeaders(headers) {
  return setCookieValues(headers).flatMap((value) => {
    if (!value) {
      return [];
    }

    const firstPart = value.split(";")[0];
    const equalsIndex = firstPart.indexOf("=");
    if (equalsIndex === -1) {
      return [];
    }

    return [
      {
        name: firstPart.slice(0, equalsIndex),
        value: firstPart.slice(equalsIndex + 1)
      }
    ];
  });
}

function setCookieValues(headers) {
  return (
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : []
  );
}

function hasClearingCookie(headers, name) {
  return setCookieValues(headers).some(
    (value) =>
      value.toLowerCase().startsWith(`${name.toLowerCase()}=`) &&
      /(?:^|;\s*)max-age=0(?:;|$)/i.test(value)
  );
}

function storeResponseCookies(cookieJar, headers) {
  for (const cookie of cookiePairsFromHeaders(headers)) {
    if (!cookie.value) {
      cookieJar.delete(cookie.name);
    } else {
      cookieJar.set(cookie.name, cookie.value);
    }
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function ownerAuthMissingCheck() {
  return {
    label: "owner auth env present for public QA",
    ok: false,
    status: "missing MYSTT_OWNER_EMAIL or MYSTT_OWNER_PASSWORD",
    url: publicBaseUrl
  };
}

async function requestJson(path, options = {}, cookieJar) {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (cookieJar && cookieJar.size > 0 && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader(cookieJar));
  }

  const response = await fetch(`${publicBaseUrl}${path}`, {
    ...options,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000)
  });

  if (cookieJar) {
    storeResponseCookies(cookieJar, response.headers);
  }

  return response;
}

async function runOwnerAuthChecks() {
  if (!ownerEmail || !ownerPassword) {
    return [ownerAuthMissingCheck()];
  }

  const cookieJar = new Map();
  const wrongPassword =
    ownerPassword === "definitely-not-the-owner-password"
      ? "definitely-not-the-owner-password-2"
      : "definitely-not-the-owner-password";

  try {
    const wrongLogin = await requestJson("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: ownerEmail,
        password: wrongPassword
      })
    });
    const correctLogin = await requestJson(
      "/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: ownerEmail,
          password: ownerPassword
        })
      },
      cookieJar
    );
    const loginBody = correctLogin.ok ? await correctLogin.json() : {};
    const loginSetOwnerCookie = cookieJar.has("mystt_owner_session");
    const sessionCheck = await requestJson("/v1/auth/session", {}, cookieJar);
    const sessionBody = sessionCheck.ok ? await sessionCheck.json() : {};
    const protectedWithCookie = await requestJson("/v1/sessions", {}, cookieJar);
    const protectedWithBearer = await requestJson("/v1/sessions", {
      headers: {
        authorization: `Bearer ${loginBody.token ?? ""}`
      }
    });
    cookieJar.set("mystt_qa_token", "legacy-qa-cookie-to-clear");
    const logout = await requestJson(
      "/v1/auth/logout",
      {
        method: "POST"
      },
      cookieJar
    );
    const protectedAfterLogout = await requestJson("/v1/sessions", {}, cookieJar);

    return [
      assertStatus("wrong owner password is rejected", wrongLogin, 401),
      {
        ...assertStatus("correct owner password logs in", correctLogin, 200),
        ok:
          correctLogin.status === 200 &&
          loginBody.authenticated === true &&
          loginSetOwnerCookie
      },
      {
        ...assertStatus("owner session persists through cookie", sessionCheck, 200),
        ok: sessionCheck.status === 200 && sessionBody.authenticated === true
      },
      assertStatus("authenticated owner can read sessions API", protectedWithCookie, 200),
      assertStatus("authenticated owner bearer can read sessions API", protectedWithBearer, 200),
      {
        ...assertStatus("logout clears owner and legacy QA cookies", logout, 204),
        ok:
          logout.status === 204 &&
          hasClearingCookie(logout.headers, "mystt_owner_session") &&
          hasClearingCookie(logout.headers, "mystt_qa_token")
      },
      assertStatus("protected sessions API rejects after logout", protectedAfterLogout, 401)
    ];
  } catch (error) {
    return [
      {
        label: "owner auth flow",
        ok: false,
        status: error instanceof Error ? error.message : String(error),
        url: publicBaseUrl
      }
    ];
  }
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  if (result.error) {
    return "";
  }

  return `${result.stdout}${result.stderr}`.trim();
}

function listIosDevices() {
  const output = commandOutput("xcrun", ["xctrace", "list", "devices"]);
  if (!output) {
    return ["xcrun unavailable"];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("==") &&
        !line.includes("Simulator") &&
        !line.includes("Mac")
    );
}

function listAndroidDevices() {
  const output = commandOutput("adb", ["devices"]);
  if (!output) {
    return ["adb unavailable or no Android device"];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"));
}

const preflightChecks = await Promise.all([
  probe("public portal", `${publicBaseUrl}/`),
  probe("public health", `${publicBaseUrl}/health`),
  probe("public sessions API requires auth", `${publicBaseUrl}/v1/sessions`, 401),
  probe("Portainer public ingress closed", "https://portainer.doublejun.digital/", 404)
]);
const authChecks = await runOwnerAuthChecks();
const checks = [...preflightChecks, ...authChecks];

const failed = checks.filter((check) => !check.ok);

console.log("\n[mystt] Mobile public QA");
console.log(`Base URL: ${publicBaseUrl}\n`);

console.log("Preflight");
for (const check of preflightChecks) {
  console.log(
    `- ${check.ok ? "OK" : "FAIL"} ${check.label}: ${check.status} ${check.url}`
  );
}

console.log("\nOwner auth");
for (const check of authChecks) {
  console.log(
    `- ${check.ok ? "OK" : "FAIL"} ${check.label}: ${check.status} ${check.url}`
  );
}

console.log("\niOS devices");
for (const device of listIosDevices()) {
  console.log(`- ${device}`);
}

console.log("\nAndroid devices");
for (const device of listAndroidDevices()) {
  console.log(`- ${device}`);
}

console.log(`
Start Metro for the dev client

  EXPO_PUBLIC_API_BASE_URL=${publicBaseUrl} pnpm --filter @mystt/mobile dev:client

Quick mobile STT test script

1. Open the dev client on the physical device.
2. Confirm the app shows API base: ${publicBaseUrl}
3. Tap permission / microphone allow.
4. Start recording and read this for 3-4 minutes:

   안녕하세요. 지금부터 mystt 모바일 실기기 녹음 테스트를 시작합니다.
   이 테스트의 목적은 화면이 꺼져도 원본 오디오가 안전하게 살아남는지,
   그리고 저장된 오디오가 서버로 업로드되어 Soniox 전사와 OpenAI 회의록 생성까지 이어지는지 확인하는 것입니다.

   첫 번째 확인 항목은 로컬 원본 오디오 보존입니다.
   네트워크가 끊기거나 앱이 백그라운드로 내려가도 녹음 파일은 먼저 기기 안에 저장되어야 합니다.
   업로드가 끝나고 해시 검증이 끝나기 전에는 원본 파일을 삭제하면 안 됩니다.

   두 번째 확인 항목은 백그라운드 전환입니다.
   지금부터 앱을 홈 화면으로 내리고 화면을 잠근 뒤 다시 돌아오겠습니다.
   돌아왔을 때 녹음 시간이 계속 증가했는지, background transition count가 증가했는지 확인합니다.

   세 번째 확인 항목은 서버 큐 등록입니다.
   저장된 오디오는 https mystt dot doublejun dot digital 주소로 업로드됩니다.
   업로드 뒤에는 session process queue에 등록되고, 처리 완료 후 meeting notes v2 JSON이 생성되어야 합니다.

   정정 테스트도 넣겠습니다.
   방금 업로드 진행률이 92.7퍼센트라고 말했지만, 정확히는 97.2퍼센트입니다.
   이 정정 내용이 전사와 회의록에 남는지 확인합니다.

   영어와 숫자 인식도 확인합니다.
   Soniox, OpenAI, MinIO, Postgres, webhook, idempotency key, meeting_notes_v2, Q3 roadmap.
   테스트 세션 이름은 Mobile QA dash V2 dash 0518입니다.
   파일 크기 예시는 384.6메가바이트이고, 목표 처리 시간은 20분 오디오 기준 4분 이내입니다.

   이제 녹음을 종료하고 로컬 저장, 서버 큐 등록, 회의록 생성, cleanup 상태를 확인하겠습니다.

5. While recording, run the minimum background check:
   - Lock the screen for 3 minutes.
   - Unlock and confirm duration continued.
   - Confirm operational log includes background and foreground.
6. Save locally.
7. Queue/upload to server.
8. Confirm these evidence fields in the app:
   - local recording path
   - checksumMd5
   - session.json path
   - backgroundTransitionCount
   - uploadState queued or uploaded
   - remoteSessionId
   - remoteFileId
9. Open ${publicBaseUrl} on desktop/mobile browser and confirm the new session appears.
10. Open session detail and confirm:
   - source audio link exists
   - transcript exists
   - meeting_notes_v2 exists
   - topics/open issues/risks/evidenceRefs render
   - Soniox cleanup status is recorded after completion

Pass criteria

- No source audio loss.
- Recording survives at least one lock-screen interval.
- Upload and process path completes or leaves a retryable failed state.
- Original local recording is still present after upload handoff.
- v2 notes are schema-shaped JSON before HTML/DOCX rendering.

Rollback

- Stop Metro with Ctrl+C.
- Stop public web/API dev servers if QA is done.
- Remove mystt.doublejun.digital Cloudflared ingress if the public window is over.
`);

if (failed.length > 0) {
  process.exit(1);
}
