// Renders the project page from data/*.json (built by tools/export_training.py and tools/build_manifest.py).

const REAL_TASKS = [
  { key: "stack_t", name: "Stack T", cat: "object property",
    goal: "Push the blocks on the table so that together they form a T shape inside the marked target outline.",
    ext: "The blocks differ in size, friction and shape." },
  { key: "hanging_mug", name: "Hanging mug", cat: "dynamic",
    goal: "Hang the mug by its handle on the mug rack.", ext: "The mug rack rotates during the task." },
  { key: "plug_charger", name: "Plug charger", cat: "pose",
    goal: "Plug the charger fully into the socket.",
    ext: "Charger and socket at random orientations; the charger lies on an inclined, non-planar surface." },
  { key: "drawer_to_shelf", name: "Drawer to shelf", cat: "collision",
    goal: "Open the drawer, take out the book inside it, and insert the book upright into the gap on the bookshelf.",
    ext: "Obstacles around the drawer and the shelf." },
  { key: "sort_marbles", name: "Sort marbles", cat: "perception",
    goal: "Put every marble into the cup that has the same color as the marble.", ext: "Dimmed or tinted lighting." },
];
const ARMS = [{ key: "baseline", name: "No prompt" }, { key: "rah", name: "A²H" }, { key: "rsi", name: "RSI" }];

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const pretty = s => String(s).replace(/-v1$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
const getJSON = p => fetch(p, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);

function select(label, options, onchange) {
  const s = h("select", { onchange: e => onchange(e.target.value) }, options.map(([v, t]) => h("option", { value: v }, t)));
  return [h("label", {}, label), s];
}

// ---------------------------------------------------------------- headline numbers
function renderStats(train) {
  const rounds = train.tasks.flatMap(t => t.rounds);
  const items = [
    [25, "training tasks in 5 simulators"],
    [train.tasks.reduce((a, t) => a + t.designed, 0), "variations designed"],
    [rounds.length, "passed the gates"],
    [rounds.filter(r => r.s_break === 0).length, "drove the program to 0% success"],
    [rounds.filter(r => r.status === "recovered").length, "repaired to ≥ 80%"],
    [15, "rules in the final harness"],
  ];
  $("#stats").replaceChildren(...items.map(([n, t]) => h("div", { class: "stat" }, h("b", {}, String(n)), h("span", {}, t))));
}

// ---------------------------------------------------------------- real robot
function renderTaskCards() {
  $("#taskcards").replaceChildren(...REAL_TASKS.map(t =>
    h("div", { class: "taskcard" }, h("h4", {}, t.name), h("span", { class: "cat" }, t.cat),
      h("p", {}, h("b", {}, "Goal: "), t.goal), h("p", {}, h("b", {}, "Constraint: "), t.ext))));
}

function renderRealTable(real) {
  const cells = {};
  for (const [k, v] of Object.entries(real?.cells || {})) {
    const [arm, task, setting] = k.split("|").map(norm);
    cells[`${arm}|${task}|${setting}`] = v;
  }
  const arms = ARMS.filter(a => Object.keys(cells).some(k => k.startsWith(a.key + "|")) || a.key !== "rsi");
  const head = h("tr", {}, h("th", {}, "Task"), arms.flatMap(a => [h("th", {}, `${a.name} pass@1`), h("th", {}, `${a.name} pass@4`)]));
  const cell = (c, f) => (c && c.trials ? `${c[f]}/${c.trials}` : "–");
  const tot = (arm, setting, f) => REAL_TASKS.reduce((a, t) => a + ((cells[`${arm}|${t.key}|${setting}`] || {})[f] || 0), 0);
  const rows = REAL_TASKS.map(t => h("tr", {}, h("td", {}, t.name),
    arms.flatMap(a => ["pass1", "pass4"].map(f => h("td", {}, cell(cells[`${a.key}|${t.key}|extended`], f))))));
  const all = h("tr", {}, h("td", {}, h("b", {}, "All")), arms.flatMap(a => ["pass1", "pass4"].map(f => {
    const n = tot(a.key, "extended", "trials");
    return h("td", {}, h("b", {}, n ? pct(tot(a.key, "extended", f), n) : "–"));
  })));
  const n = real?.n_attempts || 0;
  $("#realtable").replaceChildren(
    h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, head), h("tbody", {}, rows, all))),
    h("p", { class: "count" }, n ? `Successful trials at the first attempt (pass@1) and within four (pass@4); All row in %. From ${n} logged attempts.` : "No trials synced yet. Run tools/sync_real.sh."));
}

