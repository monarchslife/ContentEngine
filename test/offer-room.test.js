import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const clipDir = fs.mkdtempSync(path.join(os.tmpdir(), "offer-room-clips-"));
process.env.OFFER_ROOM_CLIPS = clipDir;
const { openDb, seed } = await import("../offer-room/src/db.js");
const { createApp } = await import("../offer-room/src/app.js");
const { drawQuestions } = await import("../offer-room/src/assessment.js");

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

const clip = (cookie, part, { type = "video/webm", bytes = 2048, header = true } = {}) =>
  call(cookie, `/api/student/test/part/${part}`, {
    method: "POST",
    body: Buffer.alloc(bytes, 1),
    headers: { "Content-Type": type, ...(header && { "X-Offer-Room": "1" }), "X-Duration-Ms": "42000" },
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

  assert.equal((await clip(cookie, 2)).status, 409, "parts go in order");
  assert.equal((await clip(cookie, 1, { header: false })).status, 403, "uploads need the custom header");
  assert.equal((await clip(cookie, 1, { type: "text/html" })).status, 415);
  assert.equal((await clip(cookie, 1)).status, 200);
  assert.equal((await clip(cookie, 1)).status, 409, "no retakes");
  assert.equal((await clip(cookie, 2, { type: "video/mp4;codecs=avc1" })).status, 200);
  state = await (await clip(cookie, 3, { type: "audio/webm;codecs=opus" })).json();

  assert.equal(state.current.status, "submitted");
  assert.equal(state.current.questions, null, "questions are hidden once submitted");
  const files = db.prepare("SELECT file, duration_ms FROM clips").all();
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => fs.existsSync(path.join(clipDir, f.file))));
  assert.equal(files[2].duration_ms, 35000, "duration is clamped to the part's limit");
  assert.equal((await clip(cookie, 3)).status, 409, "a submitted test takes no more uploads");
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
