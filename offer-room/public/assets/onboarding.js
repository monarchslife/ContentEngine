import { api, el } from "./common.js";
import { DEGREES, ROLE_FAMILIES, YES_NO_DEPENDS, LANGUAGES, MAX_RESUME_BYTES } from "/lib/profile.js";

const $ = (id) => document.getElementById(id);
const form = $("form");
const LAST = 4;
let step = 1;
let state;
let me;
const choices = { relocation: null, nightShifts: null };
const languages = new Set();

// Each step checks only its own fields, in the student's voice.
const CHECKS = {
  1: () => (!$("degree").value ? "Pick your degree first."
    : !$("branch").value.trim() ? "What's your branch? Even 'General' works."
      : !$("gradYear").value ? "When do you graduate?" : null),
  2: () => (!$("roleFamily").value ? "Pick the closest kind of role. You can change it later."
    : !$("roleText").value.trim() ? "Write the role in your own words. One line is plenty."
      : !choices.relocation || !choices.nightShifts ? "Tap Yes, No or Depends for relocation and night shifts." : null),
  3: () => (!$("projects").value.trim() ? "Add at least one project or internship. Small ones count, promise." : null),
  4: () => (!state.resume && !$("noResume").checked ? "Upload your resume, or tick 'No resume yet'." : null),
};

function fillSelect(select, values, chosen) {
  select.replaceChildren(el("option", { value: "" }, "Choose…"), ...values.map((v) => el("option", { value: v }, v)));
  select.value = chosen || "";
}

function choiceButtons(key) {
  const box = document.querySelector(`[data-choice="${key}"]`);
  const paint = () => {
    for (const b of box.children) {
      const on = b.textContent === choices[key];
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    }
  };
  box.setAttribute("role", "radiogroup");
  box.replaceChildren(...YES_NO_DEPENDS.map((v) => el("button", {
    type: "button", role: "radio", onclick: () => { choices[key] = v; paint(); },
  }, v)));
  paint();
}

function languageChips() {
  $("languages").replaceChildren(...LANGUAGES.map((l) => {
    const b = el("button", { type: "button", "aria-pressed": String(languages.has(l)), class: languages.has(l) ? "on" : "" }, l);
    b.addEventListener("click", () => {
      if (languages.has(l)) languages.delete(l); else languages.add(l);
      b.classList.toggle("on", languages.has(l));
      b.setAttribute("aria-pressed", languages.has(l));
    });
    return b;
  }));
}

function collect() {
  return {
    degree: $("degree").value, branch: $("branch").value, college: $("college").value, gradYear: $("gradYear").value,
    languages: [...languages],
    roleFamily: $("roleFamily").value, roleText: $("roleText").value, companies: $("companies").value,
    relocation: choices.relocation, nightShifts: choices.nightShifts,
    projects: $("projects").value, otherProof: $("otherProof").value,
    noResume: $("noResume").checked,
  };
}

function showResume() {
  const s = $("resume-status");
  s.hidden = !state.resume;
  if (state.resume) s.textContent = `✓ ${state.resume.name} (${Math.max(1, Math.round(state.resume.bytes / 1024))} KB)`;
  $("no-resume-note").hidden = !$("noResume").checked;
}

function go(n) {
  step = n;
  document.querySelectorAll("[data-step]").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  [...$("steps").children].forEach((s, i) => { s.className = i + 1 < n ? "done" : i + 1 === n ? "now" : ""; });
  $("head").hidden = n > LAST;
  $("back").hidden = n === 1 || n > LAST;
  $("next").hidden = n > LAST;
  $("next").textContent = n === LAST ? (state.completed ? "Save" : "Finish") : "Next";
  $("to-room").hidden = n <= LAST;
  $("err").textContent = "";
  window.scrollTo(0, 0);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const problem = CHECKS[step]();
  if (problem) { $("err").textContent = problem; return; }
  $("next").disabled = true;
  try {
    state = await api("/api/student/profile", { method: "PUT", json: collect() });
    if (step < LAST) go(step + 1);
    else {
      state = await api("/api/student/profile/complete", { method: "POST", json: {} });
      $("done-title").textContent = `You're in, ${me.name}.`;
      go(LAST + 1);
    }
  } catch (err) {
    $("err").textContent = err.message;
  }
  $("next").disabled = false;
});

$("back").addEventListener("click", () => go(step - 1));
$("noResume").addEventListener("change", () => { $("err").textContent = ""; showResume(); });

$("resume").addEventListener("change", async () => {
  const file = $("resume").files[0];
  $("resume-error").textContent = "";
  if (!file) return;
  if (file.size > MAX_RESUME_BYTES) { $("resume-error").textContent = "That file's over 5 MB. Try exporting it again as a PDF."; return; }
  $("resume-status").hidden = false;
  $("resume-status").textContent = "Uploading…";
  try {
    state = await api("/api/student/profile/resume", {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/pdf", "X-Offer-Room": "1", "X-Filename": encodeURIComponent(file.name) },
    });
    $("noResume").checked = false;
    $("err").textContent = "";
  } catch (err) {
    $("resume-error").textContent = err.status === 415 ? "That doesn't look like a PDF. Export it as PDF and try again." : err.message;
  }
  $("resume").value = "";
  showResume();
});

// ---------------- start ----------------
[me, state] = await Promise.all([api("/api/me"), api("/api/student/profile")]);
const d = state.data;
const thisYear = new Date().getFullYear();
fillSelect($("degree"), DEGREES, d.degree);
fillSelect($("gradYear"), [0, 1, 2, 3, 4].map((i) => String(thisYear - 1 + i)), d.gradYear);
fillSelect($("roleFamily"), ROLE_FAMILIES, d.roleFamily);
for (const k of ["branch", "college", "roleText", "companies", "projects", "otherProof"]) $(k).value = d[k] || "";
(d.languages || []).forEach((l) => languages.add(l));
choices.relocation = d.relocation || null;
choices.nightShifts = d.nightShifts || null;
$("noResume").checked = Boolean(d.noResume);
languageChips();
choiceButtons("relocation");
choiceButtons("nightShifts");
showResume();
go(1);
