// The Three-Minute Test: three recorded answers (60s, 90s, 30s). Day 1 and
// Final use different questions of the same type.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { THREE_MINUTE_TEST } from "./content.js";
import { CLIP_DIR, getSettings } from "./db.js";
import { isOnboarded } from "./onboarding.js";
import { evaluate, delivery, MAX_TRIES_BEFORE_SKIP } from "./roomcheck.js";

export const TEST_LABEL = { day1: "Day 1", final: "Final" };
export const MAX_CLIP_BYTES = 30 * 1024 * 1024;
export const CLIP_TYPES = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
  "audio/webm": ".weba",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
};

const pickOne = (xs) => xs[crypto.randomInt(xs.length)];

export function drawQuestions(used = []) {
  return THREE_MINUTE_TEST.map((p, i) => {
    const fresh = p.deck.filter((q) => !used.includes(q));
    return { part: i + 1, label: p.part, seconds: p.seconds, ask: pickOne(fresh.length ? fresh : p.deck) };
  });
}

const attemptFor = (db, studentId, test) =>
  db.prepare("SELECT * FROM attempts WHERE student_id = ? AND test = ?").get(studentId, test);

const partsDone = (db, attemptId) =>
  db.prepare("SELECT part FROM clips WHERE attempt_id = ? ORDER BY part").all(attemptId).map((r) => r.part);

export function testState(db, studentId) {
  const openTest = getSettings(db).open_test || null;
  const attempts = db.prepare("SELECT * FROM attempts WHERE student_id = ? ORDER BY id").all(studentId);
  const current = openTest ? attempts.find((a) => a.test === openTest) : null;
  return {
    onboarded: isOnboarded(db, studentId),
    openTest,
    openLabel: openTest ? TEST_LABEL[openTest] : null,
    current: current
      ? {
          test: current.test,
          status: current.status,
          partsDone: partsDone(db, current.id),
          roomCheck: current.room_check ? JSON.parse(current.room_check) : null,
          roomTries: current.room_tries,
          // Questions stay hidden once submitted; only the sitting itself needs them.
          questions: current.status === "in_progress" ? JSON.parse(current.questions) : null,
        }
      : null,
    history: attempts.map((a) => ({ test: a.test, label: TEST_LABEL[a.test], status: a.status, submittedAt: a.submitted_at })),
  };
}

export function startTest(db, studentId) {
  const test = getSettings(db).open_test;
  if (!test) throw Object.assign(new Error("No test is open right now"), { status: 409 });
  if (!isOnboarded(db, studentId)) throw Object.assign(new Error("Finish your profile first"), { status: 409 });
  if (!attemptFor(db, studentId, test)) {
    const used = db.prepare("SELECT questions FROM attempts WHERE student_id = ?").all(studentId)
      .flatMap((a) => JSON.parse(a.questions).map((q) => q.ask));
    db.prepare("INSERT INTO attempts (student_id, test, status, questions) VALUES (?, ?, 'in_progress', ?)")
      .run(studentId, test, JSON.stringify(drawQuestions(used)));
    db.prepare("INSERT INTO consent_log (student_id, kind, granted) VALUES (?, 'test_recording', 1)").run(studentId);
  }
  return testState(db, studentId);
}

