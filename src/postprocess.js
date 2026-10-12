import { EXAMPLES_BY_ID, SWIPE_FILE } from "./corpus.js";

const SCORE_KEYS = [
  "content_fidelity",
  "proposition_clarity",
  "viewer_relevance",
  "curiosity_tension",
  "precedent_relevance",
  "language_quality",
];

export function scoreBand(total) {
  if (total <= 5) return "Rework the title";
  if (total <= 8) return "Review the weak dimensions before selecting";
  if (total <= 10) return "Strong candidate for consideration";
  return "Strong candidate for testing, not a guarantee of performance";
}

// Evidence level is derived from the corpus, not taken from the model, so it
// can never be stated higher than the swipe file supports. The corpus has no
// controls, so "comparative evidence" and "validated predictive" are unreachable.
function evidenceLevel(precedents) {
  const verified = precedents.filter((p) => p.kind === "title");
  if (verified.length === 0) {
    return precedents.length
      ? "New hypothesis (only unverified thumbnail text as precedent)"
      : "New hypothesis (no relevant precedent in the swipe file)";
  }
  if (verified.length === 1) return "Single observation";
  return "Repeated examples (no controls or baselines yet)";
}

const STOPWORDS = new Set(
  "the and you your are how why what that this with for from into can will not its it's i'm out make".split(" "),
);
const words = (s) =>
  new Set(
    s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );

// Flags SOP prohibited behaviour 5: copying a precedent's wording.
function wordingOverlap(title, precedents) {
  const t = words(title);
  if (!t.size) return null;
  let worst = null;
  for (const p of precedents) {
    const pw = words(p.title);
    const shared = [...t].filter((w) => pw.has(w)).length;
    const ratio = shared / Math.min(t.size, pw.size || 1);
    if (shared >= 2 && (!worst || ratio > worst.ratio)) worst = { id: p.id, ratio };
  }
  return worst && worst.ratio >= 0.6 ? worst : null;
}

export function postprocess(report) {
  const warnings = [];
  const seenMechanisms = new Set();

  const titles = [...report.titles]
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const unknownIds = t.precedent_ids.filter((id) => !EXAMPLES_BY_ID.has(id));
      if (unknownIds.length) {
        warnings.push(`"${t.title}": dropped precedent IDs not in the swipe file: ${unknownIds.join(", ")}`);
      }
      const precedents = [...new Set(t.precedent_ids)]
        .filter((id) => EXAMPLES_BY_ID.has(id))
        .map((id) => EXAMPLES_BY_ID.get(id));

      const scores = Object.fromEntries(
        SCORE_KEYS.map((k) => [k, Math.max(0, Math.min(2, Math.round(t.scores[k] ?? 0)))]),
      );
      if (precedents.length === 0 && scores.precedent_relevance > 0) {
        scores.precedent_relevance = 0;
        warnings.push(`"${t.title}": precedent relevance set to 0 because no valid precedent was cited`);
      }
      const total = SCORE_KEYS.reduce((sum, k) => sum + scores[k], 0);

      if (seenMechanisms.has(t.mechanism) && t.mechanism !== "new_hypothesis") {
        warnings.push(`"${t.title}" reuses the ${t.mechanism} mechanism; the alternatives are not genuinely different`);
      }
      seenMechanisms.add(t.mechanism);

      const overlap = wordingOverlap(t.title, precedents);
      if (overlap) {
        warnings.push(
          `"${t.title}" shares most of its wording with ${overlap.id}; check it learns the mechanism rather than copying the template`,
        );
      }

      const mechanismInfo =
        t.mechanism === "new_hypothesis"
          ? { name: `New hypothesis: ${t.new_mechanism_label || "unlabelled"}`, definition: "Not in the current taxonomy." }
          : SWIPE_FILE.mechanisms[t.mechanism];

      return {
        ...t,
        mechanism_name: mechanismInfo.name,
        mechanism_definition: mechanismInfo.definition,
        research_question: mechanismInfo.research_question ?? null,
        precedents,
        scores,
        total,
        band: scoreBand(total),
        evidence_level: evidenceLevel(precedents),
      };
    });

  if (titles.length !== 3) warnings.push(`Expected 3 titles, got ${titles.length}`);

  return { ...report, titles, warnings };
}
