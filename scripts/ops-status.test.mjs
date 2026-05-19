import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpsStatus } from "./ops-status.mjs";

test("buildOpsStatus reports restart hints and narrow public ingress checks", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://mystt.example/health" || url === "https://mystt.example/ready") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, service: "api" })
      };
    }

    if (url.includes("/minio") || url.includes("/mailpit") || url.includes("/portainer")) {
      return {
        ok: false,
        status: 404,
        text: async () => "not found"
      };
    }

    return {
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ ok: false })
    };
  };
  const execFileImpl = async (_command, args) => {
    if (args.includes("worker-session")) {
      throw new Error("not found");
    }

    return { stdout: "123 mystt-api-4100\n" };
  };

  const status = await buildOpsStatus({
    fetchImpl,
    execFileImpl,
    publicBaseUrl: "https://mystt.example"
  });

  assert.equal(status.ok, false);
  assert.equal(status.checks.find((check) => check.label === "public health")?.publicMinimal, true);
  assert.equal(
    status.checks.find((check) => check.label === "public minio exposure")?.ok,
    true
  );
  assert.match(
    status.recovery.find((item) => item.label === "session worker")?.restart ?? "",
    /worker-session/
  );
});

test("buildOpsStatus rejects admin-service redirects on the public hostname", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://mystt.example/health" || url === "https://mystt.example/ready") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, service: "api" })
      };
    }

    return {
      ok: false,
      status: 302,
      headers: {
        get: () => "https://mystt.example/portainer/login"
      },
      text: async () => ""
    };
  };
  const execFileImpl = async () => ({ stdout: "123 mystt-api-4100\n" });

  const status = await buildOpsStatus({
    fetchImpl,
    execFileImpl,
    publicBaseUrl: "https://mystt.example"
  });

  assert.equal(status.checks.find((check) => check.label === "public portainer exposure")?.ok, false);
});
