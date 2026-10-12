import { api, el } from "./common.js";
import { QUIET_SECONDS, SPEAK_SECONDS, READ_LINE, evaluate, heardRatio } from "/lib/roomcheck.js";

const $ = (id) => document.getElementById(id);
const SECTIONS = ["s-intro", "s-check", "s-question", "s-saved", "s-done", "s-closed"];
const show = (id) => { SECTIONS.forEach((s) => { $(s).hidden = s !== id; }); window.scrollTo(0, 0); };

const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const COUNTDOWN = 5;
const MIN_BEFORE_DONE = 3; // seconds, so a nervous double-tap can't end the answer

const AFTER_PART = {
  1: { title: "Part 1, done.", body: "Breathe. The next one's a story question. You get 90 seconds." },
  2: { title: "Two down.", body: "Last one's a curveball. Only 30 seconds, so keep it short and straight." },
};

let state;
let stream = null;
let voiceOnly = false;
let audioCtx = null;
let wakeLock = null;
let busy = false; // recording or uploading
let pending = null; // { part, blob, durationMs, transcript } waiting to upload
let analyser = null;
let lastMetrics = null; // from the latest room check
let sitting = null; // proof of this session's room check; gone on reload
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const FATAL_SR = new Set(["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"]);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.ceil(s)) % 60).padStart(2, "0")}`;
const pickType = (list) => list.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
const nextPart = () => state.current.partsDone.length + 1;
const question = (part) => state.current.questions[part - 1];

window.addEventListener("beforeunload", (e) => { if (busy) { e.preventDefault(); e.returnValue = ""; } });

// ---------------- 1. intro ----------------
function intro() {
  const cur = state.current;
  $("intro-eyebrow").textContent = `${state.openLabel} · Three-Minute Test`;
  if (cur?.status === "in_progress") {
    $("intro-title").textContent = `Welcome back. Question ${nextPart()} of 3 is next.`;
    $("consent-card").hidden = true;
    $("to-check").disabled = false;
  }
  $("consent").addEventListener("change", (e) => { $("to-check").disabled = !e.target.checked; });
  $("to-check").addEventListener("click", async () => {
    // Browsers keep audio paused unless it starts inside a tap, so make it here.
    try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no meter */ }
    $("to-check").disabled = true;
    try {
      if (!state.current) state = await api("/api/student/test/start", { method: "POST", json: { consent: true } });
      check();
    } catch (e) {
      $("to-check").disabled = false;
      alert(e.message);
    }
  });
  show("s-intro");
}

// ---------------- 2. device check ----------------
async function getStream(video) {
  return navigator.mediaDevices.getUserMedia({
    // No noise filtering or auto volume: the room check should measure exactly what gets recorded.
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    video: video ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
  });
}

// Loudness of the mic right now, in dBFS (0 is the loudest possible).
function levelDb() {
  if (!analyser) return -100;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return 20 * Math.log10(Math.sqrt(sum / data.length) + 1e-9);
}

function startMeter() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const tick = () => {
      if (!audioCtx) return;
      const level = Math.max(0, Math.min(1, (levelDb() + 60) / 50));
      $("check-meter").style.width = `${Math.round(level * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
  } catch { analyser = null; }
}

function useStream(s, isVoiceOnly) {
  stream = s;
  voiceOnly = isVoiceOnly;
  $("check-video").srcObject = isVoiceOnly ? null : s;
  $("check-video").hidden = isVoiceOnly;
  $("check-voice").hidden = !isVoiceOnly;
  $("rc-run").disabled = false;
  startMeter();
}

async function check() {
  show("s-check");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $("check-error").textContent = "This browser can't record. Open the link in Chrome (Android or PC) or Safari (iPhone) and you're set.";
    $("check-error").hidden = false;
    return;
  }
  try {
    useStream(await getStream(true), false);
  } catch {
    $("check-error").textContent = "Couldn't reach your camera. Allow it from the little lock icon next to the address bar and reload. Or just do it with your voice.";
    $("check-error").hidden = false;
    $("voice-only").hidden = false;
  }
}

$("voice-only").addEventListener("click", async () => {
  try {
    useStream(await getStream(false), true);
    $("check-error").hidden = true;
    $("voice-only").hidden = true;
  } catch {
    $("check-error").textContent = "Couldn't reach your mic either. Check the browser's permissions (lock icon by the address bar), then reload this page.";
  }
});

