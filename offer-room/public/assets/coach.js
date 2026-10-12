import { api, logout, el } from "./common.js";
import {
  DIMENSIONS, DIMENSION_LABEL, LEVEL_NAMES, ANCHORS, STRENGTH_STEMS, FIX_STEMS, total, lowest, lintNote,
} from "/lib/rubric.js";

const $ = (id) => document.getElementById(id);
const READY_LINE = 15;
const STATUS = { submitted: "Waiting", in_progress: "Still recording", scored: "Scored" };

$("logout").addEventListener("click", logout);

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

// ---------------- list ----------------
function renderOpen(q) {
  for (const b of $("open-test").children) {
    const on = (b.dataset.test || null) === q.openTest;
    b.setAttribute("aria-checked", on);
    b.classList.toggle("on", on);
  }
  $("open-hint").textContent = q.openTest
    ? `Students can take the ${q.openLabel} test from their room now.`
    : "No test is open. Students see \"No test open right now\".";
}

function row(a) {
  return el("a", { class: "item", href: `#/attempt/${a.id}` },
    el("span", { class: "item-main" },
      el("b", {}, a.student.name),
      el("span", { class: "muted small" }, [a.student.roll, a.student.dept, `${a.label} test`].filter(Boolean).join(" · "))),
    el("span", { class: "item-side" },
      a.total != null ? el("b", { class: "num" }, `${a.total}/20`) : null,
      el("span", { class: `pill ${a.status === "scored" ? "good" : ""}` }, STATUS[a.status]),
      el("span", { class: "muted small" }, when(a.scoredAt || a.submittedAt))));
}

async function showList() {
  const q = await api("/api/coach/queue");
  renderOpen(q);
  const todo = q.attempts.filter((a) => a.status !== "scored");
  const done = q.attempts.filter((a) => a.status === "scored");
  $("todo").replaceChildren(...(todo.length ? todo.map(row) : [el("p", { class: "muted" }, "Nothing waiting. When a student submits a test, it shows up here.")]));
  $("done").replaceChildren(...(done.length ? done.map(row) : [el("p", { class: "muted" }, "Nothing scored yet.")]));
  $("v-score").hidden = true;
  $("v-list").hidden = false;
}

$("open-test").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  renderOpen(await api("/api/coach/open-test", { method: "PUT", json: { test: b.dataset.test || null } }));
});

// ---------------- score one sitting ----------------
const levels = {};
const reasons = {}; // why the coach changed one of Claude's levels
let weakest = null;
let current = null;
let pollTimer = null;
const AI_DIMS = ["structure", "proof", "clarity", "fit"];
const claudeLevel = (d) => (current?.ai?.status === "done" && AI_DIMS.includes(d) ? current.ai.result[d].level : null);

const WHY_NO_TRANSCRIPT = {
  unsupported: "The student's browser can't transcribe.",
  "not-allowed": "The browser blocked the transcript.",
  "service-not-allowed": "The browser blocked the transcript.",
  network: "The transcript service couldn't be reached.",
  "audio-capture": "The browser couldn't share the mic with the transcript.",
};

function deliveryFacts(d) {
  if (!d) return null;
  const facts = [
    d.wpm != null && `${d.wpm} words/min`,
    d.words ? `${d.words} words` : null,
    d.startDelayMs != null && `started after ${(d.startDelayMs / 1000).toFixed(1)}s`,
    d.longPauses != null && `${d.longPauses} pause${d.longPauses === 1 ? "" : "s"} over 2s`,
    d.fillers ? `${d.fillers} filler${d.fillers === 1 ? "" : "s"}` : null,
    d.levelDb != null && `voice ${Math.round(d.levelDb)} dB`,
  ].filter(Boolean);
  return facts.length ? el("ul", { class: "facts" }, ...facts.map((f) => el("li", {}, f))) : null;
}

function transcriptBlock(t) {
  if (!t) return el("p", { class: "said missing" }, "No transcript was sent for this answer.");
  const text = t.text
    ? el("p", { class: "said" }, `“${t.text}”`)
    : el("p", { class: "said missing" }, WHY_NO_TRANSCRIPT[t.error] || (t.error ? `No transcript (${t.error}).` : "Nothing was picked up."));
  return el("div", {}, text, deliveryFacts(t.delivery));
}

