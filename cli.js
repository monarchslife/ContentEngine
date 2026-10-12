#!/usr/bin/env node
import { generateTitles } from "./src/generate.js";

const idea = process.argv.slice(2).join(" ");
if (!idea) {
  console.error('Usage: npm run titles -- "your video idea"');
  process.exit(1);
}

try {
  const r = await generateTitles({ idea });
  console.log(`\nPROPOSITION: ${r.proposition}`);
  console.log(`VIEWER: ${r.intended_viewer}`);
  if (r.assumptions.length) console.log(`ASSUMED: ${r.assumptions.join(" | ")}`);
  for (const t of r.titles) {
    console.log(`\n${t.rank === 1 ? "PRIMARY" : `ALT ${t.rank - 1}`}  ${t.title}`);
    console.log(`  Mechanism: ${t.mechanism_name}  |  Score ${t.total}/12 (${t.band})`);
    console.log(`  Evidence: ${t.evidence_level}`);
    for (const p of t.precedents) {
      console.log(`    [${p.id}] "${p.title}" - ${p.views ?? "views unknown"}, ${p.age ?? "age unknown"}`);
    }
    console.log(`  Why: ${t.why_this_mechanism}`);
    console.log(`  Audit: ${t.audit}`);
    console.log(`  Unknowns: ${t.uncertainty.join(" | ")}`);
  }
  console.log(`\nWHY THESE THREE: ${r.why_these_three_differ}`);
  console.log(`CONFIDENCE: ${r.ranking_confidence}`);
  for (const w of r.warnings) console.log(`! ${w}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
