import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const clipDir = fs.mkdtempSync(path.join(os.tmpdir(), "offer-room-clips-"));
process.env.OFFER_ROOM_CLIPS = clipDir;
process.env.OFFER_ROOM_RESUMES = path.join(clipDir, "resumes");
const { openDb, seed, addUser } = await import("../offer-room/src/db.js");
const { createApp } = await import("../offer-room/src/app.js");
const { drawQuestions } = await import("../offer-room/src/assessment.js");
const { evaluate, heardRatio, delivery, READ_LINE } = await import("../offer-room/src/roomcheck.js");
const { DatabaseSync } = await import("node:sqlite");
const { aiJobs } = await import("../offer-room/src/scoring.js");
const { buildUserMessage, validate, SYSTEM_PROMPT } = await import("../offer-room/src/ai-score.js");
const { registerCsv } = await import("../offer-room/src/views.js");
const { STUDENT_LINES } = await import("../offer-room/src/rubric.js");

// A stand-in for the Claude API: records each request and returns a fixed card.
const claudeCalls = [];
const CLAUDE_CARD = {
  structure: { level: 2, evidence: "I am Badal, a final year B.Tech student.", reason: "The introduction starts well but has no close.", enough_evidence: true },
  proof: { level: 3, evidence: "I wrote 60 test cases.", reason: "One specific example with a number.", enough_evidence: true },
  clarity: { level: 3, evidence: "21 words per minute", reason: "Easy to follow, short sentences.", enough_evidence: false },
  fit: { level: 1, evidence: "", reason: "The answers never link back to QA work.", enough_evidence: true },
  strength: "The number in the result made it stick.",
  fix: "Next rep: end with one line that links to the role.",
  confidence: "medium",
  notes_for_coach: "Part 2 had no transcript.",
};
const fakeClaude = {
  beta: {
    messages: {
      parse: async (req) => {
        claudeCalls.push(req);
        return { stop_reason: "end_turn", model: "claude-opus-5-5", parsed_output: structuredClone(CLAUDE_CARD), usage: { input_tokens: 3000, output_tokens: 600 } };
      },
    },
  },
};

const GOOD_ROOM = {
  voiceOnly: false, noiseDb: -62, speechDb: -28, luma: 120, backlight: 5, blur: 9,
  transcript: { supported: true, heard: READ_LINE, ratio: 1 },
};
const NOISY_ROOM = { ...GOOD_ROOM, noiseDb: -35 };

let db, server, base, pins;

before(async () => {
  db = openDb(":memory:");
  const made = seed(db, { writeFile: false });
  pins = Object.fromEntries(made.map((u) => [u.login, u.pin]));
  server = http.createServer(createApp(db, { anthropic: fakeClaude }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(clipDir, { recursive: true, force: true });
});

async function login(who, pin = pins[who]) {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: who, pin }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { res, cookie, body: await res.json() };
}

const call = (cookie, url, opts = {}) =>
  fetch(`${base}${url}`, { redirect: "manual", ...opts, headers: { cookie, ...(opts.headers || {}) } });

let sittingToken = null; // set by the room check in the Day 1 test

const clip = (cookie, part, { type = "video/webm", bytes = 2048, header = true, sitting = sittingToken } = {}) =>
  call(cookie, `/api/student/test/part/${part}`, {
    method: "POST",
    body: Buffer.alloc(bytes, 1),
    headers: { "Content-Type": type, ...(header && { "X-Offer-Room": "1" }), ...(sitting && { "X-Sitting": sitting }), "X-Duration-Ms": "42000" },
  });

test("each role lands on its own home; wrong PINs are refused", async () => {
  assert.equal((await login("badal")).body.home, "/room");
  assert.equal((await login("yogesh")).body.home, "/coach");
  assert.equal((await login("placementcell")).body.home, "/dashboard");
  const bad = await login("badal", "000000");
  assert.equal(bad.res.status, 401);
  assert.equal(bad.cookie, undefined);
});

test("a plain form post logs in too (works with JavaScript off)", async () => {
  const post = (pin) => fetch(`${base}/login`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login: " Badal ", pin }).toString(),
  });
  const ok = await post(pins.badal);
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "/room");
  assert.match(ok.headers.get("set-cookie"), /or_sid=.+HttpOnly/);
  const bad = await post("000000");
  assert.equal(bad.headers.get("location"), "/login?e=wrong");
  assert.equal(bad.headers.get("set-cookie"), null);
});

