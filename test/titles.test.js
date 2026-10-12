import { test } from "node:test";
import assert from "node:assert/strict";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { TitleReport } from "../src/schema.js";
import { postprocess } from "../src/postprocess.js";
import { SWIPE_FILE } from "../src/corpus.js";

const base = (overrides = {}) => ({
  rank: 1,
  title: "You Can't Focus Because Your Phone Is Too Quiet",
  mechanism: "counterintuitive_causality",
  new_mechanism_label: "",
  why_this_mechanism: "w",
  precedent_ids: ["A1", "E6"],
  precedent_reasoning: "r",
  scores: { content_fidelity: 2, proposition_clarity: 2, viewer_relevance: 2, curiosity_tension: 2, precedent_relevance: 2, language_quality: 2 },
  audit: "a",
  what_the_video_must_deliver: "d",
  uncertainty: ["u"],
  ...overrides,
});
const report = (titles) => ({
  proposition: "p", intended_viewer: "v", assumptions: [], titles,
  why_these_three_differ: "x", ranking_confidence: "c",
});

test("swipe file is internally consistent", () => {
  const ids = SWIPE_FILE.examples.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids");
  for (const e of SWIPE_FILE.examples) {
    for (const tag of e.tags) assert.ok(SWIPE_FILE.mechanisms[tag], `${e.id} has unknown tag ${tag}`);
  }
});

test("schema converts to an output format", () => {
  assert.doesNotThrow(() => betaZodOutputFormat(TitleReport));
});

test("attaches recorded numbers, totals and evidence level", () => {
  const r = postprocess(report([
    base(),
    base({ rank: 2, title: "How to stop rereading the same page", mechanism: "identity_contrast", precedent_ids: ["K3"] }),
    base({ rank: 3, title: "The focus rule", mechanism: "named_framework", precedent_ids: ["H1"] }),
  ]));
  const [a, b, c] = r.titles;
  assert.equal(a.precedents[0].views, "100K");
  assert.equal(a.total, 12);
  assert.equal(a.evidence_level, "Repeated examples (no controls or baselines yet)");
  assert.equal(b.evidence_level, "Single observation");
  assert.match(c.evidence_level, /thumbnail text/);
  assert.deepEqual(r.warnings, []);
});

test("drops invented precedent ids and zeroes precedent relevance", () => {
  const r = postprocess(report([base({ precedent_ids: ["Z9"] })]));
  assert.equal(r.titles[0].precedents.length, 0);
  assert.equal(r.titles[0].scores.precedent_relevance, 0);
  assert.equal(r.titles[0].total, 10);
  assert.match(r.titles[0].evidence_level, /New hypothesis/);
  assert.ok(r.warnings.some((w) => w.includes("Z9")));
});

test("flags reused mechanisms, copied wording and wrong count", () => {
  const r = postprocess(report([
    base(),
    base({ rank: 2, title: "You Are Broke Because You Are Too Smart Again", precedent_ids: ["A1"] }),
  ]));
  assert.ok(r.warnings.some((w) => w.includes("reuses")));
  assert.ok(r.warnings.some((w) => w.includes("shares most of its wording with A1")));
  assert.ok(r.warnings.some((w) => w.includes("Expected 3")));
});

test("generateTitles calls the API with the SOP and returns a processed report", async () => {
  const { generateTitles } = await import("../src/generate.js");
  let params;
  const fake = {
    beta: { messages: { parse: async (p) => {
      params = p;
      return {
        stop_reason: "end_turn", model: p.model,
        parsed_output: report([
          base(),
          base({ rank: 2, mechanism: "emotional_diagnosis", title: "Why your brain won't let you focus anymore", precedent_ids: ["E1"] }),
          base({ rank: 3, mechanism: "new_hypothesis", new_mechanism_label: "x", title: "Something new", precedent_ids: [] }),
        ]),
      };
    } } },
  };
  const r = await generateTitles({ idea: "focus video" }, { anthropic: fake });
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.fallbacks, "default");
  assert.match(params.system[0].text, /Breakout Title Research/);
  assert.match(params.system[0].text, /You Are Broke Because You Are Too Smart/);
  assert.match(params.messages[0].content, /focus video/);
  assert.equal(r.titles.length, 3);
  assert.equal(r.titles[2].mechanism_name, "New hypothesis: x");
});
