// The 15-second room check and the delivery numbers taken from each answer.
// Shared by server and browser (served at /lib/roomcheck.js).
//
// The student's words here are 3AM-friend voice; they only ever describe the
// room or the setup, never the student.

export const QUIET_SECONDS = 5;
export const SPEAK_SECONDS = 10;
export const READ_LINE = "I am getting ready for my placement interviews, and today I am practising out loud.";
export const MAX_TRIES_BEFORE_SKIP = 3;

// dBFS thresholds are measured with noise suppression and auto gain off, so
// what we measure is what we record.
export const LIMITS = {
  noiseDb: -48,       // background above this is too noisy
  speechDb: -40,      // voice below this is too quiet
  snrDb: 15,          // voice must stand this far above the room
  darkLuma: 55,       // average picture brightness (0 to 255) below this is too dark
  brightLuma: 235,    // above this is washed out
  backlight: 45,      // edges brighter than the face area by this much means light behind
  blur: 4,            // mean edge strength below this looks blurry (warning only)
  heardRatio: 0.5,    // share of the read-aloud line the transcript caught (warning only)
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// Keeps only known numeric fields so the stored record stays small and honest.
export function cleanMetrics(m = {}) {
  return {
    voiceOnly: m.voiceOnly === true,
    noiseDb: num(m.noiseDb),
    speechDb: num(m.speechDb),
    luma: num(m.luma),
    backlight: num(m.backlight),
    blur: num(m.blur),
    transcript: {
      supported: m.transcript?.supported === true,
      heard: String(m.transcript?.heard || "").slice(0, 300),
      ratio: num(m.transcript?.ratio),
    },
  };
}

// Returns each check with pass/fail and the fix in the student's voice.
// Hard checks block the test; soft ones only warn.
export function evaluate(raw) {
  const m = cleanMetrics(raw);
  const checks = [];
  const add = (key, label, ok, fix, hard = true) => checks.push({ key, label, ok, hard, fix: ok ? null : fix });

  if (m.noiseDb != null) {
    add("noise", "Quiet room", m.noiseDb <= LIMITS.noiseDb,
      "It's noisy around you. Find a quieter corner, shut the door, fan off if you can.");
  }
  if (m.speechDb != null) {
    add("voice", "Your voice comes through", m.speechDb >= LIMITS.speechDb,
      m.speechDb < -100
        ? "We got total silence, like the mic is muted. Check the mute switch or the browser's mic permission, then reload."
        : "We could barely hear you. Get closer to the mic, or plug in earphones with a mic.");
  }
  // Only meaningful once the voice itself is loud enough; a silent mic is
  // already caught above. Real rooms never go below about -90 dB.
  if (m.speechDb != null && m.noiseDb != null && m.speechDb >= LIMITS.speechDb) {
    add("clear", "Voice stands out from the background", m.speechDb - Math.max(m.noiseDb, -90) >= LIMITS.snrDb,
      "Your voice is getting lost in the background. Quieter spot, or earphones with a mic.");
  }
  if (!m.voiceOnly && m.luma != null) {
    add("light", "Enough light on your face", m.luma >= LIMITS.darkLuma && m.luma <= LIMITS.brightLuma,
      m.luma < LIMITS.darkLuma
        ? "It's too dark. Face a window or put a lamp in front of you."
        : "The picture is washed out. Move away from direct sunlight.");
  }
  if (!m.voiceOnly && m.backlight != null) {
    add("backlight", "Light in front, not behind", m.backlight <= LIMITS.backlight,
      "The light is behind you, so your face goes dark. Turn around so the light hits your face.");
  }
  if (!m.voiceOnly && m.blur != null) {
    add("sharp", "Picture is sharp", m.blur >= LIMITS.blur,
      "The picture looks blurry. Wipe the camera lens (it's usually a fingerprint).", false);
  }
  if (!m.transcript.supported) {
    add("words", "Live transcript works here", false,
      "This browser can't write down what you say. Chrome on a laptop works best for this test.", false);
  } else {
    add("words", "We caught your words", (m.transcript.ratio ?? 0) >= LIMITS.heardRatio,
      "We couldn't catch the words clearly. Speak a little slower and closer to the mic.", false);
  }
  return { metrics: m, checks, passed: checks.every((c) => c.ok || !c.hard) };
}

// Share of the read-aloud line's words that showed up in what was heard.
export function heardRatio(heard = "", line = READ_LINE) {
  const words = (s) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const want = [...new Set(words(line))];
  const got = new Set(words(heard));
  return want.length ? want.filter((w) => got.has(w)).length / want.length : 0;
}

// ---------------- delivery numbers for one answer ----------------

const FILLERS = /\b(um+|uh+|umm+|hmm+|er+|basically|actually|you know|like i said|i mean|na)\b/gi;

// audio: { startDelayMs, longPauses, longestPauseMs, speakingMs, levelDb } measured live
export function delivery(text = "", durationMs = 0, audio = {}) {
  const words = (text.trim().match(/[A-Za-z0-9']+/g) || []).length;
  const startDelayMs = num(audio.startDelayMs);
  const talkMs = Math.max(1, durationMs - (startDelayMs || 0));
  return {
    words,
    wpm: words ? Math.round(words / (talkMs / 60000)) : null,
    fillers: (text.match(FILLERS) || []).length,
    startDelayMs,
    longPauses: Number.isInteger(audio.longPauses) ? audio.longPauses : null,
    longestPauseMs: num(audio.longestPauseMs),
    speakingMs: num(audio.speakingMs),
    levelDb: num(audio.levelDb),
  };
}
