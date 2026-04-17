import OpenAI from "openai";
import { SonioxNodeClient } from "@soniox/node";

import { apiConfig, isOpenAIConfigured, isSonioxConfigured } from "../config";

let sonioxClient: SonioxNodeClient | null = null;
let openAIClient: OpenAI | null = null;

export function getSonioxClient(): SonioxNodeClient {
  if (!isSonioxConfigured()) {
    throw new Error("SONIOX_API_KEY is not configured.");
  }

  sonioxClient ??= new SonioxNodeClient({
    api_key: apiConfig.SONIOX_API_KEY
  });

  return sonioxClient;
}

export function getOpenAIClient(): OpenAI {
  if (!isOpenAIConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  openAIClient ??= new OpenAI({
    apiKey: apiConfig.OPENAI_API_KEY
  });

  return openAIClient;
}

