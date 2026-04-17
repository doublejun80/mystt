import type { SessionMode } from "@mystt/audio-core";
import { z } from "zod";

const evidenceSchema = z.object({
  speaker: z.string().nullable(),
  quote: z.string().min(1),
  timestampRange: z.string().min(1)
});

const actionItemSchema = z.object({
  task: z.string().min(1),
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
  evidence: evidenceSchema
});

const decisionSchema = z.object({
  decision: z.string().min(1),
  rationale: z.string().nullable(),
  evidence: evidenceSchema
});

const meetingNotesSchema = z.object({
  mode: z.literal("meeting"),
  title: z.string().min(1),
  summary: z.string().min(1),
  decisions: z.array(decisionSchema),
  actionItems: z.array(actionItemSchema),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  nextAgenda: z.array(z.string()),
  speakerHighlights: z.array(
    z.object({
      speaker: z.string().min(1),
      summary: z.string().min(1)
    })
  )
});

const speechNotesSchema = z.object({
  mode: z.literal("speech"),
  title: z.string().min(1),
  summary: z.string().min(1),
  keyMessages: z.array(z.string().min(1)).min(3).max(7),
  quotableLines: z.array(z.string().min(1)),
  sectionSummaries: z.array(
    z.object({
      section: z.string().min(1),
      summary: z.string().min(1)
    })
  ),
  audienceQna: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1)
    })
  )
});

const interviewNotesSchema = z.object({
  mode: z.literal("interview"),
  title: z.string().min(1),
  summary: z.string().min(1),
  keyInsights: z.array(z.string().min(1)),
  questionAnswerPairs: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1)
    })
  ),
  followUpQuestions: z.array(z.string().min(1)),
  sensitiveStatements: z.array(z.string())
});

export const notesSchemaByMode = {
  meeting: meetingNotesSchema,
  speech: speechNotesSchema,
  interview: interviewNotesSchema
} as const satisfies Record<SessionMode, z.ZodTypeAny>;

export type MeetingNotes = z.infer<typeof meetingNotesSchema>;
export type SpeechNotes = z.infer<typeof speechNotesSchema>;
export type InterviewNotes = z.infer<typeof interviewNotesSchema>;
export type SessionNotes = MeetingNotes | SpeechNotes | InterviewNotes;

export function getNotesSchemaForMode(mode: SessionMode) {
  return notesSchemaByMode[mode];
}

export function getNotesSchemaName(mode: SessionMode): string {
  return `mystt_${mode}_notes`;
}

const responseShapeByMode: Record<SessionMode, string> = {
  meeting: `{
  "mode": "meeting",
  "title": "string",
  "summary": "string",
  "decisions": [{ "decision": "string", "rationale": "string | null", "evidence": { "speaker": "string | null", "quote": "string", "timestampRange": "mm:ss-mm:ss" } }],
  "actionItems": [{ "task": "string", "owner": "string | null", "dueDate": "YYYY-MM-DD | null", "evidence": { "speaker": "string | null", "quote": "string", "timestampRange": "mm:ss-mm:ss" } }],
  "risks": ["string"],
  "openQuestions": ["string"],
  "nextAgenda": ["string"],
  "speakerHighlights": [{ "speaker": "string", "summary": "string" }]
}`,
  speech: `{
  "mode": "speech",
  "title": "string",
  "summary": "string",
  "keyMessages": ["string"],
  "quotableLines": ["string"],
  "sectionSummaries": [{ "section": "string", "summary": "string" }],
  "audienceQna": [{ "question": "string", "answer": "string" }]
}`,
  interview: `{
  "mode": "interview",
  "title": "string",
  "summary": "string",
  "keyInsights": ["string"],
  "questionAnswerPairs": [{ "question": "string", "answer": "string" }],
  "followUpQuestions": ["string"],
  "sensitiveStatements": ["string"]
}`
};

export function getResponseShape(mode: SessionMode): string {
  return responseShapeByMode[mode];
}

export function getNotesPrompt(mode: SessionMode): string {
  const base = [
    "Return valid JSON only.",
    "Do not invent owners, due dates, decisions, or quotes.",
    "If the transcript is ambiguous, use null or leave the item out.",
    "Every action item and decision must include evidence.",
    "Write summaries, decisions, action items, and explanations in Korean.",
    "Keep evidence quotes in the original spoken language."
  ];

  const modeSpecific = {
    meeting: "Focus on decisions, owners, risks, and next agenda items.",
    speech: "Focus on key messages, quotable lines, and audience Q&A.",
    interview:
      "Preserve question-answer structure, insights, and follow-up opportunities."
  } satisfies Record<SessionMode, string>;

  return [...base, modeSpecific[mode], "Expected shape:", getResponseShape(mode)].join(
    "\n"
  );
}
