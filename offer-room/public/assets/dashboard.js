import { api, logout, el } from "./common.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const LEVEL_NAMES = ["Not yet", "Getting there", "Ready", "Strong"];

$("logout").addEventListener("click", logout);
$("print").addEventListener("click", () => window.print());

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const num = (x) => (x == null ? "–" : String(x));
const signed = (x) => (x == null ? "–" : x > 0 ? `+${x}` : String(x));

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids.filter((k) => k != null));
  return n;
}
const tip = (text) => svg("title", {}, text);

function legend(box, showFinal) {
  box.replaceChildren(
    el("span", {}, el("i", { class: "key d1" }), "Day 1"),
    showFinal ? el("span", {}, el("i", { class: "key d2" }), "Final") : null,
  );
}

// ---------------- KPI tiles ----------------
function kpis(h) {
  const tile = (label, value, sub) => el("div", { class: "kpi" }, el("p", { class: "kpi-label" }, label), el("p", { class: "kpi-value" }, value), el("p", { class: "kpi-sub" }, sub));
  const hasFinal = h.measuredFinal > 0;
  $("kpis").replaceChildren(
    tile("Students measured", `${h.measuredDay1} of ${h.students}`, "scored on the Day 1 test"),
    tile("Average Offer Score", hasFinal ? `${num(h.avgDay1)} → ${num(h.avgFinal)}` : num(h.avgDay1), hasFinal ? "Day 1 → Final, out of 20" : "Day 1, out of 20"),
    tile("At or above Ready", hasFinal ? `${pct(h.readyDay1)} → ${pct(h.readyFinal)}` : pct(h.readyDay1), "Ready line: 15 of 20"),
    tile("Average movement", h.paired ? `${signed(h.avgChange)} pts` : "–", h.paired ? `${h.paired} student${h.paired === 1 ? "" : "s"} with both tests` : "available after the Final test"),
    tile("Needs support", num(h.notYetReady), "below Ready on their latest test"),
  );
}

// ---------------- dimension dumbbell ----------------
function dimsChart(dims, paired) {
  const hasFinal = dims.some((d) => d.final != null);
  $("dims-note").textContent = hasFinal
    ? `Average level per dimension (1 to 4) for the ${paired} student${paired === 1 ? "" : "s"} with both tests.`
    : "Average level per dimension (1 to 4) on Day 1. Movement appears after the Final test.";
  legend($("dims-legend"), hasFinal);
  if (!dims.some((d) => d.day1 != null)) {
    $("dims-chart").replaceChildren(el("p", { class: "muted" }, "No scored tests yet."));
    return;
  }
  const W = Math.max(300, $("dims-chart").clientWidth || 600), rowH = 46, top = 10, left = 92, right = 40;
  const H = top + dims.length * rowH + 34;
  const x = (v) => left + ((v - 1) / 3) * (W - left - right);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Average level per dimension, Day 1 and Final" });
  for (let v = 1; v <= 4; v++) {
    g.append(svg("line", { x1: x(v), x2: x(v), y1: top, y2: H - 30, class: "grid" }));
    g.append(svg("text", { x: x(v), y: H - 10, class: "axis", "text-anchor": "middle" }, W < 480 ? String(v) : `${v} ${LEVEL_NAMES[v - 1]}`));
  }
  dims.forEach((d, i) => {
    const y = top + i * rowH + rowH / 2;
    g.append(svg("text", { x: 0, y: y + 5, class: "label" }, d.label));
    if (d.day1 == null) return;
    if (d.final != null) g.append(svg("line", { x1: x(d.day1), x2: x(d.final), y1: y, y2: y, class: "link" }));
    g.append(svg("circle", { cx: x(d.day1), cy: y, r: 7, class: "dot d1" }, tip(`${d.label}: Day 1 average ${d.day1}`)));
    if (d.final != null) {
      g.append(svg("circle", { cx: x(d.final), cy: y, r: 8, class: "dot d2" }, tip(`${d.label}: Final average ${d.final} (${signed(d.change)})`)));
      g.append(svg("text", { x: Math.max(x(d.final), x(d.day1)) + 14, y: y + 5, class: "value" }, signed(d.change)));
    } else {
      g.append(svg("text", { x: x(d.day1) + 14, y: y + 5, class: "value" }, String(d.day1)));
    }
  });
  $("dims-chart").replaceChildren(g);
}

