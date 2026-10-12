// Yogesh's side of the Three-Minute Test: the queue, the clips and the card.

import fs from "node:fs";
import path from "node:path";
import { CLIP_DIR, getSettings } from "./db.js";
import { TEST_LABEL } from "./assessment.js";
import { profileState } from "./onboarding.js";
import { DIMENSIONS, DIMENSION_LABEL, STRENGTH_STEMS, FIX_STEMS, validLevels, lowest, total, lintNote } from "./rubric.js";
import { AI_DIMENSIONS, aiEnabled, callClaude } from "./ai-score.js";

const bad = (status, message) => Object.assign(new Error(message), { status });

const latestCoachScore = (db, studentId, test) =>
  db.prepare("SELECT * FROM scores WHERE student_id = ? AND test = ? AND scorer = 'coach' ORDER BY id DESC LIMIT 1")
    .get(studentId, test);

function scoreSummary(row) {
  if (!row) return null;
  const levels = Object.fromEntries(DIMENSIONS.map((d) => [d, row[d]]));
  return {
    levels, total: total(levels), weakest: row.weakest, strength: row.strength, fix: row.fix, note: row.note,
    scoredAt: row.created_at, basis: row.basis ? JSON.parse(row.basis) : null,
  };
}

// ---------------- Claude's run ----------------

const latestAiRow = (db, attemptId) =>
  db.prepare("SELECT * FROM ai_scores WHERE attempt_id = ? ORDER BY id DESC LIMIT 1").get(attemptId);

