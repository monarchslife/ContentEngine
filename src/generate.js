import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { TitleReport } from "./schema.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { postprocess } from "./postprocess.js";
import { LOG_PATH } from "./corpus.js";

const MODEL = process.env.TITLE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.TITLE_EFFORT || "high";

let client;

export async function generateTitles(input, { anthropic } = {}) {
  if (!input?.idea?.trim()) throw new Error("Give it a video idea first.");
  client ??= anthropic ?? new Anthropic();

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, format: betaZodOutputFormat(TitleReport) },
    // On a safety-classifier decline, re-run on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request. Try rephrasing the idea.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The response was cut off before it finished. Try again.");
  }
  if (!response.parsed_output) {
    throw new Error("Claude's response didn't match the expected format. Try again.");
  }

  const report = postprocess(response.parsed_output);
  logDecision(input, report, response.model);
  return report;
}

// SOP step 8: record the decision and its rationale at the time it was made.
function logDecision(input, report, model) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const entry = {
      at: new Date().toISOString(),
      model,
      input,
      proposition: report.proposition,
      titles: report.titles.map((t) => ({
        rank: t.rank,
        title: t.title,
        mechanism: t.mechanism,
        precedent_ids: t.precedents.map((p) => p.id),
        evidence_level: t.evidence_level,
        total: t.total,
        hypothesis: t.research_question,
      })),
      warnings: report.warnings,
      outcome: null,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.warn("Could not write decision log:", err.message);
  }
}
