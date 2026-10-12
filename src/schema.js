import { z } from "zod/v4";
import { MECHANISM_KEYS } from "./corpus.js";

const score = z.number().int().describe("0, 1 or 2 per the SOP evaluation table");

export const TitleCandidate = z.object({
  rank: z.number().int().describe("1 = primary title, 2 and 3 = alternatives"),
  title: z.string(),
  mechanism: z
    .enum([...MECHANISM_KEYS, "new_hypothesis"])
    .describe("Taxonomy key, or new_hypothesis if no category fits"),
  new_mechanism_label: z
    .string()
    .describe("Only when mechanism is new_hypothesis: a provisional label. Otherwise empty string."),
  why_this_mechanism: z
    .string()
    .describe("Why this mechanism fits the video's substance and intended viewer"),
  precedent_ids: z
    .array(z.string())
    .describe("IDs from the swipe file whose MECHANISM (not wording) this title draws on. Empty if none."),
  precedent_reasoning: z
    .string()
    .describe("How the precedents' mechanism maps to this video, plus alternative explanations for their performance"),
  scores: z.object({
    content_fidelity: score,
    proposition_clarity: score,
    viewer_relevance: score,
    curiosity_tension: score,
    precedent_relevance: score,
    language_quality: score,
  }),
  audit: z
    .string()
    .describe("Why it represents the content, creates a reason to watch, and avoids unsupported claims. Name any weakness."),
  what_the_video_must_deliver: z
    .string()
    .describe("What the opening and body must contain for this title to be honest"),
  uncertainty: z.array(z.string()).describe("Most important unknowns that could affect performance"),
});

export const TitleReport = z.object({
  proposition: z.string().describe("One sentence: what the video genuinely delivers"),
  intended_viewer: z.string(),
  assumptions: z
    .array(z.string())
    .describe("Things you had to assume about the video because the idea did not state them"),
  titles: z.array(TitleCandidate).describe("Exactly 3, each using a different mechanism"),
  why_these_three_differ: z
    .string()
    .describe("The analytical distinction between the three mechanisms and what testing them would teach"),
  ranking_confidence: z
    .string()
    .describe("How confident the ranking is given the evidence; say so plainly if the evidence cannot rank them"),
});
