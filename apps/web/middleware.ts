import { NextResponse, type NextRequest } from "next/server";
import { isOwnerSessionTokenValid, OWNER_SESSION_COOKIE } from "./lib/owner-session";

const QA_TOKEN_COOKIE = "mystt_qa_token";
const QA_TOKEN_HEADER = "x-mystt-qa-token";
const QA_TOKEN_QUERY = "qa";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:4100";

function configuredQaToken() {
  return process.env.MYSTT_QA_TOKEN?.trim();
}

function configuredOwnerSecret() {
  const secret = process.env.MYSTT_AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : undefined;
}

function configuredApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function isExemptPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/icon.svg" ||
    pathname === "/robots.txt" ||
    pathname === "/shortcuts" ||
    pathname.startsWith("/shortcuts/") ||
    pathname === "/v1/webhooks/soniox" ||
    pathname.startsWith("/v1/auth/") ||
    pathname.startsWith("/_next/")
  );
}

function unauthorizedResponse(pathname: string) {
  if (pathname.startsWith("/v1/")) {
    return NextResponse.json({ message: "QA access token required" }, { status: 401 });
  }

  return new NextResponse(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mystt QA access</title>
    <style>
      body {
        align-items: center;
        background: #111827;
        color: #f9fafb;
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
      }
      h1 {
        font-size: 1.5rem;
        margin: 0 0 0.75rem;
      }
      p {
        color: #cbd5e1;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>mystt QA 접근 토큰이 필요합니다.</h1>
      <p>테스트 URL에 발급된 QA 토큰을 붙여 다시 열어주세요.</p>
    </main>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8"
      },
      status: 401
    }
  );
}

function extractBearerToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

async function isOwnerSessionAcceptedByApi(cookieHeader: string | null) {
  if (!cookieHeader?.includes(`${OWNER_SESSION_COOKIE}=`)) {
    return false;
  }

  try {
    const response = await fetch(`${configuredApiBaseUrl()}/v1/auth/session`, {
      headers: {
        cookie: cookieHeader
      }
    });

    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as { authenticated?: unknown };
    return body.authenticated === true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const expectedToken = configuredQaToken();
  const ownerSecret = configuredOwnerSecret();
  const bearerToken = extractBearerToken(request.headers.get("authorization"));

  if (isExemptPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const queryToken = request.nextUrl.searchParams.get(QA_TOKEN_QUERY);
  if (queryToken === expectedToken) {
    const url = request.nextUrl.clone();
    url.searchParams.delete(QA_TOKEN_QUERY);
    const response = NextResponse.redirect(url);
    response.cookies.set(QA_TOKEN_COOKIE, expectedToken, {
      httpOnly: true,
      maxAge: 60 * 60 * 12,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:"
    });
    return response;
  }

  if (expectedToken && request.cookies.get(QA_TOKEN_COOKIE)?.value === expectedToken) {
    return NextResponse.next();
  }

  if (
    ownerSecret &&
    ((await isOwnerSessionTokenValid(request.cookies.get(OWNER_SESSION_COOKIE)?.value, {
      secret: ownerSecret
    })) ||
      (await isOwnerSessionTokenValid(bearerToken, {
        secret: ownerSecret
      })))
  ) {
    return NextResponse.next();
  }

  if (await isOwnerSessionAcceptedByApi(request.headers.get("cookie"))) {
    return NextResponse.next();
  }

  if (
    expectedToken &&
    (request.headers.get(QA_TOKEN_HEADER) === expectedToken ||
      bearerToken === expectedToken)
  ) {
    return NextResponse.next();
  }

  if (!request.nextUrl.pathname.startsWith("/v1/")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return unauthorizedResponse(request.nextUrl.pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|icon.png|icon.svg).*)"]
};
