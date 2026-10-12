import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const clipDir = fs.mkdtempSync(path.join(os.tmpdir(), "offer-room-clips-"));
process.env.OFFER_ROOM_CLIPS = clipDir;
process.env.OFFER_ROOM_RESUMES = path.join(clipDir, "resumes");
const { openDb, seed } = await import("../offer-room/src/db.js");
const { createApp } = await import("../offer-room/src/app.js");
const { drawQuestions } = await import("../offer-room/src/assessment.js");
const { evaluate, heardRatio, delivery, READ_LINE } = await import("../offer-room/src/roomcheck.js");
const { DatabaseSync } = await import("node:sqlite");

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
  server = http.createServer(createApp(db));
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
  for (let i = 0; i < 5; i++) await login("placementcell", "1");
  const locked = await login("placementcell");
  assert.equal(locked.res.status, 429);
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

  const detail = await (await call(cookie, `/api/coach/attempt/${day1.id}`)).json();
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
    levels: { structure: 2, proof: 1, clarity: 3, presence: 2, fit: 1 },
    strength: "The pace was steady and easy to follow.",
    fix: "Next rep: say what you did, with 'I', not 'we'.",
  };
  assert.equal((await post({ ...good, levels: { ...good.levels, fit: 5 } })).status, 400, "levels are 1 to 4");
  assert.equal((await post({ ...good, weakest: "clarity" })).status, 400, "weakest must be a lowest dimension");
  assert.equal((await post({ ...good, strength: "Great job!" })).status, 400, "strengths come from the stems");
  const personal = await post({ ...good, note: "He is too nervous and lacks confidence" });
  assert.equal(personal.status, 400, "person-aimed notes are refused");
  assert.match((await personal.json()).error, /about the answer/);

  let saved = await (await post({ ...good, weakest: "fit", note: "Part 2 story had no result." })).json();
  assert.equal(saved.status, "scored");
  assert.equal(saved.score.total, 9);
  assert.equal(saved.score.weakest, "fit", "the coach can choose between tied dimensions");

  saved = await (await post({ ...good, levels: { ...good.levels, proof: 2 } })).json();
  assert.equal(saved.score.total, 10, "a re-score replaces the old one");
  assert.equal(saved.score.weakest, "fit");

  const state = await (await call(student, "/api/student/test")).json();
  assert.equal(state.current.status, "scored");
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