// ---------------- band bars ----------------
function bandsChart(bands, hasFinal) {
  legend($("bands-legend"), hasFinal);
  const W = Math.max(300, $("bands-chart").clientWidth || 600), H = 250, top = 22, bottom = 34, left = 4;
  const max = Math.max(1, ...bands.flatMap((b) => [b.day1, hasFinal ? b.final : 0]));
  const groupW = (W - left * 2) / bands.length;
  const barW = Math.min(46, groupW / (hasFinal ? 3 : 2));
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Students per score band" });
  g.append(svg("line", { x1: left, x2: W - left, y1: H - bottom, y2: H - bottom, class: "baseline" }));
  bands.forEach((b, i) => {
    const cx = left + groupW * i + groupW / 2;
    const series = hasFinal ? [["d1", b.day1, "Day 1"], ["d2", b.final, "Final"]] : [["d1", b.day1, "Day 1"]];
    series.forEach(([cls, v, name], j) => {
      const bx = cx - (series.length * barW + (series.length - 1) * 2) / 2 + j * (barW + 2);
      const h = Math.max(v ? 4 : 0, H - bottom - y(v));
      // 4px rounded top, square at the baseline.
      const path = `M${bx},${H - bottom} V${H - bottom - h + 4} Q${bx},${H - bottom - h} ${bx + 4},${H - bottom - h} H${bx + barW - 4} Q${bx + barW},${H - bottom - h} ${bx + barW},${H - bottom - h + 4} V${H - bottom} Z`;
      if (v) g.append(svg("path", { d: path, class: `bar ${cls}` }, tip(`${b.label}: ${v} student${v === 1 ? "" : "s"} (${name})`)));
      if (v) g.append(svg("text", { x: bx + barW / 2, y: H - bottom - h - 6, class: "value", "text-anchor": "middle" }, String(v)));
    });
    g.append(svg("text", { x: cx, y: H - 10, class: "axis", "text-anchor": "middle" }, W < 480 ? b.label.replace(" (Ready)", "") : b.label));
  });
  $("bands-chart").replaceChildren(g);
}

// ---------------- tables ----------------
function table(node, head, rows) {
  node.replaceChildren(
    el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { scope: "col", ...(h.key ? { "data-key": h.key } : {}), class: h.num ? "num" : "" }, h.label)))),
    el("tbody", {}, ...rows));
}

const statusPill = (r) => (r.ready == null ? el("span", { class: "muted" }, "–")
  : r.ready ? el("span", { class: "status good" }, "✓ Ready") : el("span", { class: "status warn" }, "● Not yet"));

let view;
let sortKey = "priority";
let sortDir = 1;

