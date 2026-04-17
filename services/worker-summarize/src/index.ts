import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import type { SessionMode } from "@mystt/audio-core";
import {
  getNotesPrompt,
  getNotesSchemaForMode,
  getResponseShape
} from "@mystt/notes-schema";

import { loadRepoEnv, readJsonFile, requireEnv } from "../../../scripts/env";
import type { NormalizedSonioxTranscript } from "../../worker-transcribe/src/index";

export interface NotesGenerationInput {
  mode: SessionMode;
  title: string;
  transcript: NormalizedSonioxTranscript;
  project?: string;
  dryRun?: boolean;
}

export interface NotesGenerationResult {
  mode: SessionMode;
  model: string;
  prompt: string;
  responseShape: string;
  transcript: string;
  notes: unknown;
  dryRun: boolean;
}

type JsonSchemaResponseFormat = {
  type: "json_schema";
  name: string;
  strict: true;
  schema: Record<string, unknown>;
  description?: string;
};

function formatTranscriptForPrompt(
  transcript: NormalizedSonioxTranscript,
  title: string
): string {
  const header = [`Title: ${title}`, `Transcription ID: ${transcript.transcriptionId}`];
  const lines = transcript.segments.map((segment) => {
    const speaker = segment.speaker ?? "Unknown speaker";
    return `${speaker}: ${segment.text}`;
  });

  return [...header, "", ...lines].join("\n");
}

function buildSchema(mode: SessionMode): JsonSchemaResponseFormat {
  const baseEvidence = {
    type: "object",
    additionalProperties: false,
    properties: {
      speaker: { type: ["string", "null"] },
      quote: { type: "string" },
      timestampRange: { type: "string" }
    },
    required: ["speaker", "quote", "timestampRange"]
  } as const;

  const meetingSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["meeting"] },
      title: { type: "string" },
      summary: { type: "string" },
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            decision: { type: "string" },
            rationale: { type: ["string", "null"] },
            evidence: baseEvidence
          },
          required: ["decision", "rationale", "evidence"]
        }
      },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            task: { type: "string" },
            owner: { type: ["string", "null"] },
            dueDate: { type: ["string", "null"] },
            evidence: baseEvidence
          },
          required: ["task", "owner", "dueDate", "evidence"]
        }
      },
      risks: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
      nextAgenda: { type: "array", items: { type: "string" } },
      speakerHighlights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            speaker: { type: "string" },
            summary: { type: "string" }
          },
          required: ["speaker", "summary"]
        }
      }
    },
    required: [
      "mode",
      "title",
      "summary",
      "decisions",
      "actionItems",
      "risks",
      "openQuestions",
      "nextAgenda",
      "speakerHighlights"
    ]
  } as const;

  const speechSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
      mode: { type: "string", enum: ["speech"] },
      title: { type: "string" },
      summary: { type: "string" },
      keyMessages: { type: "array", items: { type: "string" } },
      quotableLines: { type: "array", items: { type: "string" } },
      sectionSummaries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            section: { type: "string" },
            summary: { type: "string" }
          },
          required: ["section", "summary"]
        }
      },
      audienceQna: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            answer: { type: "string" }
          },
          required: ["question", "answer"]
        }
      }
    },
    required: [
      "mode",
      "title",
      "summary",
      "keyMessages",
      "quotableLines",
      "sectionSummaries",
      "audienceQna"
    ]
  } as const;

  const interviewSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
      mode: { type: "string", enum: ["interview"] },
      title: { type: "string" },
      summary: { type: "string" },
      keyInsights: { type: "array", items: { type: "string" } },
      questionAnswerPairs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            answer: { type: "string" }
          },
          required: ["question", "answer"]
        }
      },
      followUpQuestions: { type: "array", items: { type: "string" } },
      sensitiveStatements: { type: "array", items: { type: "string" } }
    },
    required: [
      "mode",
      "title",
      "summary",
      "keyInsights",
      "questionAnswerPairs",
      "followUpQuestions",
      "sensitiveStatements"
    ]
  } as const;

  const schemaByMode = {
    meeting: meetingSchema,
    speech: speechSchema,
    interview: interviewSchema
  } as const satisfies Record<SessionMode, Record<string, unknown>>;

  return {
    type: "json_schema",
    name: `${mode}_notes`,
    strict: true,
    schema: schemaByMode[mode]
  };
}