// Picture numbers from one small grey frame: brightness, light behind the
// face (edges brighter than the middle) and sharpness (edge strength).
function frameStats() {
  const v = $("check-video");
  if (voiceOnly || !v.videoWidth) return null;
  const W = 160, H = 120;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  let all = 0, mid = 0, nMid = 0, edge = 0, nEdge = 0, lap = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const val = g[y * W + x];
      all += val;
      const inMid = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.8;
      if (inMid) { mid += val; nMid++; } else { edge += val; nEdge++; }
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        lap += Math.abs(4 * val - g[y * W + x - 1] - g[y * W + x + 1] - g[(y - 1) * W + x] - g[(y + 1) * W + x]);
      }
    }
  }
  return { luma: all / (W * H), backlight: edge / nEdge - mid / nMid, blur: lap / ((W - 2) * (H - 2)) };
}

// Listens for a while and returns what it heard (null if the browser can't).
function listen() {
  if (!SR) return { stop: async () => ({ supported: false, heard: "" }) };
  let heard = "";
  let fatal = null;
  let rec;
  try {
    rec = new SR();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(" "); };
    rec.onerror = (e) => { if (FATAL_SR.has(e.error)) fatal = e.error; };
    rec.start();
  } catch { fatal = "start-failed"; }
  return {
    stop: () => new Promise((resolve) => {
      const done = () => resolve({ supported: !fatal, heard });
      try { rec.onend = done; rec.stop(); } catch { done(); }
      setTimeout(done, 1500);
    }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function countdown(seconds, onTick) {
  const box = $("rc-count");
  box.hidden = false;
  for (let n = seconds; n > 0; n--) {
    box.textContent = n;
    for (let i = 0; i < 10; i++) { onTick(); await sleep(100); }
  }
  box.hidden = true;
}

async function runRoomCheck() {
  await audioCtx?.resume?.();
  for (const id of ["rc-run", "to-question", "rc-skip", "voice-only"]) $(id).hidden = id !== "rc-run";
  $("rc-run").disabled = true;
  $("rc-results").hidden = true;
  $("check-error").hidden = true;
  const frames = [];
  let tick = 0;
  const grab = () => { if (tick++ % 5 === 0) { const f = frameStats(); if (f) frames.push(f); } };

  $("rc-title").textContent = "Shh. Stay quiet for 5 seconds.";
  $("rc-lede").textContent = "We're listening to your room, not you. Don't touch the phone.";
  const quiet = [];
  await countdown(QUIET_SECONDS, () => { quiet.push(levelDb()); grab(); });

  $("rc-title").textContent = "Now read this out loud.";
  $("rc-lede").textContent = "Normal voice, like you're talking to someone across the table.";
  $("rc-line-text").textContent = READ_LINE;
  $("rc-line").hidden = false;
  const loud = [];
  const ear = listen();
  await countdown(SPEAK_SECONDS, () => { loud.push(levelDb()); grab(); });
  const words = await ear.stop();
  $("rc-line").hidden = true;

  const top = [...loud].sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(loud.length / 2)));
  const avg = (xs, k) => (xs.length ? xs.reduce((a, f) => a + f[k], 0) / xs.length : null);
  const metrics = {
    voiceOnly,
    noiseDb: analyser ? median(quiet) : null,
    speechDb: analyser ? top.reduce((a, b) => a + b, 0) / top.length : null,
    luma: avg(frames, "luma"),
    backlight: avg(frames, "backlight"),
    blur: avg(frames, "blur"),
    transcript: { supported: words.supported, heard: words.heard, ratio: heardRatio(words.heard) },
  };
  lastMetrics = metrics;
  await submitRoomCheck(metrics, false);
}

async function submitRoomCheck(metrics, skip) {
  let result;
  try {
    result = await api("/api/student/test/room-check", { method: "POST", json: { metrics, skip } });
  } catch (e) {
    result = { ...evaluate(metrics), canStart: false, canSkip: false };
    $("check-error").textContent = `Couldn't save the check: ${e.message}. Try again in a sec.`;
    $("check-error").hidden = false;
  }
  $("rc-list").replaceChildren(...result.checks.map((c) =>
    el("li", { class: c.ok ? "ok" : c.hard ? "bad" : "warn" },
      el("b", {}, `${c.ok ? "✓" : c.hard ? "✗" : "!"} ${c.label}`),
      c.fix ? el("span", { class: "muted small" }, c.fix) : null)));
  $("rc-results").hidden = false;
  $("rc-run").disabled = false;
  if (result.canStart) {
    sitting = result.sitting;
    $("rc-title").textContent = result.passed ? "Your room's good to go. 🎉" : "Okay, going ahead.";
    $("rc-lede").textContent = result.passed
      ? "Everything we need is working. Take a breath. The first question appears with a 5-second countdown."
      : "Yogesh will see the room check didn't pass, so no stress about the setup.";
    $("rc-run").hidden = true;
    $("to-question").hidden = false;
  } else {
    $("rc-title").textContent = "Let's fix your setup first.";
    $("rc-lede").textContent = "Sort out the red ones, then run it again. It's only 15 seconds.";
    $("rc-run").textContent = "Run the check again";
    $("rc-skip").hidden = !result.canSkip;
    $("rc-skip").textContent = "I can't fix it. Continue anyway";
  }
  window.scrollTo(0, 0);
}