test("five wrong PINs lock the login", async () => {
  addUser(db, { role: "management", login: "lockme", name: "Lockout test", pin: "123456" });
  for (let i = 0; i < 5; i++) await login("lockme", "1");
  const locked = await login("lockme", "123456");
  assert.equal(locked.res.status, 429, "even the right PIN is refused while locked");
});

test("brand fonts and crowns are served; nothing outside the assets folder is", async () => {
  const font = await fetch(`${base}/assets/fonts/Poppins-600.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  const crown = await fetch(`${base}/assets/brand/crown.svg`);
  assert.equal(crown.headers.get("content-type"), "image/svg+xml");
  // Raw paths, sent as written (fetch would tidy the dots away first).
  const raw = (p) => new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: server.address().port, path: p }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  for (const bad of ["../src/db.js", "fonts/../../server.js", "brand/../../../package.json", "..", "fonts/x/y.css", "%2e%2e/src/app.js", "fonts/..%2f..%2fserver.js"]) {
    const status = await raw(`/assets/${bad}`);
    assert.ok(status === 404 || status === 302, `${bad} answered ${status}`); // never a file
  }
});

test("pages and APIs are protected", async () => {
  assert.equal((await call("", "/room")).status, 302);
  assert.equal((await call("", "/api/student/test")).status, 401);
  const { cookie } = await login("yogesh");
  assert.equal((await call(cookie, "/api/student/test")).status, 403);
  assert.equal((await call(cookie, "/room")).headers.get("location"), "/login");
});

test("Badal must finish onboarding (profile + resume) before the test unlocks", async () => {
  const { cookie } = await login("badal");
  const json = (method, url, body) => call(cookie, url, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let state = await (await call(cookie, "/api/student/test")).json();
  assert.equal(state.onboarded, false);
  assert.equal((await json("POST", "/api/student/test/start", { consent: true })).status, 409);

  let profile = await (await json("PUT", "/api/student/profile", {
    degree: "B.Tech / B.E.", branch: "Computer Science", gradYear: "2027", languages: ["English", "Klingon"], hacker: "x",
  })).json();
  assert.deepEqual(profile.data.languages, ["English"], "unknown languages are dropped");
  assert.equal(profile.data.hacker, undefined, "unknown fields are dropped");
  assert.ok(profile.missing.includes("the kind of role you want"));
  assert.equal((await json("POST", "/api/student/profile/complete", {})).status, 400);

  profile = await (await json("PUT", "/api/student/profile", {
    roleFamily: "Software testing / QA", roleText: "QA engineer at an IT services company",
    relocation: "Yes", nightShifts: "Depends", projects: "Attendance app. I wrote 60 test cases.",
  })).json();
  assert.equal(profile.data.degree, "B.Tech / B.E.", "drafts merge across steps");
  assert.deepEqual(profile.missing, ["your resume (or tick 'no resume yet')"]);

  const upload = (body) => call(cookie, "/api/student/profile/resume", {
    method: "POST", body, headers: { "Content-Type": "application/pdf", "X-Offer-Room": "1", "X-Filename": "Badal%20CV.pdf" },
  });
  assert.equal((await upload(Buffer.from("not a pdf at all"))).status, 415);
  profile = await (await upload(Buffer.from("%PDF-1.4\n%fake resume\n"))).json();
  assert.equal(profile.resume.name, "Badal CV.pdf");
  assert.deepEqual(profile.missing, []);

  profile = await (await json("POST", "/api/student/profile/complete", {})).json();
  assert.equal(profile.completed, true);
  state = await (await call(cookie, "/api/student/test")).json();
  assert.equal(state.onboarded, true);

  // Coach can open it; the student cannot use the coach route.
  const { cookie: coach } = await login("yogesh");
  const badalId = db.prepare("SELECT id FROM users WHERE login = 'badal'").get().id;
  const pdf = await call(coach, `/api/coach/student/${badalId}/resume`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(Buffer.from(await pdf.arrayBuffer()).toString(), /^%PDF-/);
  assert.equal((await call(cookie, `/api/coach/student/${badalId}/resume`)).status, 403);
});

test("Badal takes the Day 1 test: consent, three parts in order, no retakes", async () => {
  const { cookie } = await login("badal");
  let state = await (await call(cookie, "/api/student/test")).json();
  assert.equal(state.openTest, "day1");
  assert.equal(state.current, null);

  const noConsent = await call(cookie, "/api/student/test/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  assert.equal(noConsent.status, 400);

  state = await (await call(cookie, "/api/student/test/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
  })).json();
  assert.equal(state.current.status, "in_progress");
  assert.deepEqual(state.current.questions.map((q) => q.seconds), [60, 90, 30]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM consent_log WHERE kind = 'test_recording'").get().n, 1);

  const room = (metrics, skip = false) => call(cookie, "/api/student/test/room-check", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metrics, skip }),
  });
  assert.equal((await clip(cookie, 1)).status, 428, "no recording before the room check");
  let rc = await (await room(NOISY_ROOM)).json();
  assert.equal(rc.passed, false);
  assert.equal(rc.canStart, false);
  assert.equal(rc.checks.find((c) => c.key === "noise").ok, false);
  assert.equal(rc.sitting, null, "a failed check opens no sitting");
  assert.equal((await clip(cookie, 1)).status, 428, "a failed room check still blocks recording");
  const early = await (await room(NOISY_ROOM, true)).json();
  assert.equal(early.canStart, false, "no skipping before three tries");
  assert.equal(early.tries, 1, "a refused skip isn't counted as a try");
  rc = await (await room({ ...NOISY_ROOM, passed: true })).json();
  assert.equal(rc.passed, false, "the server re-checks the numbers itself");
  rc = await (await room(NOISY_ROOM)).json();
  assert.equal(rc.canSkip, true, "after three failed tries the student may continue");
  rc = await (await room(GOOD_ROOM)).json();
  assert.equal(rc.passed, true);
  assert.equal(rc.canStart, true);
  const oldSitting = rc.sitting;
  // A new session (say, the page was reloaded) runs the check again; the old one stops working.
  rc = await (await room(GOOD_ROOM)).json();
  assert.notEqual(rc.sitting, oldSitting);
  sittingToken = rc.sitting;
  assert.equal((await clip(cookie, 1, { sitting: oldSitting })).status, 428, "the old session's token is dead");

  const said = (part, body, sitting = sittingToken) => call(cookie, `/api/student/test/part/${part}/transcript`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(sitting && { "X-Sitting": sitting }) }, body: JSON.stringify(body),
  });
  assert.equal((await said(1, { supported: true, segments: [] }, "made-up")).status, 428, "transcripts need the session too");
  assert.equal((await said(2, { supported: true, segments: [] })).status, 409, "transcripts follow the current part");
  assert.equal((await said(1, {
    supported: true, durationMs: 45000,
    segments: [{ t: 4000, text: "I am Badal, a final year B.Tech student." }, { t: 9000, text: "Um, I wrote 60 test cases." }],
    audio: { startDelayMs: 1500, longPauses: 1, longestPauseMs: 2600, speakingMs: 30000, levelDb: -27 },
  })).status, 200);

  assert.equal((await clip(cookie, 2)).status, 409, "parts go in order");
  assert.equal((await clip(cookie, 1, { header: false })).status, 403, "uploads need the custom header");
  assert.equal((await clip(cookie, 1, { type: "text/html" })).status, 415);
  assert.equal((await clip(cookie, 1)).status, 200);
  assert.equal((await clip(cookie, 1)).status, 409, "no retakes");
  assert.equal((await said(2, { supported: false })).status, 200, "an unsupported browser still records");
  assert.equal((await clip(cookie, 2, { type: "video/mp4;codecs=avc1" })).status, 200);
  state = await (await clip(cookie, 3, { type: "audio/webm;codecs=opus" })).json();

  assert.equal(state.current.status, "submitted");
  assert.equal(state.current.questions, null, "questions are hidden once submitted");
  const files = db.prepare("SELECT file, duration_ms FROM clips").all();
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => fs.existsSync(path.join(clipDir, f.file))));
  assert.equal(files[2].duration_ms, 35000, "duration is clamped to the part's limit");
  assert.equal((await clip(cookie, 3)).status, 409, "a submitted test takes no more uploads");

  const t1 = db.prepare("SELECT * FROM transcripts WHERE part = 1").get();
  assert.equal(t1.text, "I am Badal, a final year B.Tech student. Um, I wrote 60 test cases.");
  const d1 = JSON.parse(t1.delivery);
  assert.equal(d1.words, 15, "B.Tech counts as two words");
  assert.equal(d1.fillers, 1);
  assert.equal(d1.wpm, 21, "words per minute counts from the first word spoken");
  assert.equal(d1.longPauses, 1);
  assert.equal(db.prepare("SELECT error FROM transcripts WHERE part = 2").get().error, "unsupported");
});

test("room check rules: hard checks block, soft ones only warn", () => {
  assert.equal(evaluate(GOOD_ROOM).passed, true);
  assert.equal(evaluate({ ...GOOD_ROOM, luma: 30 }).passed, false, "too dark");
  assert.equal(evaluate({ ...GOOD_ROOM, backlight: 70 }).passed, false, "light behind");
  assert.equal(evaluate({ ...GOOD_ROOM, speechDb: -55 }).passed, false, "voice too quiet");
  const silent = evaluate({ ...GOOD_ROOM, noiseDb: -180, speechDb: -130 });
  assert.match(silent.checks.find((c) => c.key === "voice").fix, /muted/);
  assert.equal(silent.checks.find((c) => c.key === "clear"), undefined, "silence against silence isn't a clear voice");
  assert.equal(evaluate({ ...GOOD_ROOM, noiseDb: -50, speechDb: -38 }).passed, false, "voice too close to the room noise");
  const blurry = evaluate({ ...GOOD_ROOM, blur: 1 });
  assert.equal(blurry.passed, true, "blur only warns");
  assert.equal(blurry.checks.find((c) => c.key === "sharp").ok, false);
  const noWords = evaluate({ ...GOOD_ROOM, transcript: { supported: false } });
  assert.equal(noWords.passed, true, "a browser without transcripts can still take the test");
  assert.match(noWords.checks.find((c) => c.key === "words").fix, /Chrome/);
  const voice = evaluate({ ...GOOD_ROOM, voiceOnly: true, luma: 0 });
  assert.equal(voice.passed, true, "voice-only skips picture checks");
  assert.equal(heardRatio("i am getting ready for my placement interviews"), 8 / 13);
  assert.equal(delivery("", 30000, {}).wpm, null);
});

test("an older database gets the new columns", () => {
  const file = path.join(clipDir, "old.db");
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, roll TEXT, dept TEXT, pin_hash TEXT NOT NULL, created_at TEXT);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, test TEXT NOT NULL, status TEXT NOT NULL, questions TEXT NOT NULL, started_at TEXT, submitted_at TEXT, UNIQUE (student_id, test));
    INSERT INTO attempts (student_id, test, status, questions) VALUES (1, 'day1', 'submitted', '[]');`);
  old.close();
  const upgraded = openDb(file);
  const cols = upgraded.prepare("PRAGMA table_info(attempts)").all().map((c) => c.name);
  assert.ok(cols.includes("room_check") && cols.includes("room_tries"));
  assert.equal(upgraded.prepare("SELECT room_tries FROM attempts").get().room_tries, 0, "existing rows keep working");
  upgraded.close();
});