function extractJsonText(response: any): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output_text.");
}

async function callOpenAI(input: NotesGenerationInput): Promise<NotesGenerationResult> {
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const transcriptText = formatTranscriptForPrompt(input.transcript, input.title);
  const prompt = getNotesPrompt(input.mode);
  const responseShape = getResponseShape(input.mode);

  if (input.dryRun) {
    const schema = getNotesSchemaForMode(input.mode);
    return {
      mode: input.mode,
      model,
      prompt,
      responseShape,
      transcript: transcriptText,
      notes: schema.parse(
        input.mode === "meeting"
          ? {
              mode: "meeting",
              title: input.title,
              summary: "Dry run summary.",
              decisions: [],
              actionItems: [],
              risks: [],
              openQuestions: [],
              nextAgenda: [],
              speakerHighlights: []
            }
          : input.mode === "speech"
            ? {
                mode: "speech",
                title: input.title,
                summary: "Dry run summary.",
                keyMessages: ["Placeholder 1", "Placeholder 2", "Placeholder 3"],
                quotableLines: [],
                sectionSummaries: [],
                audienceQna: []
              }
            : {
                mode: "interview",
                title: input.title,
                summary: "Dry run summary.",
                keyInsights: [],
                questionAnswerPairs: [],
                followUpQuestions: [],
                sensitiveStatements: []
              }
      ),
      dryRun: true
    };
  }

  const apiKey = requireEnv("OPENAI_API_KEY");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: transcriptText
            }
          ]
        }
      ],
      text: {
        format: buildSchema(input.mode)
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  const parsed = JSON.parse(extractJsonText(json));
  const notes = getNotesSchemaForMode(input.mode).parse(parsed);

  return {
    mode: input.mode,
    model,
    prompt,
    responseShape,
    transcript: transcriptText,
    notes,
    dryRun: false
  };
}

export async function summarizeTranscript(
  input: NotesGenerationInput
): Promise<NotesGenerationResult> {
  return callOpenAI(input);
}

export async function runSummarizeCli(argv = process.argv.slice(2)) {
  loadRepoEnv();

  const { values } = parseArgs({
    options: {
      mode: { type: "string", default: "meeting" },
      title: { type: "string", default: "Untitled Session" },
      transcript_file: { type: "string" },
      transcript_text: { type: "string" },
      dry_run: { type: "boolean", default: false }
    },
    args: argv,
    strict: false
  });

  const mode = String(values.mode ?? "meeting") as SessionMode;
  const title = String(values.title ?? "Untitled Session");
  const transcriptFile = values.transcript_file
    ? String(values.transcript_file)
    : undefined;
  const transcriptText = values.transcript_text
    ? String(values.transcript_text)
    : undefined;

  const transcript = transcriptFile
    ? readJsonFile<NormalizedSonioxTranscript>(transcriptFile)
    : transcriptText
      ? {
          transcriptionId: `manual_${Date.now()}`,
          sessionId: `manual_${Date.now()}`,
          languageHints: ["ko", "en"],
          tokens: [],
          segments: [
            {
              id: "seg_1",
              speaker: "Speaker 1",
              startMs: 0,
              endMs: 0,
              text: transcriptText,
              confidence: 1,
              tokens: []
            }
          ]
        }
      : undefined;

  if (!transcript) {
    throw new Error("Provide --transcript_file or --transcript_text.");
  }

  const result = await summarizeTranscript({
    mode,
    title,
    transcript,
    dryRun: Boolean(values.dry_run)
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runSummarizeCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
