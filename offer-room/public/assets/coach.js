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
let weakest = null;
let current = null;

function answerBlock(p) {
  const media = p.clip
    ? el(p.clip.mime.startsWith("audio") ? "audio" : "video", { controls: "", preload: "metadata", playsinline: "", src: `/api/coach/clip/${p.clip.id}` })
    : el("p", { class: "muted" }, "Not recorded.");
  return el("div", { class: "card answer" },
    el("div", { class: "recruiter small-q" },
      el("p", { class: "who" }, el("span", {}, `Part ${p.part}`), el("span", {}, `${p.seconds} seconds`)),
      el("blockquote", {}, p.ask)),
    media,
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

function dimBlock(d) {
  const anchor = el("p", { class: "anchor muted small" }, "Pick 1 to 4.");
  const seg = el("div", { class: "segmented levels", role: "radiogroup", "aria-label": DIMENSION_LABEL[d] },
    ...[1, 2, 3, 4].map((n) => el("button", {
      type: "button", role: "radio", "aria-checked": "false", "data-level": n,
      title: ANCHORS[d][n - 1],
      onclick: () => { levels[d] = n; refresh(); },
    }, el("b", {}, String(n)), el("span", {}, LEVEL_NAMES[n - 1]))));
  return el("div", { class: "dim", "data-dim": d }, el("p", { class: "dim-name" }, DIMENSION_LABEL[d]), seg, anchor);
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
  }
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
  $("save").disabled = !complete || !$("strength").value || !$("fix").value || Boolean(lint);
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
  $("answers").replaceChildren(...current.parts.map(answerBlock));
  $("dims").replaceChildren(...DIMENSIONS.map(dimBlock));
  for (const d of DIMENSIONS) levels[d] = current.score?.levels[d] || null;
  weakest = current.score?.weakest || null;
  options($("strength"), STRENGTH_STEMS, current.score?.strength);
  options($("fix"), FIX_STEMS, current.score?.fix);
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
      json: { levels, weakest, strength: $("strength").value, fix: $("fix").value, note: $("note").value },
    });
    $("saved").textContent = `Saved: ${current.score.total}/20, weakest ${DIMENSION_LABEL[current.score.weakest]}.`;
    $("saved").hidden = false;
    $("saved").scrollIntoView({ block: "center", behavior: "smooth" });
    $("save").textContent = "Update score";
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