test("the Final draws different story and curveball questions from Day 1", async () => {
  db.prepare("UPDATE settings SET value = 'final' WHERE key = 'open_test'").run();
  const { cookie } = await login("badal");
  const state = await (await call(cookie, "/api/student/test/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
  })).json();
  const day1 = JSON.parse(db.prepare("SELECT questions FROM attempts WHERE test = 'day1'").get().questions);
  assert.equal(state.current.test, "final");
  assert.notEqual(state.current.questions[1].ask, day1[1].ask);
  assert.notEqual(state.current.questions[2].ask, day1[2].ask);
  db.prepare("UPDATE settings SET value = 'day1' WHERE key = 'open_test'").run();
});

test("drawQuestions avoids used questions when it can", () => {
  const used = drawQuestions().map((q) => q.ask);
  const next = drawQuestions(used);
  assert.equal(next[0].ask, "Tell me about yourself.", "part 1 is always the introduction");
  assert.ok(!used.slice(1).includes(next[1].ask));
});

test("Yogesh scores Badal's Day 1 test", async () => {
  const { cookie: student } = await login("badal");
  assert.equal((await call(student, "/api/coach/queue")).status, 403, "students can't reach the console");

  const { cookie } = await login("yogesh");
  const q = await (await call(cookie, "/api/coach/queue")).json();
  const day1 = q.attempts.find((a) => a.test === "day1");
  assert.equal(day1.status, "submitted");
  assert.equal(day1.student.name, "Badal");

  // Submitting the last answer handed the test to Claude.
  await aiJobs.get(day1.id);
  assert.equal(claudeCalls.length, 1);
  const sent = claudeCalls[0];
  assert.match(sent.system[0].text, /Presence/);
  const msg = sent.messages[0].content;
  assert.match(msg, /Target role: QA engineer at an IT services company/);
  assert.match(msg, /<transcript part="1">\nI am Badal/);
  assert.match(msg, /Transcript: none \(unsupported\)/, "a missing transcript is named, not invented");
  assert.match(msg, /21 words per minute/);

  const detail = await (await call(cookie, `/api/coach/attempt/${day1.id}`)).json();
  assert.equal(claudeCalls.length, 1, "opening the test doesn't score it twice");
  assert.equal(detail.ai.status, "done");
  assert.equal(detail.ai.result.proof.level, 3);
  assert.equal(detail.parts.length, 3);
  assert.ok(detail.parts.every((p) => p.clip && p.ask));
  assert.equal(detail.profile.data.roleText, "QA engineer at an IT services company");
  assert.equal(detail.roomCheck.passed, true);
  assert.equal(detail.roomCheck.tries, 5);
  assert.match(detail.parts[0].transcript.text, /60 test cases/);
  assert.equal(detail.parts[0].transcript.delivery.wpm, 21);
  assert.equal(detail.parts[1].transcript.error, "unsupported");

  // The recording streams, with byte ranges for Safari.
  const clipUrl = `/api/coach/clip/${detail.parts[0].clip.id}`;
  const full = await call(cookie, clipUrl);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/webm");
  assert.equal((await full.arrayBuffer()).byteLength, 2048);
  const part = await call(cookie, clipUrl, { headers: { range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 0-99/2048");
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await call(student, clipUrl)).status, 403, "students can't fetch clips");

  const post = (body) => call(cookie, `/api/coach/attempt/${day1.id}/score`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const good = {
    levels: { structure: 2, proof: 3, clarity: 3, presence: 2, fit: 1 },
    strength: "The pace was steady and easy to follow.",
    fix: "Next rep: say what you did, with 'I', not 'we'.",
  };
  assert.equal((await post({ ...good, levels: { ...good.levels, fit: 5 } })).status, 400, "levels are 1 to 4");
  assert.equal((await post({ ...good, weakest: "clarity" })).status, 400, "weakest must be a lowest dimension");
  assert.equal((await post({ ...good, strength: "Great job!" })).status, 400, "strengths come from the stems");
  const personal = await post({ ...good, note: "He is too nervous and lacks confidence" });
  assert.equal(personal.status, 400, "person-aimed notes are refused");
  assert.match((await personal.json()).error, /about the answer/);

  let saved = await (await post({ ...good, note: "Part 2 story had no result." })).json();
  assert.equal(saved.status, "scored");
  assert.equal(saved.score.total, 11);
  assert.equal(saved.score.weakest, "fit");
  assert.deepEqual(saved.score.basis.overrides, [], "kept Claude's levels, so nothing to explain");
  assert.equal(saved.score.basis.ai.levels.proof, 3);

  // Changing Claude's level needs a reason about the answer, and it is logged.
  const changed = { ...good, levels: { ...good.levels, proof: 1, presence: 1 } };
  const noWhy = await post(changed);
  assert.equal(noWhy.status, 400);
  assert.match((await noWhy.json()).error, /why you changed Claude's Proof/);
  assert.equal((await post({ ...changed, reasons: { proof: "He is not confident" } })).status, 400, "the reason is linted too");
  assert.equal((await post({ ...changed, weakest: "presence", reasons: { proof: "Not confident" } })).status, 400);
  saved = await (await post({ ...changed, weakest: "proof", reasons: { proof: "The 60 test cases were a team total, said in Part 1 video." } })).json();
  assert.equal(saved.score.total, 8, "a re-score replaces the old one");
  assert.deepEqual(saved.score.basis.overrides, [{ dimension: "proof", from: 3, to: 1, reason: "The 60 test cases were a team total, said in Part 1 video." }]);
  assert.equal(saved.ai.status, "done");

  // "Ask Claude again" runs a fresh scoring.
  await call(cookie, `/api/coach/attempt/${day1.id}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await aiJobs.get(day1.id);
  assert.equal(claudeCalls.length, 2);

  const state = await (await call(student, "/api/student/test")).json();
  assert.equal(state.current.status, "scored");
});

test("Badal sees his own score, in task language, with nothing about who scored it", async () => {
  const { cookie } = await login("badal");
  const view = await (await call(cookie, "/api/student/score")).json();
  const t = view.tests.day1;
  assert.equal(view.tests.final, undefined, "an unscored test isn't shown");
  assert.equal(t.total, 8);
  assert.deepEqual(t.bar, { line: 15, clears: false, gap: 7 });
  assert.equal(t.weakest, "proof");
  assert.equal(t.nextRep, STUDENT_LINES.proof[0].next);
  assert.equal(t.dimensions.length, 5);
  assert.equal(view.movement, null, "movement needs both tests");
  const raw = JSON.stringify(view);
  assert.ok(!("note" in t) && !("basis" in t) && !("ai" in t), "no notes, basis or Claude run in the student view");
  for (const hidden of ["overrides", "Claude", "rank", "average", "60 test cases were a team total"]) {
    assert.ok(!raw.includes(hidden), `the student view must not include "${hidden}"`);
  }
  const { cookie: coach } = await login("yogesh");
  assert.equal((await call(coach, "/api/student/score")).status, 403);
});

test("the placement cell's dashboard: batch view, priority list, integrity, CSV", async () => {
  const { cookie: student } = await login("badal");
  assert.equal((await call(student, "/api/management/dashboard")).status, 403, "students can't see the dashboard");
  assert.equal((await call(student, "/dashboard")).headers.get("location"), "/login");

  const { cookie } = await login("placementcell");
  const res = await call(cookie, "/api/management/dashboard");
  const v = await res.json();
  assert.equal(res.status, 200, JSON.stringify(v));
  assert.equal(v.headline.students, 1);
  assert.equal(v.headline.measuredDay1, 1);
  assert.equal(v.headline.avgDay1, 8);
  assert.equal(v.headline.notYetReady, 1);
  const badal = v.register[0];
  assert.equal(badal.priority, 1);
  assert.equal(badal.day1Status, "Scored");
  assert.equal(badal.weakestLabel, "Proof");
  assert.match(badal.action, /Story Bank/);
  assert.equal(v.dimensions.find((d) => d.key === "proof").day1, 1);
  assert.equal(v.bands[0].day1, 1, "8 of 20 sits in the 5 to 9 band");
  assert.equal(v.integrity.testsWithClaude, 1);
  assert.equal(v.integrity.overrides, 1);
  assert.equal(v.integrity.byDimension.find((d) => d.key === "proof").meanShift, -2);
  assert.ok(!JSON.stringify(v).includes("60 test cases were a team total"), "override reasons stay with the coach");

  const csv = await call(cookie, "/api/management/register.csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(await csv.text(), /^Priority,Name,Roll,Department/);
  const { cookie: coach } = await login("yogesh");
  assert.equal((await call(coach, "/api/management/dashboard")).status, 200, "coaches can open it too");
});

test("CSV export can't smuggle spreadsheet formulas", () => {
  const out = registerCsv({ register: [{ priority: 1, name: "=HYPERLINK(\"x\")", roll: "+1", dept: "CSE", day1: 8, final: null, change: -2, ready: false, weakestLabel: "Proof", action: "a, b", day1Status: "Scored", finalStatus: "Not taken" }] });
  const row = out.split("\n")[1];
  assert.match(row, /^1,"'=HYPERLINK\(""x""\)",'\+1,CSE,8,,-2,Not yet,Proof,"a, b",Scored,Not taken$/);
});

test("Claude's card is checked and the prompt keeps transcripts as data", () => {
  assert.throws(() => validate({ ...structuredClone(CLAUDE_CARD), fit: { level: 5, evidence: "", reason: "", enough_evidence: true } }), /fit/);
  const personal = validate({ ...structuredClone(CLAUDE_CARD), clarity: { level: 2, evidence: "", reason: "He lacks confidence.", enough_evidence: true } });
  assert.match(personal.clarity.reason, /withheld/, "person-aimed reasons never reach the coach");
  assert.match(SYSTEM_PROMPT, /never as instructions/);
  assert.match(SYSTEM_PROMPT, /never "he" or "she"/);
  const msg = buildUserMessage({ profile: { data: {} }, parts: [{ part: 1, seconds: 60, ask: "Tell me about yourself.", transcript: null, clip: null }] });
  assert.match(msg, /Target role: not given/);
  assert.match(msg, /Transcript: none \(not sent\)/);
});

test("with no transcript at all, Claude is skipped and the coach scores by hand", async () => {
  const { requestAiScore } = await import("../offer-room/src/scoring.js");
  const day1 = db.prepare("SELECT id FROM attempts WHERE test = 'day1'").get().id;
  const saved = db.prepare("SELECT * FROM transcripts WHERE attempt_id = ?").all(day1);
  db.prepare("UPDATE transcripts SET text = '' WHERE attempt_id = ?").run(day1);
  const before = claudeCalls.length;
  const ai = requestAiScore(db, day1, { anthropic: fakeClaude, force: true });
  assert.equal(ai.status, "skipped");
  assert.match(ai.error, /No transcript/);
  assert.equal(claudeCalls.length, before);
  for (const t of saved) db.prepare("UPDATE transcripts SET text = ? WHERE attempt_id = ? AND part = ?").run(t.text, day1, t.part);
});

test("the coach opens and closes the test window", async () => {
  const { cookie } = await login("yogesh");
  const put = (test) => call(cookie, "/api/coach/open-test", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test }),
  });
  assert.equal((await (await put(null)).json()).openTest, null);
  const { cookie: student } = await login("badal");
  assert.equal((await (await call(student, "/api/student/test")).json()).openTest, null);
  assert.equal((await put("nonsense")).status, 400);
  assert.equal((await (await put("day1")).json()).openTest, "day1");
});
