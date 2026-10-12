import { api } from "./common.js";

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
let pending = null; // { part, blob, durationMs } waiting to upload

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
    audio: { echoCancellation: true, noiseSuppression: true },
    video: video ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
  });
}

function startMeter() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!audioCtx) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      $("check-meter").style.width = `${Math.round(level * 100)}%`;
      if (level > 0.15) $("check-hint").textContent = "Heard you. Mic works. 👍";
      requestAnimationFrame(tick);
    };
    tick();
  } catch { /* the meter is a nicety; recording works without it */ }
}

function useStream(s, isVoiceOnly) {
  stream = s;
  voiceOnly = isVoiceOnly;
  $("check-video").srcObject = isVoiceOnly ? null : s;
  $("check-video").hidden = isVoiceOnly;
  $("check-voice").hidden = !isVoiceOnly;
  $("to-question").disabled = false;
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

$("to-question").addEventListener("click", async () => {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
  ask(nextPart());
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

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    clearInterval(timer);
    $("rec-badge").hidden = true;
    const blob = new Blob(chunks, { type: recorder.mimeType || type || "video/webm" });
    pending = { part, blob, durationMs: performance.now() - started };
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
    state = await api(`/api/student/test/part/${part}`, {
      method: "POST",
      body: blob,
      headers: { "Content-Type": blob.type, "X-Offer-Room": "1", "X-Duration-Ms": String(Math.round(durationMs)) },
    });
  } catch (e) {
    if (e.status === 409) {
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
