import type { SessionMode } from "@mystt/audio-core";
import { z } from "zod";

const evidenceSchema = z.object({
  speaker: z.string().nullable(),
  quote: z.string().min(1),
  timestampRange: z.string().min(1)
});

const evidenceRefSchema = z.object({
  segmentId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speaker: z.string().nullable(),
  quote: z.string().min(1)
});

const severitySchema = z.enum(["high", "medium", "low"]);
const importanceSchema = z.enum(["high", "medium", "low"]);

const legacyActionItemSchema = z.object({
  task: z.string().min(1),
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
  evidence: evidenceSchema
});

const legacyDecisionSchema = z.object({
  decision: z.string().min(1),
  rationale: z.string().nullable(),
  evidence: evidenceSchema
});

const decisionSchema = legacyDecisionSchema.extend({
  status: z.enum(["confirmed", "inferred", "unclear"]),
  decidedBy: z.string().nullable(),
  evidenceRefs: z.array(evidenceRefSchema)
});

const actionItemSchema = legacyActionItemSchema.extend({
  ownerStatus: z.enum(["explicit", "inferred", "needs_confirmation"]),
  dueStatus: z.enum(["explicit", "inferred", "needs_confirmation"]),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["todo", "in_progress", "done", "needs_confirmation"]),
  evidenceRefs: z.array(evidenceRefSchema)
});

const topicSummarySchema = z.object({
  topicId: z.string().min(1),
  title: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summaryBullets: z.array(z.string().min(1)),
  relatedSpeakers: z.array(z.string().min(1)),
  importance: importanceSchema,
  evidenceRefs: z.array(evidenceRefSchema)
});

const reportSummarySchema = z.object({
  title: z.string().min(1),
  introduction: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(2).max(6),
  conclusion: z.string().min(1)
});

const topicTimelineItemSchema = z.object({
  timelineId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  title: z.string().min(1),
  discussion: z.string().min(1),
  outcome: z.string().nullable(),
  relatedSpeakers: z.array(z.string().min(1)),
  evidenceRefs: z.array(evidenceRefSchema)
});

const openIssueSchema = z.object({
  content: z.string().min(1),
  issueType: z.string().min(1),
  severity: severitySchema,
  suggestedNextAction: z.string().min(1),
  evidenceRefs: z.array(evidenceRefSchema)
});

const riskSchema = z.object({
  content: z.string().min(1),
  riskType: z.string().min(1),
  severity: severitySchema,
  mitigation: z.string().min(1),
  evidenceRefs: z.array(evidenceRefSchema)
});

const reviewFlagSchema = z.object({
  flagType: z.string().min(1),
  message: z.string().min(1),
  severity: severitySchema,
  relatedSegmentIds: z.array(z.string().min(1))
});

