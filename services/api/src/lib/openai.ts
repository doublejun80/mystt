import { toFile } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import type { SessionMode } from "@mystt/audio-core";
import {
  getNotesPrompt,
  getNotesSchemaForMode,
  getNotesSchemaName,
  type SessionNotes
} from "@mystt/notes-schema";

import { apiConfig } from "../config";
import { getOpenAIClient } from "./providers";

export async function generateStructuredNotes(input: {
  mode: SessionMode;
  transcript: string;
  sessionTitle?: string;
}): Promise<SessionNotes> {
  const client = getOpenAIClient();
  const schema = getNotesSchemaForMode(input.mode);

  const completion = await client.chat.completions.parse({
    model: apiConfig.OPENAI_MODEL,
    store: false,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: getNotesPrompt(input.mode)
      },
      {
        role: "user",
        content: [
          input.sessionTitle ? `Session title: ${input.sessionTitle}` : null,
          "Use transcript evidence only. If a field is unknown, return null or omit the item.",
          "Transcript:",
          input.transcript
        ]
          .filter(Boolean)
          .join("\n\n")
      }
    ],
    response_format: zodResponseFormat(schema, getNotesSchemaName(input.mode))
  });

  const parsed = completion.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("OpenAI did not return parsed structured notes.");
  }

  return parsed as SessionNotes;
}

export async function checkOpenAIConnectivity() {
  const client = getOpenAIClient();
  const page = await client.models.list();
  const firstModel = page.data[0];

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    detail: firstModel?.id ?? "reachable"
  };
}

function getFileExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("webm")) {
    return "webm";
  }

  if (normalized.includes("wav")) {
    return "wav";
  }

  if (normalized.includes("ogg")) {
    return "ogg";
  }

  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }

  if (normalized.includes("mp4")) {
    return "mp4";
  }

  return "webm";
}

export async function transcribeAudioChunk(input: {
  audio: Uint8Array;
  mimeType: string;
  chunkId: string;
  language?: string;
  prompt?: string;
}) {
  const client = getOpenAIClient();
  const file = await toFile(
    input.audio,
    `${input.chunkId}.${getFileExtension(input.mimeType)}`,
    { type: input.mimeType }
  );
  const transcription = await client.audio.transcriptions.create({
    file,
    model: apiConfig.OPENAI_AUDIO_MODEL,
    language: input.language,
    prompt: input.prompt,
    response_format: "json",
    temperature: 0
  });

  return {
    text: transcription.text.trim(),
    model: apiConfig.OPENAI_AUDIO_MODEL
  };
}