function renderRegister() {
  const q = $("q").value.trim().toLowerCase();
  const only = $("only-not-ready").checked;
  const rows = view.register
    .filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.roll || "").toLowerCase().includes(q))
    .filter((r) => !only || r.ready === false)
    .sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null || vb == null) return (va == null) - (vb == null);
      return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * sortDir;
    });
  table($("register"), [
    { label: "#", key: "priority", num: true }, { label: "Student", key: "name" }, { label: "Department", key: "dept" },
    { label: "Day 1", key: "day1", num: true }, { label: "Final", key: "final", num: true }, { label: "Change", key: "change", num: true },
    { label: "Status" }, { label: "Focus area", key: "weakestLabel" }, { label: "Recommended action" }, { label: "Tests" },
  ], rows.length ? rows.map((r) => el("tr", {},
    el("td", { class: "num" }, num(r.priority)),
    el("td", {}, el("b", {}, r.name), el("span", { class: "muted small block nowrap" }, r.roll || "")),
    el("td", {}, r.dept),
    el("td", { class: "num" }, num(r.day1)),
    el("td", { class: "num" }, num(r.final)),
    el("td", { class: "num" }, signed(r.change)),
    el("td", {}, statusPill(r)),
    el("td", {}, r.weakestLabel || "–"),
    el("td", { class: "small" }, r.action || (r.ready ? "Keep practising with mock drives." : "–")),
    el("td", { class: "small muted" }, `Day 1: ${r.day1Status}`, el("br"), `Final: ${r.finalStatus}`),
  )) : [el("tr", {}, el("td", { colspan: "10", class: "muted" }, "No students match."))]);
  for (const th of $("register").querySelectorAll("th[data-key]")) {
    th.setAttribute("aria-sort", th.dataset.key === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none");
    th.addEventListener("click", () => {
      sortDir = th.dataset.key === sortKey ? -sortDir : 1;
      sortKey = th.dataset.key;
      renderRegister();
    });
  }
}

function renderDepts(depts) {
  table($("depts"), [
    { label: "Department" }, { label: "Students", num: true }, { label: "Day 1 avg", num: true },
    { label: "Final avg", num: true }, { label: "Avg change", num: true }, { label: "Ready", num: true },
  ], depts.map((d) => el("tr", {},
    el("td", {}, d.dept), el("td", { class: "num" }, num(d.students)), el("td", { class: "num" }, num(d.day1)),
    el("td", { class: "num" }, num(d.final)), el("td", { class: "num" }, signed(d.change)), el("td", { class: "num" }, pct(d.ready)))));
}

function renderIntegrity(i) {
  $("integrity-summary").textContent = i.testsWithClaude
    ? `Claude scored ${i.testsWithClaude} of ${i.testsScored} scored tests. Coaches reviewed every one and changed ${i.overrides} of ${i.judgements} Claude judgements (${pct(i.overrides / i.judgements)}), each with a logged reason.`
    : `${i.testsScored} test${i.testsScored === 1 ? "" : "s"} scored, all by a coach. Claude-assisted scoring appears here once it is switched on.`;
  $("integrity").hidden = !i.testsWithClaude;
  table($("integrity"), [{ label: "Dimension" }, { label: "Changed by coach", num: true }, { label: "Rate", num: true }, { label: "Avg shift", num: true }],
    i.byDimension.map((d) => el("tr", {}, el("td", {}, d.label), el("td", { class: "num" }, num(d.overrides)), el("td", { class: "num" }, pct(d.rate)), el("td", { class: "num" }, signed(d.meanShift)))));
}

function renderProcess(p) {
  const rows = [
    ["Tests taken", num(p.testsTaken)],
    ["Awaiting score", num(p.awaitingScore)],
    ["Room check passed first time", pct(p.roomFirstTry)],
    ["Room check skipped after 3 tries", num(p.roomSkipped)],
    ["Answers with a transcript", pct(p.transcriptCoverage)],
  ];
  $("process").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
}

// ---------------- start ----------------
const [me, data] = await Promise.all([api("/api/me"), api("/api/management/dashboard")]);
view = data;
$("to-coach").hidden = me.role !== "coach";
const s = view.settings;
$("inst").textContent = s.institution || "Readiness Dashboard";
$("meta").textContent = [s.program, s.batch].filter(Boolean).join(" · ");
kpis(view.headline);
dimsChart(view.dimensions, view.headline.paired);
bandsChart(view.bands, view.headline.measuredFinal > 0);
renderRegister();
renderDepts(view.departments);
renderIntegrity(view.integrity);
renderProcess(view.process);
$("generated").textContent = `Generated ${new Date(view.generatedAt).toLocaleString()}.`;
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    dimsChart(view.dimensions, view.headline.paired);
    bandsChart(view.bands, view.headline.measuredFinal > 0);
  }, 150);
});
$("q").addEventListener("input", renderRegister);
$("only-not-ready").addEventListener("change", renderRegister);
