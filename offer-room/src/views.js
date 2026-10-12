// Two lenses on the same scores.
//
// studentView: only what helps the next attempt. The student's own answers,
//   in task language, compared only with their own Day 1. No rank, no batch
//   average, no notes, no record of who scored what or what was overridden.
//   (Feedback aimed at the task improves performance; feedback aimed at the
//   person, including comparison with others, tends to make it worse.)
//
// managementView: what the placement cell needs to act and to report, in
//   professional language. Individual rows are for the cell only, never for
//   recruiters. Profiles, transcripts and recordings are not shown here.

import {
  DIMENSIONS, DIMENSION_LABEL, LEVEL_NAMES, STUDENT_LINES, BANDS, READY_LINE, RECOMMENDED_ACTION, band, total,
} from "./rubric.js";
import { getSettings } from "./db.js";
import { TEST_LABEL } from "./assessment.js";

const levelsOf = (row) => Object.fromEntries(DIMENSIONS.map((d) => [d, row[d]]));
const round1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (xs, pred) => (xs.length ? xs.filter(pred).length / xs.length : null);

// The score that counts for a test: the latest coach-saved card, once the
// test is marked scored.
function finalScores(db, studentId) {
  const out = {};
  for (const test of ["day1", "final"]) {
    const a = db.prepare("SELECT status FROM attempts WHERE student_id = ? AND test = ?").get(studentId, test);
    if (a?.status !== "scored") continue;
    const row = db.prepare("SELECT * FROM scores WHERE student_id = ? AND test = ? AND scorer = 'coach' ORDER BY id DESC LIMIT 1")
      .get(studentId, test);
    if (row) out[test] = row;
  }
  return out;
}

// ---------------------------- student lens ----------------------------

function describe(row) {
  const levels = levelsOf(row);
  const t = total(levels);
  const weak = row.weakest;
  return {
    total: t,
    bar: { line: READY_LINE, clears: t >= READY_LINE, gap: Math.max(0, READY_LINE - t) },
    weakest: weak,
    weakestLabel: DIMENSION_LABEL[weak],
    nextRep: STUDENT_LINES[weak][levels[weak] - 1].next,
    strength: row.strength,
    fix: row.fix,
    dimensions: DIMENSIONS.map((d) => ({
      key: d,
      label: DIMENSION_LABEL[d],
      level: levels[d],
      levelName: LEVEL_NAMES[levels[d] - 1],
      said: STUDENT_LINES[d][levels[d] - 1].said,
    })),
  };
}

export function studentView(db, studentId) {
  const user = db.prepare("SELECT name FROM users WHERE id = ? AND role = 'student'").get(studentId);
  if (!user) return null;
  const rows = finalScores(db, studentId);
  const tests = {};
  for (const [test, row] of Object.entries(rows)) tests[test] = { label: TEST_LABEL[test], ...describe(row) };
  let movement = null;
  if (rows.day1 && rows.final) {
    movement = {
      total: tests.final.total - tests.day1.total,
      dimensions: DIMENSIONS.map((d) => ({
        key: d, label: DIMENSION_LABEL[d], from: rows.day1[d], to: rows.final[d], change: rows.final[d] - rows.day1[d],
      })),
    };
  }
  return { name: user.name, tests, movement };
}

// --------------------------- management lens ---------------------------

const STATUS_LABEL = { none: "Not taken", in_progress: "In progress", submitted: "Awaiting score", scored: "Scored" };

