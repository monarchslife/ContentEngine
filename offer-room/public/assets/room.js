import { api, logout, el, power } from "./common.js";

document.getElementById("logout").addEventListener("click", logout);

const STATUS = {
  in_progress: { pill: "Halfway", cls: "" },
  submitted: { pill: "Being scored", cls: "" },
  scored: { pill: "Scored", cls: "good" },
};

function render(me, t) {
  power(document.getElementById("hello"), "Hey ", `${me.name}.`);
  const title = document.getElementById("test-title");
  const body = document.getElementById("test-body");
  const action = document.getElementById("test-action");
  const go = document.getElementById("test-go");
  document.getElementById("test-eyebrow").textContent = t.openLabel ? `${t.openLabel} · Three-Minute Test` : "Three-Minute Test";

  const cur = t.current;
  document.getElementById("profile-link").hidden = !t.onboarded;
  document.getElementById("score-link").hidden = !t.history.some((h) => h.status === "scored");
  if (!t.onboarded) {
    document.getElementById("test-eyebrow").textContent = "Step 1";
    title.textContent = "First, tell us about you.";
    body.textContent = "Five minutes, then your test unlocks. It's how we make practice about the job you actually want.";
    go.textContent = "Let's do it";
    go.href = "/onboarding";
    action.hidden = false;
  } else if (!t.openTest) {
    title.textContent = "No test open right now.";
    body.textContent = "Chill. We'll tell you the moment the next one opens.";
  } else if (!cur) {
    title.textContent = "Three questions. About three minutes.";
    body.textContent = "The same kind of questions an interviewer throws at you in the first five minutes. Grab your earphones and find a quiet corner first.";
    go.textContent = "Take the test";
    action.hidden = false;
  } else if (cur.status === "in_progress") {
    const left = 3 - cur.partsDone.length;
    title.textContent = `${left} question${left === 1 ? "" : "s"} to go.`;
    body.textContent = "You started already. Pick up right where you left off.";
    go.textContent = "Continue the test";
    action.hidden = false;
  } else if (cur.status === "submitted") {
    title.textContent = "Done and sent.";
    body.textContent = "Yogesh is scoring your three answers. Your score lands right here when it's ready. Go eat something.";
  } else {
    title.textContent = "Your score is in.";
    body.textContent = "No ranks, no comparisons. Just how your answers did and the one thing to work on next.";
    go.textContent = "See my Offer Score";
    go.href = "/score";
    action.hidden = false;
  }

  // The big button already says it; don't repeat it as a link.
  if (!action.hidden && go.getAttribute("href") === "/score") document.getElementById("score-link").hidden = true;

  if (t.history.length) {
    const rows = document.getElementById("history-rows");
    rows.replaceChildren(...t.history.map((h) =>
      el("div", { class: "status-row" },
        el("span", {}, `${h.label} test`),
        el("span", { class: `pill ${STATUS[h.status].cls}` }, STATUS[h.status].pill))));
    document.getElementById("history").hidden = false;
  }
}

const [me, t] = await Promise.all([api("/api/me"), api("/api/student/test")]);
render(me, t);