function roomCheckBlock(rc) {
  if (!rc) return [el("p", { class: "eyebrow" }, "Room check"), el("p", { class: "muted" }, "No room check on record.")];
  const verdict = rc.passed ? "Passed" : rc.skipped ? `Did not pass; student continued after ${rc.tries} tries` : "Did not pass";
  return [
    el("p", { class: "eyebrow" }, "Room check"),
    el("p", {}, el("span", { class: `pill ${rc.passed ? "good" : ""}` }, verdict)),
    el("ul", { class: "checks" }, ...rc.checks.map((c) =>
      el("li", { class: c.ok ? "ok" : c.hard ? "bad" : "warn" }, el("b", {}, `${c.ok ? "✓" : c.hard ? "✗" : "!"} ${c.label}`)))),
  ];
}

function answerBlock(p) {
  const media = p.clip
    ? el(p.clip.mime.startsWith("audio") ? "audio" : "video", { controls: "", preload: "metadata", playsinline: "", src: `/api/coach/clip/${p.clip.id}` })
    : el("p", { class: "muted" }, "Not recorded.");
  return el("div", { class: "card answer" },
    el("div", { class: "recruiter small-q" },
      el("p", { class: "who" }, el("span", {}, `Part ${p.part}`), el("span", {}, `${p.seconds} seconds`)),
      el("blockquote", {}, p.ask)),
    media,
    transcriptBlock(p.transcript),
    p.clip?.durationMs != null ? el("p", { class: "muted small" }, `Spoke for ${mmss(p.clip.durationMs)} of ${mmss(p.seconds * 1000)}`) : null);
}