export function aiSummary(db, attemptId) {
  const r = latestAiRow(db, attemptId);
  if (!r) return { status: aiEnabled() ? "none" : "off" };
  return {
    id: r.id,
    status: r.status,
    model: r.model,
    result: r.result ? JSON.parse(r.result) : null,
    error: r.error,
    startedAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

const running = new Set();

// Starts Claude scoring in the background. Returns straight away; the coach
// page polls aiSummary. `anthropic` lets tests pass a stand-in client.
export function requestAiScore(db, attemptId, { force = false, anthropic } = {}) {
  if (!anthropic && !aiEnabled()) return aiSummary(db, attemptId);
  const a = db.prepare("SELECT status FROM attempts WHERE id = ?").get(attemptId);
  if (!a || a.status === "in_progress") return aiSummary(db, attemptId);
  const last = latestAiRow(db, attemptId);
  // Without `force` it runs once per test; a failed run waits for "Ask Claude again".
  if (running.has(attemptId) || (last && !force)) return aiSummary(db, attemptId);

  const detail = attemptDetail(db, attemptId);
  if (!detail.parts.some((p) => p.transcript?.text)) {
    db.prepare("INSERT INTO ai_scores (attempt_id, status, error, finished_at) VALUES (?, 'skipped', ?, datetime('now'))")
      .run(attemptId, "No transcript for any answer, so there is nothing for Claude to score. Score all five by hand.");
    return aiSummary(db, attemptId);
  }
  const { lastInsertRowid } = db.prepare("INSERT INTO ai_scores (attempt_id, status) VALUES (?, 'pending')").run(attemptId);
  const id = Number(lastInsertRowid);
  running.add(attemptId);
  const job = callClaude({ profile: detail.profile, parts: detail.parts }, { anthropic })
    .then(({ result, model, usage }) => {
      db.prepare("UPDATE ai_scores SET status = 'done', model = ?, result = ?, usage = ?, finished_at = datetime('now') WHERE id = ?")
        .run(model, JSON.stringify(result), JSON.stringify(usage), id);
    })
    .catch((err) => {
      console.error(`[claude] scoring test ${attemptId} failed:`, err.message);
      db.prepare("UPDATE ai_scores SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?")
        .run(String(err.message).slice(0, 300), id);
    })
    .finally(() => running.delete(attemptId));
  aiJobs.set(attemptId, job);
  return aiSummary(db, attemptId);
}

// Lets tests wait for a background run to finish.
export const aiJobs = new Map();

export function queue(db) {
  const rows = db.prepare(
    `SELECT a.id, a.test, a.status, a.started_at, a.submitted_at, u.id AS student_id, u.name, u.roll, u.dept
     FROM attempts a JOIN users u ON u.id = a.student_id
     ORDER BY CASE a.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, a.submitted_at, a.id`,
  ).all();
  const openTest = getSettings(db).open_test || null;
  return {
    openTest,
    openLabel: openTest ? TEST_LABEL[openTest] : null,
    attempts: rows.map((r) => {
      const score = scoreSummary(latestCoachScore(db, r.student_id, r.test));
      return {
        id: r.id,
        test: r.test,
        label: TEST_LABEL[r.test],
        status: r.status,
        submittedAt: r.submitted_at,
        student: { name: r.name, roll: r.roll, dept: r.dept },
        total: score?.total ?? null,
        scoredAt: score?.scoredAt ?? null,
      };
    }),
  };
}

export function attemptDetail(db, attemptId) {
  const a = db.prepare(
    `SELECT a.*, u.name, u.roll, u.dept FROM attempts a JOIN users u ON u.id = a.student_id WHERE a.id = ?`,
  ).get(attemptId);
  if (!a) throw bad(404, "No such test");
  const questions = JSON.parse(a.questions);
  const clips = db.prepare("SELECT id, part, mime, bytes, duration_ms FROM clips WHERE attempt_id = ? ORDER BY part").all(a.id);
  const said = db.prepare("SELECT * FROM transcripts WHERE attempt_id = ?").all(a.id);
  return {
    id: a.id,
    test: a.test,
    label: TEST_LABEL[a.test],
    status: a.status,
    submittedAt: a.submitted_at,
    student: { name: a.name, roll: a.roll, dept: a.dept },
    parts: questions.map((q) => {
      const c = clips.find((x) => x.part === q.part);
      const t = said.find((x) => x.part === q.part);
      return {
        ...q,
        clip: c ? { id: c.id, mime: c.mime, durationMs: c.duration_ms } : null,
        transcript: t ? { engine: t.engine, text: t.text, error: t.error, delivery: JSON.parse(t.delivery) } : null,
      };
    }),
    score: scoreSummary(latestCoachScore(db, a.student_id, a.test)),
    ai: aiSummary(db, a.id),
    studentId: a.student_id,
    roomCheck: a.room_check ? JSON.parse(a.room_check) : null,
    profile: profileState(db, a.student_id),
  };
}

// One card per sitting: the scorer gives one total across the three answers
// and names the weakest dimension. A re-score adds a new row; the latest wins.
export function saveScore(db, attemptId, coachId, input) {
  const a = db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId);
  if (!a) throw bad(404, "No such test");
  if (a.status === "in_progress") throw bad(409, "This test isn't finished yet");

  const levels = Object.fromEntries(DIMENSIONS.map((d) => [d, Number(input?.levels?.[d])]));
  if (!validLevels(levels)) throw bad(400, "Score all five dimensions from 1 to 4");
  const tied = lowest(levels);
  const weakest = input.weakest || tied[0];
  if (!tied.includes(weakest)) throw bad(400, "The weakest dimension has to be one of the lowest-scored ones");
  if (!STRENGTH_STEMS.includes(input.strength)) throw bad(400, "Pick one strength");
  if (!FIX_STEMS.includes(input.fix)) throw bad(400, "Pick one fix");
  const note = String(input.note || "").trim().slice(0, 500);
  const lint = lintNote(note);
  if (lint) throw bad(400, lint);

  // Where Claude has scored, the coach may change a level only with a reason.
  const ai = aiSummary(db, a.id);
  const overrides = [];
  if (ai.status === "done") {
    for (const d of AI_DIMENSIONS) {
      const from = ai.result[d].level;
      if (levels[d] === from) continue;
      const reason = String(input.reasons?.[d] || "").trim().slice(0, 300);
      if (reason.length < 5) throw bad(400, `Say why you changed Claude's ${DIMENSION_LABEL[d]} score`);
      const reasonLint = lintNote(reason);
      if (reasonLint) throw bad(400, `${DIMENSION_LABEL[d]}: ${reasonLint}`);
      overrides.push({ dimension: d, from, to: levels[d], reason });
    }
  }
  const basis = {
    ai: ai.status === "done" ? { id: ai.id, model: ai.model, levels: Object.fromEntries(AI_DIMENSIONS.map((d) => [d, ai.result[d].level])) } : null,
    overrides,
    presence: "coach",
  };

  db.prepare(
    `INSERT INTO scores (student_id, test, scorer, structure, proof, clarity, presence, fit, weakest, strength, fix, note, created_by, basis)
     VALUES (?, ?, 'coach', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.student_id, a.test, ...DIMENSIONS.map((d) => levels[d]), weakest, input.strength, input.fix, note || null, coachId, JSON.stringify(basis));
  db.prepare("UPDATE attempts SET status = 'scored' WHERE id = ?").run(a.id);
  return attemptDetail(db, a.id);
}

export function setOpenTest(db, test) {
  if (![null, "day1", "final"].includes(test)) throw bad(400, "Unknown test");
  db.prepare("UPDATE settings SET value = ? WHERE key = 'open_test'").run(test || "");
  return queue(db);
}

// Streams a recording with HTTP Range support; Safari will not play video without it.
export function streamClip(db, clipId, req, res, headers) {
  const c = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId);
  const file = c && path.join(CLIP_DIR, path.basename(c.file));
  if (!c || !fs.existsSync(file)) throw bad(404, "Recording not found");
  const size = fs.statSync(file).size;
  const base = { ...headers, "Content-Type": c.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (!m || (m[1] === "" && m[2] === "")) {
    res.writeHead(200, { ...base, "Content-Length": size });
    return fs.createReadStream(file).pipe(res);
  }
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  start = Math.max(0, start);
  if (start > end || start >= size) {
    res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}
