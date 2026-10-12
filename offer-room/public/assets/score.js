import { api, el } from "./common.js";

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function barText(t) {
  if (t.bar.clears) return "This answer cleared the Ready line. That's interview-shaped. Now keep it there.";
  return `${plural(t.bar.gap, "point")} to the Ready line. The quickest ones are hiding in ${t.weakestLabel}.`;
}

function movedTitle(change) {
  if (change > 0) return `Up ${plural(change, "point")} since Day 1. That's the reps working.`;
  if (change === 0) return "Same total as Day 1, but look at what moved underneath.";
  return `Down ${plural(-change, "point")} from Day 1. New questions do that sometimes. Nothing's broken.`;
}

function render(view, test) {
  const t = view.tests[test];
  $("hero-label").textContent = `Your ${t.label} test`;
  $("total").textContent = t.total;
  // The bar runs from 5 (lowest possible) to 20.
  const pct = (x) => `${((x - 5) / 15) * 100}%`;
  $("bar-fill").style.width = pct(t.total);
  $("bar-line").style.left = pct(t.bar.line);
  $("bar-text").textContent = barText(t);

  $("next-title").textContent = t.weakestLabel;
  $("next-body").textContent = t.nextRep;
  $("strength").textContent = t.strength;
  $("fix").textContent = t.fix;

  $("dims").replaceChildren(...t.dimensions.map((d) =>
    el("li", {},
      el("div", { class: "dim-row" },
        el("b", {}, d.label),
        el("span", { class: "dots", "aria-label": `${d.level} of 4` },
          ...[1, 2, 3, 4].map((n) => el("i", { class: n <= d.level ? "on" : "" }))),
        el("span", { class: "muted small" }, d.levelName)),
      el("p", {}, d.said))));

  const m = view.movement;
  $("moved").hidden = !(m && test === "final");
  if (m && test === "final") {
    $("moved-title").textContent = movedTitle(m.total);
    $("moves").replaceChildren(...m.dimensions.map((d) =>
      el("li", { class: d.change > 0 ? "up" : d.change < 0 ? "down" : "" },
        el("b", {}, d.label),
        el("span", {}, `${d.from} → ${d.to}`),
        el("span", { class: "muted small" }, d.change > 0 ? `up ${d.change}` : d.change < 0 ? "dipped, happens" : "same"))));
  }
}

const view = await api("/api/student/score");
const tests = ["day1", "final"].filter((k) => view.tests[k]);
if (!tests.length) {
  $("empty").hidden = false;
} else {
  $("score").hidden = false;
  let current = tests[tests.length - 1];
  if (tests.length > 1) {
    const tabs = $("tabs");
    const paint = () => {
      for (const b of tabs.children) {
        const on = b.dataset.test === current;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on);
      }
    };
    tabs.replaceChildren(...tests.map((k) => el("button", {
      type: "button", role: "tab", "data-test": k,
      onclick: () => { current = k; paint(); render(view, k); },
    }, view.tests[k].label)));
    tabs.hidden = false;
    paint();
  }
  render(view, current);
}