const legacyMeetingNotesSchema = z.object({
  mode: z.literal("meeting"),
  title: z.string().min(1),
  summary: z.string().min(1),
  decisions: z.array(legacyDecisionSchema),
  actionItems: z.array(legacyActionItemSchema),
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

const meetingNotesV2Schema = z.object({
  schemaVersion: z.literal("meeting_notes_v2"),
  mode: z.literal("meeting"),
  title: z.string().min(1),
  summary: z.string().min(1),
  templateType: z.enum([
    "general_meeting",
    "purchase_review",
    "sales_meeting",
    "user_interview",
    "support_call"
  ]),
  oneLineConclusion: z.string().min(1),
  executiveSummary: z.array(z.string().min(1)).min(5).max(8),
  detailedSummary: z.string().min(1),
  reportSummary: reportSummarySchema.nullable(),
  keywords: z.array(z.string().min(1)),
  topicTimeline: z.array(topicTimelineItemSchema).nullable(),
  topicSummaries: z.array(topicSummarySchema),
  decisions: z.array(decisionSchema),
  actionItems: z.array(actionItemSchema),
  openIssues: z.array(openIssueSchema),
  risks: z.array(riskSchema),
  reviewFlags: z.array(reviewFlagSchema),
  reportMarkdown: z.string().min(1)
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
  meeting: meetingNotesV2Schema,
  speech: speechNotesSchema,
  interview: interviewNotesSchema
} as const satisfies Record<SessionMode, z.ZodTypeAny>;

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type LegacyMeetingNotes = z.infer<typeof legacyMeetingNotesSchema>;
export type MeetingNotesV2 = z.infer<typeof meetingNotesV2Schema>;
export type MeetingNotes = MeetingNotesV2 | LegacyMeetingNotes;
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
  "schemaVersion": "meeting_notes_v2",
  "mode": "meeting",
  "title": "string",
  "summary": "string",
  "templateType": "general_meeting | purchase_review | sales_meeting | user_interview | support_call",
  "oneLineConclusion": "string",
  "executiveSummary": ["5-8 Korean business-report bullets"],
  "detailedSummary": "long Korean report paragraph",
  "reportSummary": { "title": "string", "introduction": "2-3 sentence Korean report opening", "keyPoints": ["3-5 concise Korean main-body bullets"], "conclusion": "1-2 sentence Korean report conclusion" } | null,
  "keywords": ["string"],
  "topicTimeline": [{ "timelineId": "timeline_001", "startMs": 0, "endMs": 12000, "title": "string", "discussion": "what was discussed in this topic block", "outcome": "string | null", "relatedSpeakers": ["string"], "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }] | null,
  "topicSummaries": [{ "topicId": "topic_001", "title": "string", "startMs": 0, "endMs": 12000, "summaryBullets": ["string"], "relatedSpeakers": ["string"], "importance": "high | medium | low", "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }],
  "decisions": [{ "decision": "string", "rationale": "string | null", "status": "confirmed | inferred | unclear", "decidedBy": "string | null", "evidence": { "speaker": "string | null", "quote": "string", "timestampRange": "mm:ss-mm:ss" }, "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }],
  "actionItems": [{ "task": "string", "owner": "string | null", "dueDate": "YYYY-MM-DD | null", "ownerStatus": "explicit | inferred | needs_confirmation", "dueStatus": "explicit | inferred | needs_confirmation", "priority": "high | medium | low", "status": "todo | in_progress | done | needs_confirmation", "evidence": { "speaker": "string | null", "quote": "string", "timestampRange": "mm:ss-mm:ss" }, "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }],
  "openIssues": [{ "content": "string", "issueType": "string", "severity": "high | medium | low", "suggestedNextAction": "string", "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }],
  "risks": [{ "content": "string", "riskType": "string", "severity": "high | medium | low", "mitigation": "string", "evidenceRefs": [{ "segmentId": "seg_0001", "startMs": 0, "endMs": 12000, "speaker": "string | null", "quote": "short source quote" }] }],
  "reviewFlags": [{ "flagType": "string", "message": "string", "severity": "high | medium | low", "relatedSegmentIds": ["seg_0001"] }],
  "reportMarkdown": "Korean report-ready meeting minutes markdown"
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
    "If the transcript is ambiguous, mark it as unclear or needs_confirmation instead of presenting it as confirmed.",
    "Every decision, action item, topic summary, topic timeline item, open issue, and risk must include evidenceRefs whenever possible.",
    "Every evidenceRefs item must use a segment id from the input transcript.",
    "Keep evidence quotes short and copied from the source transcript.",
    "Write summaries, decisions, action items, and explanations in Korean.",
    "Use a Korean business-report style that can be pasted into email or a document.",
    "Keep evidence quotes in the original spoken language.",
    "Keep timestamps and evidence quotes only in JSON metadata fields such as startMs, endMs, evidence, and evidenceRefs.",
    "Do not include timestamp ranges, seconds, evidence quotes, source quotes, or evidence sections in user-facing prose or reportMarkdown.",
    "Do not write literal null, undefined, null::, undefined::, empty brackets, punctuation-only placeholders, or inline evidence markers in user-facing prose; use JSON null only in nullable schema fields.",
    "Reflect low-confidence or unclear-speaker segments in reviewFlags."
  ];

  const modeSpecific = {
    meeting: [
      "Create schemaVersion meeting_notes_v2.",
      "Use Soniox as the meeting ledger: preserve speaker, time, confidence, language, and segment id evidence.",
      "Do not return a short three-line summary.",
      "executiveSummary must contain 5-8 bullets.",
      "detailedSummary must be long enough for Korean business reporting, with paragraph breaks when the content changes topic.",
      "reportSummary must be written for reporting: title, introduction, keyPoints as the main body, and conclusion. Do not collapse it into one long paragraph.",
      "topicTimeline must be chronological by startMs and explain what topic was discussed, what was said, and what outcome or unresolved point remained in each topic block.",
      "If the meeting has no clear topic shift, return one topicTimeline item covering the full transcript.",
      "Only return null for reportSummary or topicTimeline when the transcript is too empty to support that structure.",
      "Do not include raw segment ids such as seg_0001, timestamp ranges such as 00:10-00:20, or evidence quotes in user-facing prose fields like summary, oneLineConclusion, detailedSummary, reportSummary, topicTimeline discussion/outcome, reviewFlags.message, or reportMarkdown. Keep segment ids only inside evidenceRefs and relatedSegmentIds.",
      "reportMarkdown must be a complete meeting-minutes draft ready for mail or reports, using Korean section headings and blank lines between sections.",
      "Never confirm owners, due dates, or decisions unless the transcript clearly says so.",
      "Use confirmed, inferred, unclear, explicit, and needs_confirmation statuses carefully."
    ].join("\n"),
    speech: "Focus on key messages, quotable lines, and audience Q&A.",
    interview:
      "Preserve question-answer structure, insights, and follow-up opportunities."
  } satisfies Record<SessionMode, string>;

  return [...base, modeSpecific[mode], "Expected shape:", getResponseShape(mode)].join(
    "\n"
  );
}