function renderVideos(videos) {
  const real = (videos?.real || []).map(v => ({ ...v, armN: norm(v.arm), taskN: norm(v.task), settingN: norm(v.setting) }));
  const state = { task: "", arm: "", setting: "", camera: "", outcome: "" };
  const cams = [...new Set(real.map(v => v.camera))].sort();
  const f = $("#vidfilters");
  f.replaceChildren(
    ...select("Task", [["", "all"], ...REAL_TASKS.map(t => [t.key, t.name])], v => { state.task = v; draw(); }),
    ...select("Arm", [["", "all"], ...ARMS.map(a => [a.key, a.name])], v => { state.arm = v; draw(); }),
    ...select("Camera", [["", "all"], ...cams.map(c => [c, c])], v => { state.camera = v; draw(); }),
    ...select("Outcome", [["", "all"], ["ok", "success"], ["bad", "failure"]], v => { state.outcome = v; draw(); }));
  function draw() {
    const list = real.filter(v => (!state.task || v.taskN === state.task) && (!state.arm || v.armN === state.arm)
      && (!state.setting || v.settingN === state.setting) && (!state.camera || v.camera === state.camera)
      && (!state.outcome || (state.outcome === "ok") === !!v.success))
      .sort((a, b) => a.taskN.localeCompare(b.taskN) || a.settingN.localeCompare(b.settingN) || a.trial - b.trial
        || a.armN.localeCompare(b.armN) || a.attempt - b.attempt || a.camera.localeCompare(b.camera));
    const grid = $("#videogrid");
    if (!list.length) { grid.replaceChildren(h("div", { class: "empty" }, real.length ? "No video matches these filters." : "No robot videos synced yet.")); return; }
    grid.replaceChildren(...list.slice(0, 120).map(v => {
      const task = REAL_TASKS.find(t => t.key === v.taskN)?.name || pretty(v.task);
      const arm = ARMS.find(a => a.key === v.armN)?.name || v.arm;
      return h("div", { class: "vcard" },
        h("video", { src: v.src, controls: "", muted: "", preload: "metadata", playsinline: "" }),
        h("div", { class: "meta" }, h("b", {}, task),           h("span", { class: "pill" + (v.armN === "rah" ? " rah" : "") }, arm),
          h("span", { class: "pill" }, `trial ${v.trial} · attempt ${v.attempt}`), h("span", { class: "pill" }, v.camera),
          v.success == null ? null : h("span", { class: "pill " + (v.success ? "ok" : "bad") }, v.success ? "success" : (v.failure_type || "failure"))));
    }), list.length > 120 ? h("div", { class: "empty" }, `Showing 120 of ${list.length}; narrow the filters.`) : null);
  }
  draw();
}