// No retakes: a part that already has a clip cannot be replaced.
export function saveClip(db, studentId, { part, mime, body, durationMs }) {
  const test = getSettings(db).open_test;
  const attempt = test && attemptFor(db, studentId, test);
  if (!attempt || attempt.status !== "in_progress") throw Object.assign(new Error("No test in progress"), { status: 409 });
  const room = attempt.room_check && JSON.parse(attempt.room_check);
  if (!room || !(room.passed || room.skipped)) throw Object.assign(new Error("Do the room check first"), { status: 409 });
  if (![1, 2, 3].includes(part)) throw Object.assign(new Error("Bad part"), { status: 400 });
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  const ext = CLIP_TYPES[base];
  if (!ext) throw Object.assign(new Error("Unsupported recording type"), { status: 415 });
  if (!body.length) throw Object.assign(new Error("Empty recording"), { status: 400 });
  const done = partsDone(db, attempt.id);
  if (done.includes(part)) throw Object.assign(new Error("Already recorded"), { status: 409 });
  if (part !== done.length + 1) throw Object.assign(new Error("Record the parts in order"), { status: 409 });

  fs.mkdirSync(CLIP_DIR, { recursive: true });
  const file = `${attempt.id}-${part}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(CLIP_DIR, file), body);
  const limit = JSON.parse(attempt.questions)[part - 1].seconds * 1000 + 5000;
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.min(Math.round(durationMs), limit)) : null;
  db.prepare("INSERT INTO clips (attempt_id, part, mime, bytes, duration_ms, file) VALUES (?, ?, ?, ?, ?, ?)")
    .run(attempt.id, part, base, body.length, duration, file);
  if (part === 3) {
    db.prepare("UPDATE attempts SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?").run(attempt.id);
  }
  return testState(db, studentId);
}

const bad = (status, message) => Object.assign(new Error(message), { status });

function openAttempt(db, studentId) {
  const test = getSettings(db).open_test;
  const attempt = test && attemptFor(db, studentId, test);
  if (!attempt || attempt.status !== "in_progress") throw bad(409, "No test in progress");
  return attempt;
}

// The server re-checks the numbers itself; the browser's verdict is not trusted.
// After MAX_TRIES_BEFORE_SKIP failed tries the student may go ahead anyway,
// and the coach sees that it was skipped.
export function saveRoomCheck(db, studentId, { metrics, skip = false }) {
  const attempt = openAttempt(db, studentId);
  const result = evaluate(metrics);
  const tries = skip ? attempt.room_tries : attempt.room_tries + 1;
  const skipped = !result.passed && skip === true && attempt.room_tries >= MAX_TRIES_BEFORE_SKIP;
  const record = { ...result, tries, skipped, at: new Date().toISOString() };
  db.prepare("UPDATE attempts SET room_check = ?, room_tries = ? WHERE id = ?")
    .run(JSON.stringify(record), tries, attempt.id);
  return { ...record, canStart: result.passed || skipped, canSkip: tries >= MAX_TRIES_BEFORE_SKIP };
}

const cleanText = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// Sent just before the part's recording. Re-sending replaces it (a retry).
export function saveTranscript(db, studentId, part, input = {}) {
  const attempt = openAttempt(db, studentId);
  if (part !== partsDone(db, attempt.id).length + 1) throw bad(409, "Not the current part");
  const segments = (Array.isArray(input.segments) ? input.segments : []).slice(0, 200).map((x) => ({
    t: Math.max(0, Math.round(Number(x?.t) || 0)),
    text: cleanText(x?.text, 1000),
    confidence: Number.isFinite(x?.confidence) ? Math.round(x.confidence * 100) / 100 : null,
  })).filter((x) => x.text);
  const text = cleanText(segments.map((x) => x.text).join(" "), 6000);
  const durationMs = Math.max(0, Math.min(Number(input.durationMs) || 0, 120_000));
  const engine = input.supported === true ? "webspeech" : "none";
  const error = input.error ? cleanText(input.error, 80) : engine === "none" ? "unsupported" : null;
  db.prepare(
    `INSERT INTO transcripts (attempt_id, part, engine, text, segments, error, delivery) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (attempt_id, part) DO UPDATE SET engine = excluded.engine, text = excluded.text,
       segments = excluded.segments, error = excluded.error, delivery = excluded.delivery, created_at = datetime('now')`,
  ).run(attempt.id, part, engine, text, JSON.stringify(segments), error, JSON.stringify(delivery(text, durationMs, input.audio || {})));
  return { ok: true };
}