$("rc-run").addEventListener("click", runRoomCheck);
$("rc-skip").addEventListener("click", () => submitRoomCheck(lastMetrics, true));

$("to-question").addEventListener("click", async () => {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
  if (pending) upload(); // an answer recorded before the check was redone
  else ask(nextPart());
});

// ---------------- 3. question + recording ----------------
function ask(part) {
  const q = question(part);
  $("q-part").textContent = `Part ${part} of 3 · ${q.seconds} seconds`;
  $("q-ask").textContent = q.ask;
  [...$("steps").children].forEach((s, i) => { s.className = i + 1 < part ? "done" : i + 1 === part ? "now" : ""; });
  $("live-video").srcObject = voiceOnly ? null : stream;
  $("live-video").hidden = voiceOnly;
  $("live-voice").hidden = !voiceOnly;
  $("clock").textContent = fmt(q.seconds);
  $("clock-label").textContent = "Read the question. Recording starts in a moment.";
  $("bar").style.width = "0%";
  $("track").classList.remove("ending");
  $("done").disabled = true;
  show("s-question");

  let n = COUNTDOWN;
  const overlay = $("countdown");
  overlay.textContent = n;
  overlay.hidden = false;
  const t = setInterval(() => {
    n -= 1;
    if (n > 0) { overlay.textContent = n; return; }
    clearInterval(t);
    overlay.hidden = true;
    record(part, q.seconds);
  }, 1000);
}

// Writes down the answer while it's spoken. Chrome stops listening after a
// pause, so it restarts until the answer ends.
function transcriber() {
  if (!SR) return { start() {}, stop: async () => ({ supported: false, error: "unsupported", segments: [] }) };
  const segments = [];
  let rec = null;
  let active = false;
  let error = null;
  let t0 = 0;
  let ended = null;
  const begin = () => {
    rec = new SR();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal && r[0].transcript.trim()) {
          segments.push({ t: Math.round(performance.now() - t0), text: r[0].transcript.trim(), confidence: r[0].confidence });
        }
      }
    };
    rec.onerror = (e) => { if (FATAL_SR.has(e.error)) error = e.error; };
    rec.onend = () => {
      if (active && !error) { try { begin(); return; } catch { error = "restart-failed"; } }
      ended?.();
    };
    rec.start();
  };
  return {
    start() {
      active = true;
      t0 = performance.now();
      try { begin(); } catch { error = "start-failed"; }
    },
    stop() {
      active = false;
      return new Promise((resolve) => {
        const done = () => resolve({ supported: !error || segments.length > 0, error, segments });
        ended = done;
        try { rec?.stop(); } catch { done(); }
        setTimeout(done, 2000);
      });
    },
  };
}