// ---------------------------------------------------------------- before/after clip gallery
// Pairs each gated variation's two clips with its round record, so every badge comes from the data
// rather than from the filename: "unsolved" from round.status, "same program" from identical pipeline
// blobs where the recorder wrote them, "seed searched" from an index entry's own selected_by_search.
function renderClips(train, videos) {
  const grid = $("#clipgrid"), count = $("#clipcount"), filters = $("#clipfilters");
  if (!grid) return;
  const rounds = {};
  for (const t of train?.tasks || []) for (const r of t.rounds) rounds[`${t.bench}|${t.task}|${r.variation}`] = { ...r, taskRef: t };
  const pairs = {};
  for (const v of videos?.sim || []) {
    const key = `${v.bench}|${v.task}|${v.variation}`;
    (pairs[key] ||= { key, bench: v.bench, task: v.task, variation: v.variation, round: rounds[key] })[v.kind] = v;
  }
  const all = Object.values(pairs);
  if (!all.length) {
    grid.replaceChildren(h("div", { class: "empty" }, "No simulator clips indexed yet. Record them with tools/record_eval.py, then run tools/build_manifest.py."));
    return;
  }
  const benchName = b => train?.tasks.find(t => t.bench === b)?.bench_name || pretty(b);
  const taskOf = (b, t) => train?.tasks.find(x => x.bench === b && x.task === t);

  // bench -> tasks -> pairs. Two tab rows: pick the simulator, then the task inside it.
  const benches = [];
  for (const p of all) {
    let b = benches.find(x => x.bench === p.bench);
    if (!b) benches.push(b = { bench: p.bench, tasks: [] });
    let t = b.tasks.find(x => x.task === p.task);
    if (!t) b.tasks.push(t = { task: p.task, pairs: [], meta: taskOf(p.bench, p.task) });
    t.pairs.push(p);
  }
  benches.sort((a, b) => benchName(a.bench).localeCompare(benchName(b.bench)));
  for (const b of benches) b.tasks.sort((x, y) => x.task.localeCompare(y.task));

  // Open on a real task: the progression is the point, the all-clips grid is for scanning.
  const st = { bench: "__top", task: "", status: "", pairsOnly: false };
  try {
    const saved = JSON.parse(localStorage.getItem("aah.clips.sel") || "null");
    if (saved && (saved.bench === "__top" || benches.some(b => b.bench === saved.bench))) { st.bench = saved.bench; st.task = saved.task || ""; }
  } catch {}
  const save = () => { try { localStorage.setItem("aah.clips.sel", JSON.stringify({ bench: st.bench, task: st.task })); } catch {} };
  const curBench = () => benches.find(b => b.bench === st.bench) || benches[0];
  const curTask = () => curBench().tasks.find(t => t.task === st.task);

  const benchRow = $("#benchtabs"), taskRow = $("#cliptabs");

  function drawBenchTabs() {
    const top = h("button", { class: "tab tab-all" + (st.bench === "__top" ? " on" : ""), role: "tab", type: "button",
      "aria-selected": st.bench === "__top" ? "true" : "false", tabindex: st.bench === "__top" ? 0 : -1,
      onclick: () => { st.bench = "__top"; st.task = ""; save(); drawAll(); } },
      h("span", { class: "tname" }, "Highlights"),
      h("span", { class: "tbench" }, `${benches.length} simulators`));
    benchRow.replaceChildren(top, ...benches.map(b => {
      const n = b.tasks.reduce((a, t) => a + t.pairs.length, 0);
      const on = b.bench === st.bench;
      return h("button", { class: "tab" + (on ? " on" : ""), role: "tab", type: "button",
        "aria-selected": on ? "true" : "false", tabindex: on ? 0 : -1,
        onclick: () => { st.bench = b.bench; st.task = b.tasks[0].task; save(); drawAll(); } },
        h("span", { class: "tname" }, benchName(b.bench)),
        h("span", { class: "tbench" }, `${b.tasks.length} task${b.tasks.length === 1 ? "" : "s"}`),
        h("span", { class: "tcount" }, String(n)));
    }));
  }

  function drawTaskTabs() {
    taskRow.hidden = st.bench === "__top";
    if (taskRow.hidden) { taskRow.replaceChildren(); return; }
    const b = curBench();
    const mk = (key, name, sub, n, dot) => {
      const on = key === st.task;
      return h("button", { class: "tab" + (on ? " on" : "") + (key === "__all" ? " tab-all" : ""), role: "tab",
        type: "button", "aria-selected": on ? "true" : "false", tabindex: on ? 0 : -1,
        onclick: () => { st.task = key; save(); drawAll(); } },
        h("span", { class: "tname" }, name), sub ? h("span", { class: "tbench" }, sub) : null,
        h("span", { class: "tcount" }, String(n)), dot ? h("span", { class: "tdot", title: `${dot} unsolved` }) : null);
    };
    taskRow.replaceChildren(
      mk("__all", "All clips", `${b.tasks.length} tasks`, b.tasks.reduce((a, t) => a + t.pairs.length, 0), 0),
      ...b.tasks.map(t => mk(t.task, pretty(t.task), null, t.pairs.length,
        t.pairs.filter(p => p.round?.status === "unsolved").length)));
  }

  // The representative clip for a set: a complete pair that broke hard and came back, so one view shows
  // the whole point. Deterministic, so the page does not change its mind between builds.
  function best(pairs) {
    const ok = pairs.filter(p => p.before && p.after && p.round && p.round.status === "recovered"
      && p.before.success === false && p.after.success === true);
    const pool = ok.length ? ok : pairs.filter(p => p.before && p.after && p.round);
    if (!pool.length) return pairs.find(p => p.after) || pairs[0];
    const score = p => ((p.round.s0 ?? 0) - (p.round.s_break ?? 0)) + (p.round.s_recovered ?? 0);
    return pool.slice().sort((a, b) => score(b) - score(a)
      || String(a.variation).localeCompare(String(b.variation)))[0];
  }

  function clip(v, label, sub) {
    const vid = h("video", { src: v.src, controls: "", muted: "", loop: "", preload: "metadata", playsinline: "" });
    const fig = h("figure", { class: "clip" },
      h("div", { class: "frame" }, vid),
      h("figcaption", {}, h("b", {}, label), h("span", { class: "sub" }, sub),
        v.success == null ? null : h("span", { class: "pill " + (v.success ? "ok" : "bad") }, v.success ? "succeeded" : "failed")));
    vid.addEventListener("error", () => fig.classList.add("missing"), { once: true });
    return fig;
  }

  // Highlights: the same final program on the base task and on every constraint it had to absorb.
  // A single before/after pair shows one repair; this shows the escalation, which is the actual claim.
  // Only accepted variations appear, because only those became constraints the program must keep solving.
  // Highlights: the run laid out as a 2x3 grid — base task plus the constraints it absorbed, all visible
  // at once and large enough to watch, rather than stepped through one at a time.
  function ladderCard(bench, t, onOpen) {
    const meta = t.meta || {};
    const rs = [...(meta.rounds || [])].sort((a, b) => (a.round || 0) - (b.round || 0));
    const kept = rs.filter(r => r.status === "recovered");
    const byVar = {};
    for (const p of t.pairs) byVar[p.variation] = p;

    const cells = [];
    if (byVar["base"]?.after) cells.push({ clip: byVar["base"].after, title: "Base task", sub: "no variation", base: true });
    for (const r of kept) {
      const pr = byVar[r.variation];
      if (!pr?.after) continue;
      cells.push({ clip: pr.after, round: r,
        title: `+ ${(r.axis || r.variation).replace(/_/g, " ")}`,
        sub: `${r.variation} · broke the earlier program to ${fmtS(r.s_break)}` });
    }
    if (!cells.length) return h("article", { class: "feature" }, h("h3", {}, benchName(bench)),
      h("p", { class: "fsub" }, "No clips for this run yet."));
    const shown = cells.slice(0, 6);          // 2 x 3
    const extra = cells.length - shown.length;

    const tile = (c, i) => {
      const vid = h("video", { src: c.clip.src, controls: "", muted: "", loop: "", preload: "metadata", playsinline: "" });
      const fig = h("figure", { class: "cell" + (c.base ? " cell-base" : "") },
        h("div", { class: "frame" }, vid),
        h("figcaption", {},
          h("span", { class: "cstep" }, c.base ? "base" : String(i)),
          h("b", {}, c.title),
          h("span", { class: "sub" }, c.sub)));
      vid.addEventListener("error", () => fig.classList.add("missing"), { once: true });
      return fig;
    };

    return h("article", { class: "feature" },
      h("div", { class: "fhead" },
        h("div", {}, h("h3", {}, benchName(bench)),
          h("p", { class: "fsub" }, `${pretty(t.task)} · ${kept.length} constraint${kept.length === 1 ? "" : "s"} added, each one kept`)),
        onOpen ? h("button", { class: "btn btn-sm", type: "button", onclick: onOpen }, "Open this run") : null),
      h("div", { class: "grid23" }, ...shown.map((c, i) => tile(c, i))),
      h("p", { class: "laddernote" },
        "Every clip is the same final program. Each tile after the base adds a scene change that broke the "
        + "program as it stood, and the repaired program still has to solve the base task and every earlier "
        + "constraint — so the last tile is the hardest the run ever got."
        + (extra > 0 ? ` ${extra} further constraint${extra === 1 ? "" : "s"} in this run; open it to see them all.` : "")));
  }

  function featureCard(p, heading, sub, onOpen) {
    const r = p.round || {};
    return h("article", { class: "feature" },
      h("div", { class: "fhead" },
        h("div", {}, h("h3", {}, heading), sub ? h("p", { class: "fsub" }, sub) : null),
        onOpen ? h("button", { class: "btn btn-sm", type: "button", onclick: onOpen }, "Open this run") : null),
      h("div", { class: "pair" },
        p.before ? clip(p.before, "Before", "program frozen at the gate") : h("div", { class: "empty" }, "no before clip"),
        p.after ? clip(p.after, "After repair", "final program") : h("div", { class: "empty" }, "no after clip")),
      h("p", { class: "cscores" },
        h("span", {}, p.variation === "base" ? "base task" : `${p.variation} · ${(r.axis || "").replace(/_/g, " ")}`),
        r.s0 != null ? h("span", {}, "s₀ ", h("b", {}, fmtS(r.s0))) : null,
        r.s_break != null ? h("span", {}, "broken to ", h("b", {}, fmtS(r.s_break))) : null,
        r.s_recovered != null ? h("span", {}, "repaired to ", h("b", {}, fmtS(r.s_recovered))) : null),
      r.general_rule ? h("p", { class: "crule" }, r.general_rule) : null);
  }

  // compact card, used by the "All clips" grid
  function card(p) {
    const r = p.round, base = p.variation === "base";
    const unsolved = r && r.status === "unsolved";
    const same = p.before && p.after && p.before.pipeline && p.before.pipeline === p.after.pipeline;
    return h("article", { class: "ccard" + (unsolved ? " is-unsolved" : "") },
      h("div", { class: "chead" },
        h("div", { class: "ctitle" }, h("b", {}, base ? "Base task" : p.variation),
          h("span", { class: "cmeta" }, `${benchName(p.bench)} · ${pretty(p.task)}`)),
        h("div", { class: "cbadges" },
          r?.axis ? h("span", { class: "pill axis" }, r.axis.replace(/_/g, " ")) : null,
          unsolved ? h("span", { class: "pill bad" }, "unsolved") : r ? h("span", { class: "pill ok" }, "repaired") : null,
          same ? h("span", { class: "pill" }, "same program") : null)),
      r ? h("p", { class: "cscores" }, h("span", {}, "s₀ ", h("b", {}, fmtS(r.s0))),
        h("span", {}, "broken to ", h("b", {}, fmtS(r.s_break))),
        h("span", {}, unsolved ? "best " : "repaired to ", h("b", {}, fmtS(r.s_recovered)))) : null,
      base ? h("div", { class: "pair one" }, p.after ? clip(p.after, "Final program", "base task") : null)
           : h("div", { class: "pair" },
              p.before ? clip(p.before, "Before", "frozen at the gate") : h("div", { class: "empty" }, "no before clip"),
              p.after ? clip(p.after, unsolved ? "After repair (unsolved)" : "After repair", same ? "identical code" : "final program") : h("div", { class: "empty" }, "no after clip")));
  }

  // ---- the progression: one task, round by round, in order ----------------
  function track(r) {
    // s0 -> s_break -> s_recovered as a small line, so the drop and the recovery are visible at a glance
    const pts = [["s₀", r.s0], ["broken", r.s_break], [r.status === "unsolved" ? "best" : "repaired", r.s_recovered]];
    const W = 168, H = 44, pad = 6;
    const x = i => pad + i * ((W - 2 * pad) / (pts.length - 1));
    const y = v => H - pad - (v ?? 0) * (H - 2 * pad);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[1])}`).join(" ");
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="success ${pts.map(p => `${p[0]} ${fmtS(p[1])}`).join(", ")}">
      <line x1="${pad}" y1="${y(0.8)}" x2="${W - pad}" y2="${y(0.8)}" class="tau"/>
      <path d="${d}" class="line"/>
      ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[1])}" r="3.5" class="dot d${i}"/>`).join("")}
    </svg>`;
    return h("div", { class: "trackwrap" }, h("div", { class: "track", html: svg }),
      h("div", { class: "tracklabels" }, ...pts.map(p => h("span", {}, p[0], h("b", {}, fmtS(p[1]))))));
  }

  function edits(r) {
    if (!r.edits) return null;
    const names = Object.keys(r.edits).map(k => k.replace(/_/g, " "));
    return h("p", { class: "whatchanged" }, h("b", {}, "Scene change: "), names.join(", "));
  }

  function progression(t) {
    const meta = t.meta || {};
    const rs = [...(meta.rounds || [])].sort((a, b) => (a.round || 0) - (b.round || 0));
    const rejected = meta.rejected || [];
    const basePair = t.pairs.find(p => p.variation === "base");
    const nodes = [];
    nodes.push(h("li", { class: "step step-stages" }, h("div", { class: "marker" }, "▸"),
      h("div", { class: "stepbody" },
        h("h4", {}, "Every round runs the same five stages"),
        h("ol", { class: "stagestrip" },
          h("li", {}, h("b", {}, "Design"), "question an assumption, edit the scene"),
          h("li", {}, h("b", {}, "Gate"), "the frozen program must lose half its success"),
          h("li", {}, h("b", {}, "Recover"), "repair until τ = 0.8 again, on this and every earlier constraint"),
          h("li", {}, h("b", {}, "Reflect"), "write the rule that would have prevented it"),
          h("li", {}, h("b", {}, "Repeat"), "the next round starts from the repaired program")))));
    nodes.push(h("li", { class: "step step-base" },
      h("div", { class: "marker" }, "0"),
      h("div", { class: "stepbody" },
        h("h4", {}, "Solve the base task"),
        h("p", { class: "steplede" }, meta.goal || ""),
        rs.length ? h("p", { class: "cscores" }, h("span", {}, "reaches ", h("b", {}, fmtS(rs[0].s0)), " on 10 seeds before any variation")) : null,
        basePair?.after ? h("div", { class: "pair one" }, clip(basePair.after, "Base task", "final program")) : null)));
    let held = 0;
    rs.forEach((r, i) => {
      const p = pairs[`${t.pairs[0].bench}|${t.task}|${r.variation}`];
      const unsolved = r.status === "unsolved";
      if (!unsolved) held++;
      const same = p?.before && p?.after && p.before.pipeline && p.before.pipeline === p.after.pipeline;
      nodes.push(h("li", { class: "step" + (unsolved ? " is-unsolved" : "") },
        h("div", { class: "marker" }, String(r.round ?? i + 1)),
        h("div", { class: "stepbody" },
          h("div", { class: "chead" },
            h("div", { class: "ctitle" }, h("b", {}, `Round ${r.round ?? i + 1}: ${r.variation}`),
              r.axis ? h("span", { class: "pill axis" }, r.axis.replace(/_/g, " ")) : null),
            h("div", { class: "cbadges" },
              h("span", { class: "pill " + (unsolved ? "bad" : "ok") }, unsolved ? "unsolved" : "repaired"),
              r.parameter_tuning ? h("span", { class: "pill" }, "parameter tuning") : null,
              r.novel === false ? h("span", { class: "pill" }, "rule not novel") : null)),
          edits(r),
          h("div", { class: "steprow" }, track(r),
            h("div", { class: "stepfacts" },
              h("p", {}, h("b", {}, "Weakness. "), r.weakness || "—"),
              r.repair_iterations != null ? h("p", { class: "muted" }, `${r.repair_iterations} repair iteration${r.repair_iterations === 1 ? "" : "s"}`) : null,
              h("p", { class: "muted" }, unsolved
                ? "Not recovered to τ = 0.8, so it does not become a constraint; the program was reverted."
                : `Now constraint ${held} of ${rs.filter(x => x.status !== "unsolved").length}: every later round must keep this one solved too.`))),
          p ? h("div", { class: "pair" },
            p.before ? clip(p.before, "Before", "frozen at the gate") : h("div", { class: "empty" }, "no before clip"),
            p.after ? clip(p.after, unsolved ? "After repair (unsolved)" : "After repair", same ? "identical code" : "final program") : h("div", { class: "empty" }, "no after clip")) : null,
          r.general_rule ? h("p", { class: "crule" }, h("b", {}, "Rule learned: "), r.general_rule) : null)));
    });
    if (rejected.length) nodes.push(h("li", { class: "step step-rej" },
      h("div", { class: "marker" }, "✕"),
      h("div", { class: "stepbody" },
        h("h4", {}, `${rejected.length} design${rejected.length === 1 ? "" : "s"} the gates threw out`),
        h("p", { class: "steplede" }, "Rejected before they could count, so the agent went back and designed another."),
        h("div", { class: "rejchips" }, ...rejected.map(x => h("span", { class: "rejchip" }, h("b", {}, x.variation), x.reason))))));
    return h("ol", { class: "prog" }, ...nodes);
  }

  filters.replaceChildren(
    ...select("Result", [["", "all"], ["recovered", "repaired"], ["unsolved", "unsolved"]], v => { st.status = v; drawPanel(); }),
    h("label", { class: "check" }, h("input", { type: "checkbox", id: "pairsonly", onchange: e => { st.pairsOnly = e.target.checked; drawPanel(); } }), "complete pairs only"));

  function drawPanel() {
    if (st.bench === "__top") {
      filters.hidden = true;
      const tasks = new Set(all.map(p => `${p.bench}|${p.task}`)).size;
      const nclips = all.reduce((n, p) => n + (p.before ? 1 : 0) + (p.after ? 1 : 0), 0);
      count.replaceChildren(h("b", {}, "One run per simulator"),
        h("span", {}, ` · the same program, on the base task and on every constraint that run had to absorb. ${all.length} variations and ${nclips} clips across ${tasks} tasks in all.`));
      grid.className = "features";
      grid.replaceChildren(...benches.map(b => {
        // the run that absorbed the most constraints, since that is the one that got hardest
        const scored = b.tasks.map(t => ({ t, n: (t.meta?.rounds || []).filter(r => r.status === "recovered").length }));
        scored.sort((x, y) => y.n - x.n || x.t.task.localeCompare(y.t.task));
        const t = scored[0].t;
        return ladderCard(b.bench, t, () => { st.bench = b.bench; st.task = t.task; save(); drawAll(); });
      }));
      return;
    }
    const b = curBench();
    if (st.task === "__all") {
      filters.hidden = false;
      const sel = b.tasks.flatMap(t => t.pairs).filter(p => (!st.status || p.round?.status === st.status)
        && (!st.pairsOnly || (p.before && p.after) || p.variation === "base"));
      const tot = b.tasks.reduce((a, t) => a + t.pairs.length, 0);
      count.replaceChildren(h("b", {}, `${sel.length === tot ? tot : `${sel.length} of ${tot}`} variations`),
        h("span", {}, ` · every task in ${benchName(b.bench)}`));
      grid.className = "clipgrid";
      grid.replaceChildren(...(sel.length ? sel.map(card) : [h("div", { class: "empty" }, "Nothing matches these filters.")]));
      return;
    }
    const t = curTask();
    const meta = t.meta || {};
    const rs = meta.rounds || [];
    const rec = rs.filter(r => r.status === "recovered").length;
    const uns = rs.filter(r => r.status === "unsolved").length;
    filters.hidden = true;
    count.replaceChildren(
      h("b", {}, `${meta.designed ?? rs.length} variations designed`),
      h("span", {}, ` · ${rs.length} passed the gates · ${rec} repaired · ${uns} unsolved`),
      meta.goal ? h("span", { class: "goal" }, meta.goal) : null);
    grid.className = "taskview";
    const pick = best(t.pairs);
    const detail = h("details", { class: "allclips" },
      h("summary", {}, `The whole run: ${t.pairs.length} clips across ${rs.length} rounds, in order`),
      h("div", { class: "progwrap" }, progression(t)));
    grid.replaceChildren(
      featureCard(pick, pretty(t.task), pick.variation === "base" ? "base task" :
        `round ${pick.round?.round ?? "?"} of ${rs.length} · the clearest break and repair in this run`),
      detail);
  }

  function drawAll() { drawBenchTabs(); drawTaskTabs(); drawPanel(); }
  drawAll();
}

const fmtS = v => (v == null ? "–" : Math.round(v * 100) + "%");

// ---------------------------------------------------------------- training explorer
function hbars(el, title, rows, legend) {
  const max = Math.max(...rows.map(r => r.total), 1);
  el.replaceChildren(h("h4", {}, title), ...rows.map(r => h("div", { class: "hrow" }, h("span", {}, r.label),
    h("div", { class: "htrack" }, ...r.parts.map(p => h("div", { class: "hfill" + (p.ok ? " ok" : ""), style: `width:${(100 * p.n) / max}%` }))),
    h("span", { class: "n" }, String(r.total)))), legend || "");
}

function editText(edits) {
  if (!edits) return null;
  return Object.entries(edits).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
}

function renderTraining(train, videos) {
  const rounds = train.tasks.flatMap(t => t.rounds.map(r => ({ ...r, task: t })));
  const simVid = {};
  for (const v of videos?.sim || []) ((simVid[`${v.bench}|${v.task}|${v.variation}`] ||= {})[v.kind] = v);

  const byAxis = {};
  for (const r of rounds) { const a = (r.axis || "other").split(" ")[0]; (byAxis[a] ||= { rec: 0, uns: 0 }); byAxis[a][r.status === "recovered" ? "rec" : "uns"]++; }
  const legend = h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--ok)" }), "recovered"), h("span", {}, h("i", { style: "background:var(--accent)" }), "unsolved"));
  hbars($("#axischart"), "Gated variations by axis", Object.entries(byAxis).sort((a, b) => (b[1].rec + b[1].uns) - (a[1].rec + a[1].uns))
    .map(([k, v]) => ({ label: k.replace(/_/g, " "), total: v.rec + v.uns, parts: [{ n: v.rec, ok: true }, { n: v.uns }] })), legend);
  hbars($("#benchchart"), "Designed variations per simulator", [...new Set(train.tasks.map(t => t.bench_name))].map(b => {
    const ts = train.tasks.filter(t => t.bench_name === b);
    const rec = ts.reduce((a, t) => a + t.rounds.filter(r => r.status === "recovered").length, 0);
    const gated = ts.reduce((a, t) => a + t.rounds.length, 0);
    const designed = ts.reduce((a, t) => a + t.designed, 0);
    return { label: b, total: designed, parts: [{ n: rec, ok: true }, { n: gated - rec }] };
  }), h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--ok)" }), "recovered"),
    h("span", {}, h("i", { style: "background:var(--accent)" }), "unsolved"), h("span", {}, h("i", { style: "background:var(--code);border:1px solid var(--line)" }), "rejected at gates")));

  const state = { bench: "", task: "", axis: "", status: "", q: "" };
  const benches = [...new Set(train.tasks.map(t => t.bench))];
  const axes = Object.keys(byAxis).sort();
  const taskSel = h("select", { onchange: e => { state.task = e.target.value; draw(); } });
  const fillTasks = () => taskSel.replaceChildren(h("option", { value: "" }, "all"),
    ...train.tasks.filter(t => !state.bench || t.bench === state.bench).map(t => h("option", { value: t.task }, pretty(t.task))));
  fillTasks();
  $("#trainfilters").replaceChildren(
    ...select("Simulator", [["", "all"], ...benches.map(b => [b, train.tasks.find(t => t.bench === b).bench_name])], v => { state.bench = v; state.task = ""; fillTasks(); draw(); }),
    h("label", {}, "Task"), taskSel,
    ...select("Axis", [["", "all"], ...axes.map(a => [a, a.replace(/_/g, " ")])], v => { state.axis = v; draw(); }),
    ...select("Result", [["", "all"], ["recovered", "recovered"], ["unsolved", "unsolved"]], v => { state.status = v; draw(); }),
    h("input", { type: "search", placeholder: "search reflections…", oninput: e => { state.q = e.target.value.toLowerCase(); draw(); } }));

  const tpl = $("#tpl-round");
  function card(r) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    $(".badge", el).textContent = r.status; $(".badge", el).classList.add(r.status);
    $(".axis", el).textContent = r.axis || "";
    $(".title", el).textContent = `${r.task.bench_name} · ${pretty(r.task.task)} · ${r.variation}: ${r.general_rule || r.weakness || ""}`;
    const bar = (v, c) => h("i", { class: c, title: v == null ? "n/a" : String(v), style: `height:${Math.max(2, 22 * (v ?? 0))}px` });
    if (simVid[`${r.task.bench}|${r.task.task}|${r.variation}`]) $(".axis", el).textContent += " ▶";
    $(".bars", el).replaceChildren(bar(r.s0, "b0"), bar(r.s_break, "bb"), bar(r.s_recovered, "br"));
    el.addEventListener("toggle", () => {
      if (!el.open || el.dataset.filled) return;
      el.dataset.filled = 1;
      const f = (k, v) => (v ? [h("dt", {}, k), h("dd", {}, v)] : []);
      const vid = simVid[`${r.task.bench}|${r.task.task}|${r.variation}`];
      $(".body", el).replaceChildren(
        h("p", { class: "count" }, `Goal: ${r.task.goal || pretty(r.task.task)} · s₀ ${r.s0 ?? "–"} → s_break ${r.s_break ?? "–"} → recovered ${r.s_recovered ?? "–"}`
          + (r.repair_iterations != null ? ` · ${r.repair_iterations} repair iterations` : "") + (r.parameter_tuning ? " · parameter tuning" : "")),
        r.edits ? h("pre", {}, editText(r.edits)) : null,
        vid ? h("div", { class: "pair" }, ["before", "after"].filter(k => vid[k]).map(k => h("figure", {},
          h("video", { src: vid[k].src, controls: "", muted: "", loop: "", preload: "metadata", playsinline: "" }),
          h("figcaption", {}, k === "before" ? "Program before this round (frozen at the gate)" : "Final repaired program",
            vid[k].success == null ? "" : h("span", { class: "pill " + (vid[k].success ? "ok" : "bad") }, vid[k].success ? "success" : "failure"))))) : null,
        h("dl", {}, ...f("Weakness", r.weakness), ...f("How it was found", r.how_found), ...f("Why it was missed", r.why_missed), ...f("Fix", r.fix)),
        r.general_rule ? h("div", { class: "rule" }, h("b", {}, "General rule: "), r.general_rule, r.novel === false ? " (not novel)" : "") : null);
    });
    return el;
  }
  function draw() {
    const list = rounds.filter(r => (!state.bench || r.task.bench === state.bench) && (!state.task || r.task.task === state.task)
      && (!state.axis || (r.axis || "").startsWith(state.axis)) && (!state.status || r.status === state.status)
      && (!state.q || [r.weakness, r.how_found, r.why_missed, r.fix, r.general_rule].join(" ").toLowerCase().includes(state.q)));
    $("#traincount").textContent = `${list.length} of ${rounds.length} gated variations · bars: s₀, s_break, recovered`;
    $("#rounds").replaceChildren(...list.map(card));
  }
  draw();
}

// ---------------------------------------------------------------- harness
async function renderHarness() {
  if (!$("#harnessmd")) return;  // harness withheld until acceptance
  const txt = await fetch("data/harness.md", { cache: "no-store" }).then(r => (r.ok ? r.text() : "")).catch(() => "");
  const body = txt.replace(/<!--[\s\S]*?-->/g, "").trim();
  $("#harnessmd").innerHTML = window.marked ? marked.parse(body) : `<pre>${body.replace(/</g, "&lt;")}</pre>`;
}

// ---------------------------------------------------------------- page sections as tabs
// The page is a long document otherwise: six sections, one of which holds every video.
// Each section becomes its own view, addressable by a plain #hash so links still work.
function setupSectionTabs() {
  const nav = $(".subnav-in");
  if (!nav) return;
  const links = [...nav.querySelectorAll("a")];
  const ids = links.map(a => a.getAttribute("href").slice(1));
  const groups = { intro: ["tldr", "cite"], method: ["method"], design: ["clips", "training"], real: ["real"] };
  const alias = { clips: "design", training: "design", cite: "intro", harness: "intro", tldr: "intro" };
  const all = [...new Set(Object.values(groups).flat())];

  function show(id, push) {
    id = alias[id] || id;
    const target = ids.includes(id) ? id : ids[0];
    for (const s of all) {
      const el = document.getElementById(s);
      if (el) el.hidden = !groups[target].includes(s);
    }
    links.forEach((a, n) => {
      const on = ids[n] === target;
      a.classList.toggle("on", on);
      a.setAttribute("aria-current", on ? "page" : "false");
    });
    if (push && location.hash !== "#" + target) history.replaceState(null, "", "#" + target);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  links.forEach((a, n) => a.addEventListener("click", e => { e.preventDefault(); show(ids[n], true); }));
  for (const a of document.querySelectorAll('.buttons a[href^="#"]')) {
    const id = a.getAttribute("href").slice(1);
    a.addEventListener("click", e => { e.preventDefault(); show(id, true); });
  }
  window.addEventListener("hashchange", () => show(location.hash.slice(1), false));
  show(location.hash.slice(1), false);
}

function setupTheme() {
  const btn = $("#themebtn");
  if (!btn) return;
  const root = document.documentElement;
  const sysDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  let mode = "system";
  try { mode = localStorage.getItem("aah.theme") || "system"; } catch {}
  const apply = () => {
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    const dark = mode === "dark" || (mode === "system" && sysDark());
    btn.textContent = dark ? "☾" : "☀";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.title = `Theme: ${mode}. Click for ${dark ? "light" : "dark"}.`;
  };
  btn.addEventListener("click", () => {
    const dark = mode === "dark" || (mode === "system" && sysDark());
    mode = dark ? "light" : "dark";
    try { localStorage.setItem("aah.theme", mode); } catch {}
    apply();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (mode === "system") apply(); });
  apply();
}

(async function main() {
  setupTheme();
  const [train, real, videos] = await Promise.all([getJSON("data/training.json"), getJSON("data/real.json"), getJSON("data/videos.json")]);
  renderClips(train, videos);
  if (train) { renderStats(train); renderTraining(train, videos); }
  renderHarness();
  setupSectionTabs();
})();
