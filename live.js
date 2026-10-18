// Runtime for the board. Inlined after the kit and model.mjs; DATA comes from build.mjs.
const { P, MUX, ROUTES, INFO } = DATA;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const stage = $(".iso-stage");
const board = $("svg.board", stage);
const tip = $(".tip", stage);
const readout = $("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const META = Object.fromEntries(WIRES.map((w) => [w.id, w]));
const wireEl = Object.fromEntries($$(".tr", board).map((g) => [g.dataset.w, g]));
const layer = { data: $(".traces.data", board), control: $(".traces.control", board) };
const unitEl = Object.fromEntries($$(".unit", board).map((g) => [g.dataset.unit, g]));
const lcdEl = Object.fromEntries($$("[data-lcd]", board).map((t) => [t.dataset.lcd, t]));
const ledEl = Object.fromEntries($$(".led", board).map((g) => [g.dataset.led, g]));
const leverEl = Object.fromEntries($$("[data-lever]", board).map((p) => [p.dataset.lever, p]));
const SELECT = { mRegDst: "c_RegDst", mALUSrc: "c_ALUSrc", mMemtoReg: "c_MemtoReg", mPCSrc: "pcsrc", mJump: "c_Jump" };

const LEVEL_MS = 340;
const EDGE_AT = LEVELS * LEVEL_MS + 120;
const HOLD = 1700;
const PHASES = ["Fetch", "Decode", "Decode", "Read regs", "Execute", "Execute", "Memory", "Write-back", "Next PC"];

let state = initialState();
let res = step(state);
const history = [];
let t = 0, speed = 1, playing = !still.matches, visible = false, frame = 0, last = 0, idle = 0;
let arrived = new Set();
let lastWrites = [];
let focusId = null;
const lever = Object.fromEntries(Object.keys(MUX).map((id) => [id, { at: 0, to: 0 }]));

// ── formatting ─────────────────────────────────────────────────────────────────────────
const signed = (v) => v | 0;
const bin = (v, n) => (v >>> 0).toString(2).padStart(n, "0").slice(-n);
const regName = (n) => `$${REG_NAMES[n]}`;
function fmt(id, r = res) {
  const w = META[id], v = r.value[id];
  const name = id.startsWith("c_") ? id.slice(2) : null;
  if (name && r.control.x.includes(name)) return `X  (don't care · board drives ${name === "ALUOp" ? "00" : "0"})`;
  if (v === null || v === undefined) return "not driven (MemRead = 0)";
  if (w.width === 32) return `0x${hex(v)}  (${signed(v)})`;
  if (w.width === 5) return `${v}  = ${regName(v)}`;
  if (w.width === 16) return `0x${hex(v, 4)}  (${(v << 16) >> 16})`;
  if (w.width === 26 || w.width === 28) return `0x${hex(v, 7)}`;
  if (id === "alu_op") return `${bin(v, 4)}  = ${r.alu.name}`;
  if (id === "f_op") return `${bin(v, 6)}  = ${r.control.kind === "R" ? "R-type" : r.control.kind}`;
  if (id === "f_funct") return `${bin(v, 6)}`;
  return bin(v, w.width);
}
const short = (id) => { const v = res.value[id]; if (v === null) return "—"; if (META[id].width === 32) return "0x" + hex(v); return fmt(id).split("  ")[0]; };

// ── one cycle ──────────────────────────────────────────────────────────────────────────
function startCycle() {
  t = still.matches ? EDGE_AT : 0;
  arrived = new Set();
  const used = [], unused = [];
  for (const w of WIRES) {
    const el = wireEl[w.id];
    const name = w.id.startsWith("c_") ? w.id.slice(2) : null;
    el.toggleAttribute("data-pending", true);
    el.toggleAttribute("data-used", res.used.has(w.id));
    el.toggleAttribute("data-x", Boolean(name && res.control.x.includes(name)));
    el.dataset.on = res.value[w.id] ? "1" : "0";
    el.classList.remove("arrive");
    (res.used.has(w.id) ? used : unused).push(el);
  }
  // used traces drawn last, so a shared trunk shows the live branch on top
  for (const el of [...unused, ...used]) (el.dataset.kind === "bool" || el.dataset.kind === "ctl" ? layer.control : layer.data).appendChild(el);
  for (const key of Object.keys(lcdEl)) lcdEl[key].textContent = "";
  for (const g of Object.values(ledEl)) if (g.dataset.led !== "power") g.dataset.on = "0";
  panels();
  run();
}

function arrive(id) {
  arrived.add(id);
  const el = wireEl[id];
  el.removeAttribute("data-pending");
  if (res.used.has(id) && !still.matches) { el.classList.remove("arrive"); void el.getBBox(); el.classList.add("arrive"); }
  const v = res.value;
  const name = id.startsWith("c_") ? id.slice(2) : null;
  if (name && ledEl[name]) ledEl[name].dataset.on = String(v[id] ? 1 : 0);
  if (id === "zero" || id === "pcsrc") ledEl[id].dataset.on = String(v[id]);
  for (const [mux, sel] of Object.entries(SELECT)) if (sel === id) lever[mux].to = v[id] ? 1 : 0;
  if (id === "pc_imem") lcd("pc", 0, hex(state.pc));
  if (id === "instr") { lcd("imem", 0, `${hex(res.word)}`); lcd("imem", 1, res.line.asm); }
  if (id === "rd1") { lcd("regs", 0, `rs ${regName(res.fields.rs).padEnd(5)} ${hex(v.rd1)}`); lcd("regs", 1, `rt ${regName(res.fields.rt).padEnd(5)} ${hex(v.rd2_mux)}`); }
  if (id === "alu_op") lcd("aluctl", 0, res.alu.name);
  if (id === "res_mem") lcd("alu", 0, hex(v.res_mem));
  if (id === "mem_rd") {
    if (res.control.MemRead) { lcd("dmem", 0, `read  @${hex(v.res_mem)}`); lcd("dmem", 1, `→ ${hex(v.mem_rd)}`); }
    else if (res.control.MemWrite) { lcd("dmem", 0, `write @${hex(v.res_mem)}`); lcd("dmem", 1, `at edge ← ${hex(v.rd2_mem)}`); }
    else { lcd("dmem", 0, "idle"); lcd("dmem", 1, "MemRead = MemWrite = 0"); }
  }
  if (focusId) inspect(focusId);
}
const lcd = (unit, row, text) => { const el = lcdEl[`${unit}:${row}`]; if (el) el.textContent = text; };

function clockEdge() {
  arriveDue(Infinity);
  for (const id of ["pc", ...(res.control.RegWrite ? ["regs"] : []), ...(res.control.MemWrite ? ["dmem"] : [])]) flash(unitEl[id]);
  pressCap();
  lastWrites = res.writes;
  history.push(state);
  if (history.length > 200) history.shift();
  state = res.after;
  res = step(state);
  startCycle();
}
function arriveDue(limit) {
  for (const w of WIRES) if (!arrived.has(w.id) && LEVEL[w.id] * LEVEL_MS <= limit) arrive(w.id);
}
function flash(el) { if (!el) return; el.classList.remove("edge"); void el.getBBox(); el.classList.add("edge"); }
function pressCap() {
  const cap = $(".step-cap", board);
  const [dx, dy] = translateAlong(P, [0, 0, -1.8]).match(/-?[\d.]+/g);
  cap.style.transform = `translate(${dx}px, ${dy}px)`;
  setTimeout(() => { cap.style.transform = ""; }, 140);
}

// ── frame loop ─────────────────────────────────────────────────────────────────────────
function tick(now) {
  const dt = last ? Math.min(now - last, 50) : 16;
  last = now;
  if (!still.matches) t += dt * speed;
  arriveDue(t);
  let moving = false;
  for (const [id, l] of Object.entries(lever)) {
    const before = l.at;
    l.at = still.matches ? l.to : l.at + (l.to - l.at) * (1 - Math.exp(-dt / 140));
    if (Math.abs(l.to - l.at) < 0.002) l.at = l.to;
    if (l.at !== before || !leverEl[id].getAttribute("d")) drawLever(id);
    moving ||= l.at !== l.to;
  }
  phase();
  if (playing && t >= EDGE_AT + HOLD) clockEdge();
  const busy = moving || t < EDGE_AT || playing;
  frame = visible && busy ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };

function drawLever(id) {
  const m = MUX[id], l = lever[id].at;
  const target = [m.inputs[0][0] + (m.inputs[1][0] - m.inputs[0][0]) * l, m.inputs[0][1] + (m.inputs[1][1] - m.inputs[0][1]) * l];
  const dx = target[0] - m.centre[0], dy = target[1] - m.centre[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  leverEl[id].setAttribute("d", lineOnTop([m.centre[0] - ux * 1.6, m.centre[1] - uy * 1.6], [m.centre[0] + ux * 4.2, m.centre[1] + uy * 4.2], m.z + 0.1, P));
}

function phase() {
  const level = Math.floor(t / LEVEL_MS);
  const name = t >= EDGE_AT ? "Clock edge" : PHASES[Math.min(level, PHASES.length - 1)];
  const text = `${hex(state.pc)} · ${res.line.asm} · ${t >= EDGE_AT ? (playing ? "settled, edge next" : "settled · press Clock") : name.toLowerCase()}`;
  if (readout.textContent !== text) readout.textContent = text;
  for (const s of $$("[data-phase]")) s.toggleAttribute("data-on", s.dataset.phase === name);
}

// ── panels ─────────────────────────────────────────────────────────────────────────────
function panels() {
  for (const li of $$(".prog li")) { li.toggleAttribute("data-on", Number(li.dataset.i) === res.index); }
  $(".prog li[data-on]")?.scrollIntoView({ block: "nearest" });
  $("[data-note]").textContent = res.line.note;
  const kind = res.control.kind;
  $("[data-kindline]").textContent = `${kind === "R" ? "R-type" : kind} · opcode ${bin(res.fields.op, 6)}`;
  for (const row of $$("tr[data-sig]")) {
    const s = row.dataset.sig, x = res.control.x.includes(s);
    const v = s === "ALUOp" ? (x ? "XX" : bin(res.control.ALUOp, 2)) : x ? "X" : String(res.control[s]);
    row.querySelector(".bit").textContent = v;
    row.dataset.v = x ? "x" : res.control[s] ? "1" : "0";
    row.querySelector(".why").textContent = INFO.why[s][kind].split(" · ")[1];
  }
  const aluLine = res.control.ALUOp === 2 ? `funct ${bin(res.fields.funct, 6)} → ALU operation ${bin(res.alu.code, 4)} (${res.alu.name})` : res.control.x.includes("ALUOp") ? "ALU result unused this cycle." : `ALUOp ${bin(res.control.ALUOp, 2)} → ALU operation ${bin(res.alu.code, 4)} (${res.alu.name}); funct ignored`;
  $("[data-aluline]").textContent = aluLine;
  stateTable();
  if (focusId) inspect(focusId); else overview();
  stage.setAttribute("aria-valuetext", `${res.line.asm}`);
}

function stateTable() {
  const regs = ["t1", "t2", "t3", "t4", "t5", "t6", "s0"].map((n) => REG_NAMES.indexOf(n));
  const pending = new Map(res.writes.filter((w) => w.kind === "reg" && !w.ignored).map((w) => [w.at, w.value]));
  const pendingMem = new Map(res.writes.filter((w) => w.kind === "mem").map((w) => [w.at, w.value]));
  const changed = new Set(lastWrites.map((w) => `${w.kind}:${w.at}`));
  const row = (label, value, key, next) => `<div class="cell${changed.has(key) ? " changed" : ""}${next !== undefined ? " pending" : ""}"><span>${label}</span><code>${hex(value)}</code>${next !== undefined ? `<em>edge ← ${hex(next)}</em>` : ""}</div>`;
  const nextPc = res.after.pc;
  let html = `<div class="cell pc${changed.has("pc:undefined") ? " changed" : ""} pending"><span>PC</span><code>${hex(state.pc)}</code><em>edge ← ${hex(nextPc)}</em></div>`;
  html += regs.map((n) => row(regName(n), state.regs[n], `reg:${n}`, pending.get(n))).join("");
  html += [0, 4, 8].map((o) => row(`M[${o}($s0)]`, state.mem[DATA_BASE + o] ?? 0, `mem:${DATA_BASE + o}`, pendingMem.get(DATA_BASE + o))).join("");
  $("[data-state]").innerHTML = html;
}

function overview() {
  $("[data-insp-title]").textContent = "Inspector";
  const n = res.used.size;
  const kinds = { R: "an R-type", lw: "a load", sw: "a store", beq: "a branch", j: "a jump" };
  $("[data-insp]").innerHTML = `<p class="big"><code>${res.line.asm}</code> is ${kinds[res.control.kind]}.</p>
  <p>This cycle uses <b>${n}</b> of ${WIRES.length} wires. Faded wires still carry values — every unit computes something every cycle — but nothing that is written at the clock edge depends on them.</p>
  ${res.control.kind === "beq" ? `<p>Zero = ${res.value.zero}, so the branch is <b>${res.taken ? "taken" : "not taken"}</b>: next PC = 0x${hex(res.after.pc)}.</p>` : ""}
  <p class="hint">Hover any trace or chip on the board for its value and job.</p>`;
}

function inspect(id) {
  const isWire = Boolean(META[id]);
  if (isWire) {
    const w = META[id];
    const [title, desc] = INFO.wires[id];
    const name = id.startsWith("c_") ? id.slice(2) : null;
    const x = name && res.control.x.includes(name);
    const kindLabel = { data: "32-bit data bus", field: `${w.width}-bit instruction field`, bool: "1-bit (boolean) wire", ctl: `${w.width}-bit control` }[w.kind];
    const status = !arrived.has(id) ? "signal still on its way" : x ? "don't care this cycle" : res.used.has(id) ? "used by this instruction" : "carries a value nobody uses";
    $("[data-insp-title]").textContent = title;
    $("[data-insp]").innerHTML = `<p class="tags"><span>${kindLabel}</span><span data-s="${x ? "x" : res.used.has(id) ? "used" : "idle"}">${status}</span></p>
      <p class="val"><code>${arrived.has(id) ? fmt(id) : "…"}</code></p>
      ${w.width === 32 && arrived.has(id) && res.value[id] !== null ? `<p class="bits">${bin(res.value[id], 32).replace(/(.{4})/g, "$1 ")}</p>` : ""}
      <p>${desc}</p>${name ? `<p class="why"><b>${res.control.kind === "R" ? "R-type" : res.control.kind}:</b> ${INFO.why[name]?.[res.control.kind] ?? ""}</p>` : ""}
      <p class="route">${unitName(ROUTES[id].from)} → ${unitName(ROUTES[id].to)}</p>`;
  } else {
    const [title, desc] = INFO.units[id] ?? [id, ""];
    const ins = WIRES.filter((w) => ROUTES[w.id].to === id || (id === "imem" && false)), outs = WIRES.filter((w) => ROUTES[w.id].from === id || (id === "imem" && w.id === "instr"));
    const list = (ws) => ws.map((w) => `<li data-ref="${w.id}" data-s="${res.used.has(w.id) ? "used" : "idle"}"><span>${INFO.wires[w.id][0]}</span><code>${arrived.has(w.id) ? short(w.id) : "…"}</code></li>`).join("");
    $("[data-insp-title]").textContent = title;
    $("[data-insp]").innerHTML = `<p>${desc}</p>${ins.length ? `<h3>In</h3><ul class="io">${list(ins)}</ul>` : ""}${outs.length ? `<h3>Out</h3><ul class="io">${list(outs)}</ul>` : ""}`;
  }
}
const unitName = (u) => INFO.units[u]?.[0] ?? { fields: "instruction fields", instr: "instruction bus", jaddr: "jump address join" }[u] ?? u;

// ── focus and hover ────────────────────────────────────────────────────────────────────
function focus(id, event) {
  if (focusId === id) { moveTip(event); return; }
  clearFocus();
  focusId = id;
  board.dataset.focus = "";
  if (META[id]) {
    wireEl[id].classList.add("on-focus");
    for (const u of [ROUTES[id].from, ROUTES[id].to]) unitEl[u]?.classList.add("on-focus");
  } else {
    unitEl[id]?.classList.add("on-focus");
    for (const w of WIRES) if (ROUTES[w.id].from === id || ROUTES[w.id].to === id || (id === "imem" && w.id === "instr")) wireEl[w.id].classList.add("on-focus");
  }
  inspect(id);
  tip.hidden = false;
  tip.innerHTML = META[id] ? `<b>${INFO.wires[id][0]}</b><span>${arrived.has(id) ? fmt(id) : "…"}</span>` : `<b>${(INFO.units[id] ?? [id])[0]}</b>`;
  moveTip(event);
}
function clearFocus() {
  focusId = null;
  delete board.dataset.focus;
  for (const el of $$(".on-focus", board)) el.classList.remove("on-focus");
  tip.hidden = true;
}
function moveTip(event) {
  if (!event) return;
  const box = stage.getBoundingClientRect();
  const x = event.clientX - box.left + stage.scrollLeft, y = event.clientY - box.top;
  tip.style.left = `${Math.min(x + 14, stage.scrollWidth - 250)}px`;
  tip.style.top = `${y + 16}px`;
}
const pick = (target) => { const w = target.closest?.(".tr"); if (w) return w.dataset.w; const u = target.closest?.(".unit, .step-cap"); return u ? u.dataset.unit : null; };
board.addEventListener("pointermove", (event) => { const id = pick(event.target); if (id) focus(id, event); else if (focusId) { clearFocus(); overview(); } });
board.addEventListener("pointerleave", () => { clearFocus(); overview(); });
board.addEventListener("click", (event) => { if (event.target.closest(".step-cap")) { hold(); clockEdge(); } });

// ── controls ───────────────────────────────────────────────────────────────────────────
function hold() { playing = false; playBtn(); }
const playBtn = () => { $("[data-act=play]").textContent = playing ? "Pause" : "Play"; };
$("[data-act=step]").addEventListener("click", () => { hold(); clockEdge(); });
$("[data-act=prev]").addEventListener("click", back);
$("[data-act=replay]").addEventListener("click", () => { startCycle(); });
$("[data-act=play]").addEventListener("click", () => { playing = !playing; playBtn(); run(); });
$("[data-act=speed]").addEventListener("change", (event) => { speed = Number(event.target.value); });
$("[data-act=labels]").addEventListener("click", (event) => { const on = event.target.getAttribute("aria-pressed") !== "true"; event.target.setAttribute("aria-pressed", String(on)); board.toggleAttribute("data-nolabels", !on); });
$("[data-act=theme]").addEventListener("click", (event) => { const dark = document.body.dataset.theme !== "dark"; document.body.dataset.theme = dark ? "dark" : "light"; event.target.textContent = dark ? "Light" : "Dark"; try { localStorage.setItem("mips-theme", document.body.dataset.theme); } catch {} });
try { if (localStorage.getItem("mips-theme") === "dark") $("[data-act=theme]").click(); } catch {}
for (const b of $$("[data-view]")) b.addEventListener("click", () => { for (const o of $$("[data-view]")) o.setAttribute("aria-pressed", String(o === b)); board.dataset.view = b.dataset.view; });
board.dataset.view = "all";
for (const li of $$(".prog li")) li.addEventListener("click", () => { hold(); history.push(state); state = { ...state, pc: TEXT_BASE + Number(li.dataset.i) * 4 }; lastWrites = []; res = step(state); startCycle(); });
$("[data-insp]").addEventListener("pointerover", (event) => { const ref = event.target.closest("[data-ref]"); for (const el of $$(".tr.ref", board)) el.classList.remove("ref"); if (ref) wireEl[ref.dataset.ref].classList.add("ref"); });
function back() {
  hold();
  if (!history.length) return;
  state = history.pop();
  lastWrites = [];
  res = step(state);
  startCycle();
}
document.addEventListener("keydown", (event) => {
  if (event.target.closest("select, input, textarea") || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "ArrowRight") { hold(); clockEdge(); }
  else if (event.key === "ArrowLeft") back();
  else if (event.key === " " && !event.target.closest("button")) { playing = !playing; playBtn(); run(); }
  else if (event.key === "r" || event.key === "R") startCycle();
  else return;
  event.preventDefault();
});

new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
playBtn();
startCycle();
for (const id of Object.keys(lever)) drawLever(id);