function record(part, limit) {
  busy = true;
  const type = pickType(voiceOnly ? AUDIO_TYPES : VIDEO_TYPES);
  const tracks = voiceOnly ? stream.getAudioTracks() : stream.getTracks();
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    ...(type && { mimeType: type }),
    ...(voiceOnly ? { audioBitsPerSecond: 64_000 } : { videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 }),
  });
  const chunks = [];
  const started = performance.now();
  let timer;

  // Delivery from the audio itself: when speech starts, long pauses, loudness.
  const floor = Math.max(lastMetrics?.noiseDb ?? -60, -65);
  const audio = { firstSpeech: null, silenceSince: null, longPauses: 0, longestPauseMs: 0, speechFrames: 0, levelSum: 0 };
  const sample = setInterval(() => {
    const db = levelDb();
    const now = performance.now() - started;
    if (db > floor + 10 && db > -55) {
      if (audio.firstSpeech == null) audio.firstSpeech = now;
      if (audio.silenceSince != null) {
        const gap = now - audio.silenceSince;
        if (gap >= 2000) audio.longPauses += 1;
        audio.longestPauseMs = Math.max(audio.longestPauseMs, gap);
      }
      audio.silenceSince = null;
      audio.speechFrames += 1;
      audio.levelSum += db;
    } else if (audio.firstSpeech != null && audio.silenceSince == null) {
      audio.silenceSince = now;
    }
  }, 100);

  const words = transcriber();
  words.start();
  $("tx-status").hidden = false;
  $("tx-status").textContent = SR ? "📝 Writing down your answer as you speak." : "This browser can't write down your answer. Your recording still counts.";

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    clearInterval(timer);
    clearInterval(sample);
    $("rec-badge").hidden = true;
    $("tx-status").hidden = true;
    const durationMs = performance.now() - started;
    const blob = new Blob(chunks, { type: recorder.mimeType || type || "video/webm" });
    const heard = await words.stop();
    pending = {
      part, blob, durationMs,
      transcript: {
        ...heard,
        durationMs: Math.round(durationMs),
        audio: analyser ? {
          startDelayMs: audio.firstSpeech == null ? null : Math.round(audio.firstSpeech),
          longPauses: audio.longPauses,
          longestPauseMs: Math.round(audio.longestPauseMs),
          speakingMs: audio.speechFrames * 100,
          levelDb: audio.speechFrames ? audio.levelSum / audio.speechFrames : null,
        } : {},
      },
    };
    upload();
  };

  const stop = () => { if (recorder.state === "recording") recorder.stop(); };
  $("done").onclick = stop;
  recorder.start(1000);
  $("rec-badge").hidden = false;
  $("clock-label").textContent = "seconds left";

  timer = setInterval(() => {
    const elapsed = (performance.now() - started) / 1000;
    const left = limit - elapsed;
    $("clock").textContent = fmt(left);
    $("bar").style.width = `${Math.min(100, (elapsed / limit) * 100)}%`;
    $("track").classList.toggle("ending", left <= 10);
    if (elapsed >= MIN_BEFORE_DONE) $("done").disabled = false;
    if (left <= 0) stop();
  }, 250);
}

// ---------------- 4. upload ----------------
async function upload() {
  const { part, blob, durationMs } = pending;
  $("saved-emoji").textContent = "⏳";
  $("saved-title").textContent = "Saving your answer…";
  $("saved-body").textContent = "Don't close this page for a sec.";
  $("save-error").hidden = true;
  $("retry").hidden = true;
  $("next").hidden = true;
  show("s-saved");
  try {
    // The transcript goes first: the last recording closes the test.
    await api(`/api/student/test/part/${part}/transcript`, { method: "POST", json: pending.transcript, headers: { "X-Sitting": sitting } });
    state = await api(`/api/student/test/part/${part}`, {
      method: "POST",
      body: blob,
      headers: { "Content-Type": blob.type, "X-Offer-Room": "1", "X-Duration-Ms": String(Math.round(durationMs)), "X-Sitting": sitting },
    });
  } catch (e) {
    if (e.status === 428) {
      // The server doesn't know this session yet: check the room, then send the kept answer.
      $("rc-title").textContent = "Quick room check, then we'll send your answer.";
      $("rc-run").hidden = false;
      $("rc-run").disabled = false;
      $("to-question").hidden = true;
      $("rc-results").hidden = true;
      show("s-check");
      return;
    } else if (e.status === 409) {
      state = await api("/api/student/test"); // already saved, e.g. a double send
    } else {
      $("saved-emoji").textContent = "📶";
      $("saved-title").textContent = "Upload hiccup.";
      $("saved-body").textContent = "Your answer is safe on this phone. Check your internet and send it again.";
      $("save-error").textContent = e.message;
      $("save-error").hidden = false;
      $("retry").hidden = false;
      return;
    }
  }
  pending = null;
  busy = false;
  if (state.current?.status !== "in_progress") return finish();
  $("saved-emoji").textContent = "✅";
  $("saved-title").textContent = AFTER_PART[part].title;
  $("saved-body").textContent = AFTER_PART[part].body;
  $("next").hidden = false;
}

$("retry").addEventListener("click", upload);
$("next").addEventListener("click", () => ask(nextPart()));

function finish() {
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  audioCtx = null;
  wakeLock?.release?.();
  show("s-done");
}

// ---------------- start ----------------
state = await api("/api/student/test");
const cur = state.current;
if (!state.onboarded) {
  $("closed-title").textContent = "Quick thing first.";
  $("closed-body").textContent = "Fill in your profile (five minutes), then the test unlocks.";
  $("closed-go").href = "/onboarding";
  $("closed-go").textContent = "Fill in my profile";
  show("s-closed");
} else if (!state.openTest) {
  $("closed-body").textContent = "No test is open right now. Chill. We'll tell you the moment the next one opens.";
  show("s-closed");
} else if (cur && cur.status !== "in_progress") {
  $("closed-title").textContent = "This one's already done.";
  $("closed-body").textContent = "Your answers are with Yogesh for scoring. Nothing else to do here.";
  show("s-closed");
} else {
  intro();
}