export function managementView(db) {
  const settings = getSettings(db);
  const students = db.prepare("SELECT id, name, roll, dept FROM users WHERE role = 'student' ORDER BY name").all();
  const attempts = db.prepare("SELECT * FROM attempts").all();
  const transcripts = db.prepare("SELECT attempt_id, text FROM transcripts").all();

  const register = students.map((s) => {
    const rows = finalScores(db, s.id);
    const day1 = rows.day1 ? total(levelsOf(rows.day1)) : null;
    const final = rows.final ? total(levelsOf(rows.final)) : null;
    const latest = rows.final || rows.day1;
    const latestTotal = final ?? day1;
    const status = (test) => STATUS_LABEL[attempts.find((a) => a.student_id === s.id && a.test === test)?.status || "none"];
    return {
      id: s.id, name: s.name, roll: s.roll, dept: s.dept || "Unassigned",
      day1, final,
      change: day1 != null && final != null ? final - day1 : null,
      day1Levels: rows.day1 ? levelsOf(rows.day1) : null,
      finalLevels: rows.final ? levelsOf(rows.final) : null,
      ready: latestTotal == null ? null : latestTotal >= READY_LINE,
      weakest: latest?.weakest ?? null,
      weakestLabel: latest ? DIMENSION_LABEL[latest.weakest] : null,
      action: latest && latestTotal < READY_LINE ? RECOMMENDED_ACTION[latest.weakest] : null,
      day1Status: status("day1"),
      finalStatus: status("final"),
      basis: [rows.day1, rows.final].filter(Boolean).map((r) => (r.basis ? JSON.parse(r.basis) : null)),
    };
  });

  // Support priority: not yet Ready first, lowest latest score first, unscored last.
  register.sort((a, b) => {
    const ta = a.final ?? a.day1;
    const tb = b.final ?? b.day1;
    if (ta == null || tb == null) return (ta == null) - (tb == null) || a.name.localeCompare(b.name);
    return ta - tb || a.name.localeCompare(b.name);
  });
  register.forEach((r, i) => { r.priority = r.day1 == null && r.final == null ? null : i + 1; });

  const withDay1 = register.filter((r) => r.day1 != null);
  const withFinal = register.filter((r) => r.final != null);
  const paired = register.filter((r) => r.day1 != null && r.final != null);

  // Dimension averages: Day 1 and Final for the same students once both exist,
  // otherwise the Day 1 picture on its own.
  const base = paired.length ? paired : withDay1;
  const dimensions = DIMENSIONS.map((d) => {
    const a = avg(base.map((r) => r.day1Levels[d]));
    const b = paired.length ? avg(paired.map((r) => r.finalLevels[d])) : null;
    return { key: d, label: DIMENSION_LABEL[d], day1: round1(a), final: round1(b), change: b == null || a == null ? null : round1(b - a) };
  });
  const moved = dimensions.filter((d) => d.change != null).sort((x, y) => y.change - x.change);
  const weakestNow = [...dimensions].filter((d) => d.day1 != null)
    .sort((x, y) => (x.final ?? x.day1) - (y.final ?? y.day1))[0] || null;

  const bands = BANDS.map((b, i) => ({
    label: b.label,
    day1: withDay1.filter((r) => band(r.day1) === i).length,
    final: withFinal.filter((r) => band(r.final) === i).length,
  }));

  // Scoring integrity: how often a coach changed Claude's level, per dimension.
  const bases = register.flatMap((r) => r.basis).filter(Boolean);
  const withAi = bases.filter((b) => b.ai);
  const AI_DIMS = ["structure", "proof", "clarity", "fit"];
  const integrity = {
    testsScored: register.flatMap((r) => r.basis).length,
    testsWithClaude: withAi.length,
    judgements: withAi.length * AI_DIMS.length,
    overrides: withAi.reduce((n, b) => n + b.overrides.length, 0),
    byDimension: AI_DIMS.map((d) => {
      const changes = withAi.flatMap((b) => b.overrides.filter((o) => o.dimension === d));
      return {
        key: d, label: DIMENSION_LABEL[d],
        overrides: changes.length,
        rate: withAi.length ? changes.length / withAi.length : null,
        meanShift: round1(avg(changes.map((o) => o.to - o.from))),
      };
    }),
  };

  const depts = [...new Set(register.map((r) => r.dept))];
  const departments = depts.map((dept) => {
    const rs = register.filter((r) => r.dept === dept);
    const pd = rs.filter((r) => r.change != null);
    const scored = rs.filter((r) => r.ready != null);
    return {
      dept,
      students: rs.length,
      day1: round1(avg(rs.filter((r) => r.day1 != null).map((r) => r.day1))),
      final: round1(avg(rs.filter((r) => r.final != null).map((r) => r.final))),
      change: round1(avg(pd.map((r) => r.change))),
      ready: share(scored, (r) => r.ready),
    };
  }).sort((a, b) => (b.change ?? -99) - (a.change ?? -99) || (b.ready ?? -1) - (a.ready ?? -1));

  const taken = attempts.filter((a) => a.status !== "in_progress");
  const textParts = transcripts.filter((t) => t.text?.trim()).length;
  const process = {
    testsTaken: taken.length,
    awaitingScore: attempts.filter((a) => a.status === "submitted").length,
    roomFirstTry: share(taken.filter((a) => a.room_check), (a) => JSON.parse(a.room_check).passed && a.room_tries === 1),
    roomSkipped: taken.filter((a) => a.room_check && JSON.parse(a.room_check).skipped).length,
    transcriptCoverage: transcripts.length ? textParts / transcripts.length : null,
  };

  return {
    settings,
    readyLine: READY_LINE,
    generatedAt: new Date().toISOString(),
    headline: {
      students: register.length,
      measuredDay1: withDay1.length,
      measuredFinal: withFinal.length,
      paired: paired.length,
      avgDay1: round1(avg(withDay1.map((r) => r.day1))),
      avgFinal: round1(avg(withFinal.map((r) => r.final))),
      avgChange: round1(avg(paired.map((r) => r.change))),
      readyDay1: share(withDay1, (r) => r.day1 >= READY_LINE),
      readyFinal: share(withFinal, (r) => r.final >= READY_LINE),
      notYetReady: register.filter((r) => r.ready === false).length,
      mostMoved: moved[0] || null,
      weakestNow,
    },
    dimensions,
    bands,
    integrity,
    departments,
    process,
    register: register.map(({ basis, ...r }) => r),
  };
}

export function registerCsv(view) {
  const head = ["Priority", "Name", "Roll", "Department", "Day 1", "Final", "Change", "Ready", "Weakest", "Recommended action", "Day 1 status", "Final status"];
  // Text that starts like a formula gets a leading apostrophe so a spreadsheet
  // shows it instead of running it; numbers are left alone.
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = view.register.map((r) => [
    r.priority, r.name, r.roll, r.dept, r.day1, r.final, r.change,
    r.ready == null ? "" : r.ready ? "Yes" : "Not yet", r.weakestLabel, r.action, r.day1Status, r.finalStatus,
  ]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
