import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  isInsforgeAdminConfigured,
  isInsforgeConfigured
} from "../config";
import {
  confirmInsforgeUpload,
  ensureInsforgeStorageBuckets,
  fetchInsforgeCurrentSession,
  fetchInsforgePublicAuthConfig,
  getInsforgeRuntimeStatus,
  listInsforgeStorageBuckets,
  refreshInsforgeServerSession,
  requestInsforgeUploadStrategy,
  signInToInsforge,
  signUpToInsforge
} from "../lib/insforge";

function getBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;

  if (!header) {
    return undefined;
  }

  const [scheme, token] = header.split(" ");

  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return undefined;
  }

  return token.trim();
}

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  clientType: z.enum(["web", "mobile", "desktop", "server"]).optional()
});

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1).optional(),
  redirectTo: z.string().url().optional(),
  clientType: z.enum(["web", "mobile", "desktop", "server"]).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  clientType: z.enum(["web", "mobile", "desktop", "server"]).optional()
});

const uploadStrategySchema = z.object({
  bucketName: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative().optional()
});

const confirmUploadSchema = z.object({
  bucketName: z.string().min(1),
  objectKey: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentType: z.string().optional(),
  etag: z.string().optional()
});

function getInsforgeErrorStatus(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;

  if (status && Number.isFinite(status)) {
    return status;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/invalid token/i.test(message)) {
    return 401;
  }

  if (/no refresh token/i.test(message)) {
    return 400;
  }

  if (/invalid credentials|invalid password|unauthorized/i.test(message)) {
    return 401;
  }

  return 502;
}

function getInsforgeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const insforgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/insforge/status", async () => {
    return {
      data: getInsforgeRuntimeStatus()
    };
  });

  app.get("/v1/insforge/auth/public-config", async (_, reply) => {
    if (!isInsforgeConfigured()) {
      return reply.code(503).send({
        message: "InsForge is not configured"
      });
    }

    return {
      data: await fetchInsforgePublicAuthConfig()
    };
  });

  app.post("/v1/insforge/auth/sign-in", async (request, reply) => {
    const input = signInSchema.parse(request.body);
    try {
      return {
        data: await signInToInsforge(input)
      };
    } catch (error) {
      return reply
        .code(getInsforgeErrorStatus(error))
        .send({ message: getInsforgeErrorMessage(error) });
    }
  });

  app.post("/v1/insforge/auth/sign-up", async (request, reply) => {
    const input = signUpSchema.parse(request.body);
    try {
      return {
        data: await signUpToInsforge(input)
      };
    } catch (error) {
      return reply
        .code(getInsforgeErrorStatus(error))
        .send({ message: getInsforgeErrorMessage(error) });
    }
  });

  app.post("/v1/insforge/auth/refresh", async (request, reply) => {
    const input = refreshSchema.parse(request.body);
    try {
      return {
        data: await refreshInsforgeServerSession(input)
      };
    } catch (error) {
      return reply
        .code(getInsforgeErrorStatus(error))
        .send({ message: getInsforgeErrorMessage(error) });
    }
  });

  app.get("/v1/insforge/auth/session", async (request, reply) => {
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return reply.code(401).send({
        message: "Bearer access token is required"
      });
    }

    try {
      return {
        data: await fetchInsforgeCurrentSession(accessToken)
      };
    } catch (error) {
      return reply
        .code(getInsforgeErrorStatus(error))
        .send({ message: getInsforgeErrorMessage(error) });
    }
  });

  app.get("/v1/insforge/storage/buckets", async (_, reply) => {
    if (!isInsforgeAdminConfigured()) {
      return reply.code(503).send({
        message: "InsForge admin storage is not configured"
      });
    }

    return {
      data: await listInsforgeStorageBuckets()
    };
  });

  app.post("/v1/insforge/storage/buckets/ensure", async (_, reply) => {
    if (!isInsforgeAdminConfigured()) {
      return reply.code(503).send({
        message: "InsForge admin storage is not configured"
      });
    }

    return {
      data: await ensureInsforgeStorageBuckets()
    };
  });

  app.post("/v1/insforge/storage/upload-strategy", async (request, reply) => {
    if (!isInsforgeConfigured()) {
      return reply.code(503).send({
        message: "InsForge is not configured"
      });
    }

    const input = uploadStrategySchema.parse(request.body);
    const accessToken = getBearerToken(request);

    return {
      data: await requestInsforgeUploadStrategy({
        ...input,
        accessToken
      })
    };
  });

  app.post("/v1/insforge/storage/confirm-upload", async (request, reply) => {
    if (!isInsforgeConfigured()) {
      return reply.code(503).send({
        message: "InsForge is not configured"
      });
    }

    const input = confirmUploadSchema.parse(request.body);
    const accessToken = getBearerToken(request);

    return {
      data: await confirmInsforgeUpload({
        ...input,
        accessToken
      })
    };
  });
};