function profileCard(a) {
  const p = a.profile;
  const d = p.data;
  if (!p.completed && !Object.keys(d).length) return [el("p", { class: "eyebrow" }, "Student profile"), el("p", { class: "muted" }, "Not filled in yet.")];
  const rows = [
    ["Target role", [d.roleText, d.roleFamily && `(${d.roleFamily})`].filter(Boolean).join(" ")],
    ["Degree", [d.degree, d.branch, d.gradYear && `graduating ${d.gradYear}`].filter(Boolean).join(", ")],
    ["College", d.college],
    ["Dream companies", d.companies],
    ["Relocation", d.relocation],
    ["Night shifts", d.nightShifts],
    ["Languages", (d.languages || []).join(", ")],
    ["Projects", d.projects],
    ["Other", d.otherProof],
  ].filter(([, v]) => v);
  const resume = p.resume
    ? el("a", { href: `/api/coach/student/${a.studentId}/resume`, target: "_blank", rel: "noopener" }, `Open resume (${p.resume.name})`)
    : el("span", { class: "muted" }, d.noResume ? "No resume yet (student said so)." : "No resume uploaded.");
  return [
    el("p", { class: "eyebrow" }, p.completed ? "Student profile" : "Student profile (incomplete)"),
    el("dl", { class: "profile-grid" }, ...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    el("p", { class: "small resume-line" }, resume),
  ];
}

function claudeNote(d) {
  const ai = current.ai;
  if (d === "presence") return el("p", { class: "who-scores muted small" }, "You score this one, from the video.");
  if (ai.status !== "done") return null;
  const x = ai.result[d];
  return el("div", { class: "claude" },
    el("p", { class: "claude-head" },
      el("span", { class: "pill" }, `Claude: ${x.level} · ${LEVEL_NAMES[x.level - 1]}`),
      x.enough_evidence ? null : el("span", { class: "muted small" }, "thin evidence")),
    x.evidence ? el("p", { class: "claude-quote small" }, `“${x.evidence}”`) : null,
    el("p", { class: "small" }, x.reason));
}

function dimBlock(d) {
  const anchor = el("p", { class: "anchor muted small" }, "Pick 1 to 4.");
  const seg = el("div", { class: "segmented levels", role: "radiogroup", "aria-label": DIMENSION_LABEL[d] },
    ...[1, 2, 3, 4].map((n) => el("button", {
      type: "button", role: "radio", "aria-checked": "false", "data-level": n,
      title: ANCHORS[d][n - 1],
      onclick: () => { levels[d] = n; refresh(); },
    }, el("b", {}, String(n)), el("span", {}, LEVEL_NAMES[n - 1]))));
  const why = el("div", { class: "field override", hidden: "" },
    el("label", { for: `why-${d}` }, "Why change Claude's score? ", el("span", { class: "muted" }, "(logged)")),
    el("textarea", { id: `why-${d}`, rows: "2", maxlength: "300", placeholder: "About the answer. e.g. The transcript missed the result he gave in Part 2." }));
  why.querySelector("textarea").value = reasons[d] || "";
  why.querySelector("textarea").addEventListener("input", (e) => { reasons[d] = e.target.value; refresh(); });
  return el("div", { class: "dim", "data-dim": d }, el("p", { class: "dim-name" }, DIMENSION_LABEL[d]), claudeNote(d), seg, anchor, why);
}

function aiBanner() {
  const ai = current.ai;
  const again = el("button", { type: "button", class: "btn ghost small-btn", onclick: askAgain }, "Ask Claude again");
  const box = $("ai-status");
  box.className = `ai-status ${ai.status}`;
  const text = {
    off: "Claude scoring is off on this server (no API key), so score all five yourself.",
    none: "Claude hasn't scored this test yet.",
    pending: "Claude is scoring Structure, Proof, Clarity and Fit. Usually under a minute.",
    done: `Claude scored Structure, Proof, Clarity and Fit${ai.result?.confidence ? ` (confidence: ${ai.result.confidence})` : ""}. You score Presence. Change any of Claude's levels if you disagree; you'll be asked why.`,
    failed: `Claude couldn't score this test: ${ai.error || "unknown error"}. Score by hand, or ask again.`,
    skipped: ai.error || "Claude skipped this test.",
  }[ai.status];
  box.replaceChildren(...[
    el("p", {}, text),
    ai.status === "done" && ai.result.notes_for_coach ? el("p", { class: "small" }, `Note from Claude: ${ai.result.notes_for_coach}`) : null,
    ["done", "failed"].includes(ai.status) ? again : null,
  ].filter(Boolean));
}

async function askAgain() {
  const fresh = await api(`/api/coach/attempt/${current.id}/ai`, { method: "POST", json: {} });
  applyAi(fresh);
}

// Claude's result can land while the coach is on the page: fill in only what
// the coach hasn't touched yet.
function applyAi(fresh) {
  const was = current.ai.status;
  current.ai = fresh.ai;
  if (fresh.ai.status === "done" && was !== "done" && !current.score) {
    for (const d of AI_DIMS) levels[d] ??= fresh.ai.result[d].level;
    if (!$("strength").value) $("strength").value = fresh.ai.result.strength;
    if (!$("fix").value) $("fix").value = fresh.ai.result.fix;
  }
  aiBanner();
  $("dims").replaceChildren(...DIMENSIONS.map(dimBlock));
  refresh();
  poll();
}

function poll() {
  clearTimeout(pollTimer);
  if (current?.ai.status !== "pending") return;
  const id = current.id;
  pollTimer = setTimeout(async () => {
    if (current?.id !== id || $("v-score").hidden) return;
    try { applyAi(await api(`/api/coach/attempt/${id}`)); } catch { poll(); }
  }, 4000);
}

function refresh() {
  for (const d of DIMENSIONS) {
    const box = document.querySelector(`.dim[data-dim="${d}"]`);
    for (const b of box.querySelectorAll("button")) {
      const on = Number(b.dataset.level) === levels[d];
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    }
    box.querySelector(".anchor").textContent = levels[d] ? ANCHORS[d][levels[d] - 1] : "Pick 1 to 4.";
    const changed = claudeLevel(d) != null && levels[d] != null && levels[d] !== claudeLevel(d);
    box.querySelector(".override").hidden = !changed;
  }
  const missingWhy = AI_DIMS.filter((d) => claudeLevel(d) != null && levels[d] != null && levels[d] !== claudeLevel(d)
    && (reasons[d] || "").trim().length < 5);
  const whyLint = AI_DIMS.map((d) => (levels[d] !== claudeLevel(d) ? lintNote(reasons[d] || "") : null)).find(Boolean);
  const complete = DIMENSIONS.every((d) => levels[d]);
  const t = complete ? total(levels) : null;
  $("total").textContent = t ?? "–";
  const pill = $("ready-pill");
  pill.textContent = t == null ? `Ready line ${READY_LINE}` : t >= READY_LINE ? "At or above the Ready line" : `${READY_LINE - t} below the Ready line`;
  pill.className = `pill ${t != null && t >= READY_LINE ? "good" : ""}`;

  const tied = complete ? lowest(levels) : [];
  if (!tied.includes(weakest)) weakest = tied[0] || null;
  $("weak").replaceChildren(...tied.map((d) => el("button", {
    type: "button", role: "radio", class: d === weakest ? "on" : "", "aria-checked": String(d === weakest),
    onclick: () => { weakest = d; refresh(); },
  }, DIMENSION_LABEL[d])));
  $("weak-hint").textContent = !complete ? "Score all five to see it."
    : tied.length > 1 ? "Tied. Pick the one the student should work on first." : "The lowest-scored dimension.";

  for (const id of ["strength", "fix"]) {
    $(`${id}-preview`).textContent = $(id).value;
    $(`${id}-preview`).hidden = !$(id).value;
  }

  const lint = lintNote($("note").value);
  $("note-lint").textContent = lint || "";
  $("save").disabled = !complete || !$("strength").value || !$("fix").value || Boolean(lint) || missingWhy.length > 0 || Boolean(whyLint);
  $("save-hint").textContent = whyLint || (missingWhy.length
    ? `Say why you changed Claude's ${missingWhy.map((d) => DIMENSION_LABEL[d]).join(" and ")} score.`
    : complete ? "" : "Score all five, including Presence.");
}

function options(select, stems, chosen) {
  select.replaceChildren(el("option", { value: "" }, "Choose…"), ...stems.map((s) => el("option", { value: s }, s)));
  select.value = chosen || "";
}

async function showAttempt(id) {
  current = await api(`/api/coach/attempt/${id}`);
  $("s-title").textContent = `${current.student.name} · ${current.label} test`;
  $("s-sub").textContent = [current.student.roll, current.student.dept, current.submittedAt && `submitted ${when(current.submittedAt)}`].filter(Boolean).join(" · ");
  $("profile").replaceChildren(...profileCard(current));
  $("room").replaceChildren(...roomCheckBlock(current.roomCheck));
  $("answers").replaceChildren(...current.parts.map(answerBlock));
  for (const d of DIMENSIONS) levels[d] = current.score?.levels[d] || claudeLevel(d) || null;
  for (const d of AI_DIMS) reasons[d] = current.score?.basis?.overrides?.find((o) => o.dimension === d)?.reason || "";
  $("dims").replaceChildren(...DIMENSIONS.map(dimBlock));
  weakest = current.score?.weakest || null;
  const suggested = current.ai.status === "done" ? current.ai.result : {};
  options($("strength"), STRENGTH_STEMS, current.score?.strength || suggested.strength);
  options($("fix"), FIX_STEMS, current.score?.fix || suggested.fix);
  aiBanner();
  poll();
  $("note").value = current.score?.note || "";
  $("save").textContent = current.score ? "Update score" : "Save score";
  $("saved").hidden = true;
  $("save-error").textContent = current.status === "in_progress" ? "This test isn't finished yet, so it can't be scored." : "";
  refresh();
  $("v-list").hidden = true;
  $("v-score").hidden = false;
  window.scrollTo(0, 0);
}

["strength", "fix", "note"].forEach((id) => $(id).addEventListener("input", refresh));

$("card").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("save").disabled = true;
  $("save-error").textContent = "";
  try {
    current = await api(`/api/coach/attempt/${current.id}/score`, {
      method: "POST",
      json: { levels, weakest, reasons, strength: $("strength").value, fix: $("fix").value, note: $("note").value },
    });
    $("saved").textContent = `Saved: ${current.score.total}/20, weakest ${DIMENSION_LABEL[current.score.weakest]}.`;
    $("saved").hidden = false;
    $("saved").scrollIntoView({ block: "center", behavior: "smooth" });
    $("save").textContent = "Update score";
    aiBanner();
  } catch (err) {
    $("save-error").textContent = err.message;
  }
  refresh();
});

// ---------------- routing ----------------
async function route() {
  const m = location.hash.match(/^#\/attempt\/(\d+)$/);
  try {
    if (m) await showAttempt(Number(m[1]));
    else await showList();
  } catch (err) {
    alert(err.message);
    location.hash = "";
  }
}
window.addEventListener("hashchange", route);
route();
