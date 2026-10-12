// Yogesh's side of the Three-Minute Test: the queue, the clips and the card.

import fs from "node:fs";
import path from "node:path";
import { CLIP_DIR, getSettings } from "./db.js";
import { TEST_LABEL } from "./assessment.js";
import { profileState } from "./onboarding.js";
import { DIMENSIONS, STRENGTH_STEMS, FIX_STEMS, validLevels, lowest, total, lintNote } from "./rubric.js";

const bad = (status, message) => Object.assign(new Error(message), { status });

const latestCoachScore = (db, studentId, test) =>
  db.prepare("SELECT * FROM scores WHERE student_id = ? AND test = ? AND scorer = 'coach' ORDER BY id DESC LIMIT 1")
    .get(studentId, test);

function scoreSummary(row) {
  if (!row) return null;
  const levels = Object.fromEntries(DIMENSIONS.map((d) => [d, row[d]]));
  return { levels, total: total(levels), weakest: row.weakest, strength: row.strength, fix: row.fix, note: row.note, scoredAt: row.created_at };
}

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
  return {
    id: a.id,
    test: a.test,
    label: TEST_LABEL[a.test],
    status: a.status,
    submittedAt: a.submitted_at,
    student: { name: a.name, roll: a.roll, dept: a.dept },
    parts: questions.map((q) => {
      const c = clips.find((x) => x.part === q.part);
      return { ...q, clip: c ? { id: c.id, mime: c.mime, durationMs: c.duration_ms } : null };
    }),
    score: scoreSummary(latestCoachScore(db, a.student_id, a.test)),
    studentId: a.student_id,
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

  db.prepare(
    `INSERT INTO scores (student_id, test, scorer, structure, proof, clarity, presence, fit, weakest, strength, fix, note, created_by)
     VALUES (?, ?, 'coach', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.student_id, a.test, ...DIMENSIONS.map((d) => levels[d]), weakest, input.strength, input.fix, note || null, coachId);
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
