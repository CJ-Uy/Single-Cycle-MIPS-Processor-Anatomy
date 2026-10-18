// Runtime for the board. Inlined after the kit and model.mjs; DATA comes from build.mjs.
// No program runs: the reader picks one instruction, its signals ripple through once,
// and the board stays settled for zooming, panning and inspecting.
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
const PHASES = ["Fetch", "Decode", "Decode", "Read regs", "Execute", "Execute", "Memory", "Write-back", "Next PC"];

let entry = CATALOG[0];
let state = catalogState(entry);
let res = step(state, [entry.line]);
let t = 0, frame = 0, last = 0, edged = false;
let arrived = new Set();
let focusId = null;
const lever = Object.fromEntries(Object.keys(MUX).map((id) => [id, { at: 0, to: 0 }]));

// ── formatting ─────────────────────────────────────────────────────────────────────────
const bin = (v, n) => (v >>> 0).toString(2).padStart(n, "0").slice(-n);
const regName = (n) => `$${REG_NAMES[n]}`;
const isX = (id) => id.startsWith("c_") && res.control.x.includes(id.slice(2));
function fmt(id) {
  const w = META[id], v = res.value[id];
  if (isX(id)) return `X  (don't care · board drives ${id === "c_ALUOp" ? "00" : "0"})`;
  if (v === null || v === undefined) return "not driven (MemRead = 0)";
  if (w.width === 32) return `0x${hex(v)}  (${v | 0})`;
  if (w.width === 5) return `${v}  = ${regName(v)}`;
  if (w.width === 16) return `0x${hex(v, 4)}  (${(v << 16) >> 16})`;
  if (w.width === 26 || w.width === 28) return `0x${hex(v, 7)}`;
  if (id === "alu_op") return `${bin(v, 4)}  = ${res.alu.name}`;
  if (id === "f_op") return `${bin(v, 6)}  = ${res.control.kind === "R" ? "R-type" : res.control.kind}`;
  return bin(v, w.width);
}
const short = (id) => (res.value[id] === null ? "—" : META[id].width === 32 ? "0x" + hex(res.value[id]) : fmt(id).split("  ")[0]);
const writesText = () => res.writes.map((w) => (w.kind === "pc" ? `PC ← 0x${hex(w.value)}` : w.kind === "mem" ? `M[0x${hex(w.at)}] ← 0x${hex(w.value)}` : w.ignored ? "$zero stays 0" : `${regName(w.at)} ← 0x${hex(w.value)}`)).join(", ");

// ── one instruction ────────────────────────────────────────────────────────────────────
function load(next) {
  entry = next;
  state = catalogState(entry);
  res = step(state, [entry.line]);
  ripple();
}
function ripple() {
  t = still.matches ? EDGE_AT : 0;
  edged = false;
  arrived = new Set();
  const used = [], unused = [];
  for (const w of WIRES) {
    const el = wireEl[w.id];
    el.toggleAttribute("data-pending", true);
    el.toggleAttribute("data-used", res.used.has(w.id));
    el.toggleAttribute("data-x", isX(w.id));
    el.dataset.on = res.value[w.id] ? "1" : "0";
    el.classList.remove("arrive");
    (res.used.has(w.id) ? used : unused).push(el);
  }
  // used traces drawn last, so a shared trunk shows the live branch on top
  for (const el of [...unused, ...used]) (el.dataset.kind === "bool" || el.dataset.kind === "ctl" ? layer.control : layer.data).appendChild(el);
  for (const key of Object.keys(lcdEl)) lcdEl[key].textContent = "";
  for (const g of Object.values(ledEl)) g.dataset.on = "0";
  pressCap();
  panels();
  phase();
  run();
}

function arrive(id) {
  arrived.add(id);
  const el = wireEl[id], v = res.value;
  el.removeAttribute("data-pending");
  if (res.used.has(id) && !still.matches) { el.classList.remove("arrive"); void el.getBBox(); el.classList.add("arrive"); }
  const name = id.startsWith("c_") ? id.slice(2) : null;
  if (name && ledEl[name]) ledEl[name].dataset.on = String(v[id] ? 1 : 0);
  if (id === "zero" || id === "pcsrc") ledEl[id].dataset.on = String(v[id]);
  for (const [mux, sel] of Object.entries(SELECT)) if (sel === id) lever[mux].to = v[id] ? 1 : 0;
  if (id === "pc_imem") lcd("pc", 0, hex(state.pc));
  if (id === "instr") { lcd("imem", 0, hex(res.word)); lcd("imem", 1, res.line.asm); }
  if (id === "rd1") { lcd("regs", 0, `rs ${regName(res.fields.rs).padEnd(5)} ${hex(v.rd1)}`); lcd("regs", 1, `rt ${regName(res.fields.rt).padEnd(5)} ${hex(v.rd2_mux)}`); }
  if (id === "alu_op") lcd("aluctl", 0, res.alu.name);
  if (id === "res_mem") lcd("alu", 0, hex(v.res_mem));
  if (id === "mem_rd") {
    if (res.control.MemRead) { lcd("dmem", 0, `read  @${hex(v.res_mem)}`); lcd("dmem", 1, `→ ${hex(v.mem_rd)}`); }
    else if (res.control.MemWrite) { lcd("dmem", 0, `write @${hex(v.res_mem)}`); lcd("dmem", 1, `at edge ← ${hex(v.rd2_mem)}`); }
    else { lcd("dmem", 0, "idle"); lcd("dmem", 1, "MemRead = MemWrite = 0"); }
  }
  if (focusId) { inspect(focusId); if (META[focusId]) tip.innerHTML = tipWire(focusId); }
}
const lcd = (unit, row, text) => { const el = lcdEl[`${unit}:${row}`]; if (el) el.textContent = text; };
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

// ── frame loop: runs only while signals ripple or a lever turns ──────────────────────
function tick(now) {
  const dt = last ? Math.min(now - last, 50) : 16;
  last = now;
  if (!still.matches) t += dt;
  arriveDue(t);
  if (t >= EDGE_AT && !edged) {
    edged = true;
    for (const id of ["pc", ...(res.control.RegWrite ? ["regs"] : []), ...(res.control.MemWrite ? ["dmem"] : [])]) flash(unitEl[id]);
  }
  let moving = false;
  for (const [id, l] of Object.entries(lever)) {
    const before = l.at;
    l.at = still.matches ? l.to : l.at + (l.to - l.at) * (1 - Math.exp(-dt / 140));
    if (Math.abs(l.to - l.at) < 0.002) l.at = l.to;
    if (l.at !== before) drawLever(id);
    moving ||= l.at !== l.to;
  }
  phase();
  frame = moving || t < EDGE_AT ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } };

function drawLever(id) {
  const m = MUX[id], l = lever[id].at;
  const target = [m.inputs[0][0] + (m.inputs[1][0] - m.inputs[0][0]) * l, m.inputs[0][1] + (m.inputs[1][1] - m.inputs[0][1]) * l];
  const dx = target[0] - m.centre[0], dy = target[1] - m.centre[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  leverEl[id].setAttribute("d", lineOnTop([m.centre[0] - ux * 1.6, m.centre[1] - uy * 1.6], [m.centre[0] + ux * 4.2, m.centre[1] + uy * 4.2], m.z + 0.1, P));
}

function phase() {
  const done = t >= EDGE_AT;
  const name = done ? "Clock edge" : PHASES[Math.min(Math.floor(t / LEVEL_MS), PHASES.length - 1)];
  const text = done ? `${res.line.asm} · settled · at the clock edge ${writesText()}` : `${res.line.asm} · ${name.toLowerCase()}…`;
  if (readout.textContent !== text) readout.textContent = text;
  for (const s of $$("[data-phase]")) s.toggleAttribute("data-on", s.dataset.phase === name);
}

// ── panels ─────────────────────────────────────────────────────────────────────────────
function panels() {
  for (const b of $$("[data-try]")) b.setAttribute("aria-pressed", String(b.dataset.try === entry.name));
  const given = Object.entries(entry.regs).map(([n, v]) => `$${n} = ${v}`).join(", ");
  $("[data-note]").textContent = `Example: ${res.line.asm}${given ? `, with ${given}` : ""}.`;
  encoding();
  const kind = res.control.kind;
  $("[data-kindline]").textContent = `${kind === "R" ? "R-type" : kind} · opcode ${bin(res.fields.op, 6)}`;
  for (const row of $$("tr[data-sig]")) {
    const s = row.dataset.sig, x = res.control.x.includes(s);
    row.querySelector(".bit").textContent = s === "ALUOp" ? (x ? "XX" : bin(res.control.ALUOp, 2)) : x ? "X" : String(res.control[s]);
    row.dataset.v = x ? "x" : res.control[s] ? "1" : "0";
    row.querySelector(".why").textContent = INFO.why[s][kind].split(" · ")[1];
  }
  $("[data-aluline]").textContent = res.control.ALUOp === 2 ? `funct ${bin(res.fields.funct, 6)} → ALU operation ${bin(res.alu.code, 4)} (${res.alu.name})` : res.control.x.includes("ALUOp") ? "The ALU result is not used." : `ALUOp ${bin(res.control.ALUOp, 2)} → ALU operation ${bin(res.alu.code, 4)} (${res.alu.name}); funct ignored`;
  if (focusId) inspect(focusId); else overview();
}

function overview() {
  $("[data-insp-title]").textContent = "Inspector";
  const kinds = { R: "an R-type", addi: "an add-immediate", lw: "a load", sw: "a store", beq: "a branch", j: "a jump" };
  $("[data-insp]").innerHTML = `<p class="big"><code>${res.line.asm}</code> is ${kinds[res.control.kind]}.</p>
  <p>It uses <b>${res.used.size}</b> of ${WIRES.length} wires. Faded wires still carry values — every unit computes something every cycle — but nothing written at the clock edge depends on them.</p>
  ${res.control.kind === "beq" ? `<p>Zero = ${res.value.zero}, so the branch is <b>${res.taken ? "taken" : "not taken"}</b>.</p>` : ""}
  <p>At the clock edge: <code>${writesText()}</code></p>
  <p class="hint">Hover any trace or chip on the board for its value and job.</p>`;
}

function inspect(id) {
  if (META[id]) {
    const w = META[id], [title, desc] = INFO.wires[id], name = id.startsWith("c_") ? id.slice(2) : null, x = isX(id);
    const kindLabel = { data: "32-bit data bus", field: `${w.width}-bit instruction field`, bool: "1-bit (boolean) wire", ctl: `${w.width}-bit control` }[w.kind];
    const status = !arrived.has(id) ? "signal still on its way" : x ? "don't care" : res.used.has(id) ? "used by this instruction" : "carries a value nobody uses";
    $("[data-insp-title]").textContent = title;
    $("[data-insp]").innerHTML = `<p class="tags"><span>${kindLabel}</span><span data-s="${x ? "x" : res.used.has(id) ? "used" : "idle"}">${status}</span></p>
      <p class="val"><code>${arrived.has(id) ? fmt(id) : "…"}</code></p>
      ${w.width === 32 && arrived.has(id) && res.value[id] !== null ? `<p class="bits">${bin(res.value[id], 32).replace(/(.{4})/g, "$1 ")}</p>` : ""}
      <p>${desc}</p>${name ? `<p class="why"><b>${res.control.kind === "R" ? "R-type" : res.control.kind}:</b> ${INFO.why[name]?.[res.control.kind] ?? ""}</p>` : ""}
      <p class="route">${unitName(ROUTES[id].from)} → ${unitName(ROUTES[id].to)}</p>`;
  } else {
    const [title, desc] = INFO.units[id] ?? [id, ""];
    const ins = WIRES.filter((w) => ROUTES[w.id].to === id), outs = WIRES.filter((w) => ROUTES[w.id].from === id || (id === "imem" && w.id === "instr"));
    const list = (ws) => ws.map((w) => `<li data-ref="${w.id}" data-s="${res.used.has(w.id) ? "used" : "idle"}"><span>${INFO.wires[w.id][0]}</span><code>${arrived.has(w.id) ? short(w.id) : "…"}</code></li>`).join("");
    $("[data-insp-title]").textContent = title;
    $("[data-insp]").innerHTML = `<p>${desc}</p>${ins.length ? `<h3>In</h3><ul class="io">${list(ins)}</ul>` : ""}${outs.length ? `<h3>Out</h3><ul class="io">${list(outs)}</ul>` : ""}`;
  }
}
const unitName = (u) => INFO.units[u]?.[0] ?? { fields: "instruction fields", instr: "instruction bus", jaddr: "jump address join" }[u] ?? u;

// ── instruction encoding ───────────────────────────────────────────────────────────────
const FORMAT = { R: "R", addi: "I", lw: "I", sw: "I", beq: "I", j: "J" };
const LAYOUT = {
  R: [["op", 31, 26], ["rs", 25, 21], ["rt", 20, 16], ["rd", 15, 11], ["shamt", 10, 6], ["funct", 5, 0]],
  I: [["op", 31, 26], ["rs", 25, 21], ["rt", 20, 16], ["imm", 15, 0]],
  J: [["op", 31, 26], ["target", 25, 0]],
};
const FIELD_WIRES = { op: ["f_op"], rs: ["f_rs"], rt: ["f_rt", "f_rt_mux"], rd: ["f_rd"], shamt: [], funct: ["f_funct"], imm: ["f_imm", "f_funct"], target: ["f_target"] };
const ROLE = {
  R: { rs: "1st source", rt: "2nd source", rd: "destination", shamt: "shift amount · not wired here", funct: "which ALU operation" },
  addi: { rs: "source", rt: "destination", imm: "constant, sign-extended" },
  lw: { rs: "base address", rt: "destination", imm: "byte offset, sign-extended" },
  sw: { rs: "base address", rt: "value to store", imm: "byte offset, sign-extended" },
  beq: { rs: "compared", rt: "compared", imm: "offset in words" },
  j: { target: "word address" },
};
function encoding() {
  const kind = res.control.kind, format = FORMAT[kind];
  $("[data-format]").textContent = `${format}-format · ${format === "R" ? "register" : format === "I" ? "immediate" : "jump"}`;
  $("[data-syntax]").textContent = `${res.line.asm}   ← ${entry.syntax}`;
  $("[data-rtl]").textContent = entry.rtl;
  $("[data-fields]").innerHTML = LAYOUT[format].map(([name, hi, lo]) => {
    const width = hi - lo + 1, v = (res.word >>> lo) & (2 ** width - 1);
    const meaning = name === "op" ? `${v} = ${kind === "R" ? "R-type" : kind}`
      : ["rs", "rt", "rd"].includes(name) ? `${v} = ${regName(v)}`
      : name === "funct" ? `${v} = ${res.alu.name}`
      : name === "imm" ? `0x${hex(v, 4)} = ${(v << 16) >> 16}`
      : name === "target" ? `×4 → 0x${hex(res.value.jaddr)}` : String(v);
    const role = name === "op" ? "tells Control the kind" : ROLE[kind]?.[name] ?? "";
    return `<div class="fld" data-f="${name}" style="grid-column:span ${width}"><span class="fn">${name}<i>[${hi}–${lo}]</i></span><code class="fb">${bin(v, width)}</code><span class="fv">${meaning}</span><span class="fo">${role}</span></div>`;
  }).join("");
}
function lightWires(ids) {
  for (const el of $$(".on-focus", board)) el.classList.remove("on-focus");
  if (!ids) { delete board.dataset.focus; return; }
  board.dataset.focus = "";
  for (const id of ids) wireEl[id]?.classList.add("on-focus");
  if (ids.length) unitEl[ROUTES[ids[0]].to]?.classList.add("on-focus");
}
$("[data-fields]").addEventListener("pointerover", (event) => { const f = event.target.closest(".fld"); if (!f) return; for (const o of $$(".fld")) o.toggleAttribute("data-on", o === f); lightWires(FIELD_WIRES[f.dataset.f]); });
$("[data-fields]").addEventListener("pointerleave", () => { for (const o of $$(".fld")) o.removeAttribute("data-on"); lightWires(null); });

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
  for (const f of $$(".fld")) f.toggleAttribute("data-on", (FIELD_WIRES[f.dataset.f] ?? []).includes(id));
  tip.hidden = false;
  tip.innerHTML = META[id] ? tipWire(id) : `<b>${(INFO.units[id] ?? [id])[0]}</b><p>${(INFO.units[id] ?? ["", ""])[1]}</p>`;
  moveTip(event);
}
function tipWire(id) {
  const w = META[id];
  const kind = { data: "32-bit data", field: `${w.width}-bit field`, bool: "1-bit", ctl: `${w.width}-bit control` }[w.kind];
  const status = !arrived.has(id) ? "on its way" : isX(id) ? "don't care" : res.used.has(id) ? "used" : "not used by this instruction";
  return `<b>${INFO.wires[id][0]}</b><span class="tv">${arrived.has(id) ? fmt(id) : "…"}</span><span class="tk">${kind} · ${status}</span><p>${INFO.wires[id][1]}</p>`;
}
function clearFocus() {
  focusId = null;
  delete board.dataset.focus;
  for (const el of $$(".on-focus", board)) el.classList.remove("on-focus");
  for (const f of $$(".fld[data-on]")) f.removeAttribute("data-on");
  tip.hidden = true;
}
function moveTip(event) {
  if (!event) return;
  const box = stage.getBoundingClientRect();
  const x = event.clientX - box.left, y = event.clientY - box.top;
  tip.style.left = `${Math.max(8, Math.min(x + 14, box.width - tip.offsetWidth - 8))}px`;
  tip.style.top = `${y + 18 + tip.offsetHeight > box.height ? y - tip.offsetHeight - 12 : y + 18}px`;
}
const pick = (target) => { const w = target.closest?.(".tr"); if (w) return w.dataset.w; const u = target.closest?.(".unit, .step-cap"); return u ? u.dataset.unit : null; };
const unfocus = () => { if (focusId) { clearFocus(); overview(); } };
board.addEventListener("pointermove", (event) => { if (pan.moved || pointers.size > 1) return; const id = pick(event.target); if (id) focus(id, event); else unfocus(); });
board.addEventListener("pointerleave", unfocus);
$("[data-insp]").addEventListener("pointerover", (event) => { const ref = event.target.closest("[data-ref]"); for (const el of $$(".tr.ref", board)) el.classList.remove("ref"); if (ref) wireEl[ref.dataset.ref].classList.add("ref"); });

// ── zoom and pan: the svg viewBox is the camera ────────────────────────────────────────
const BASE = { w: board.viewBox.baseVal.width, h: board.viewBox.baseVal.height };
const MAX_ZOOM = 8;
const zoomLabel = $("[data-zoom-level]");
let view = { x: 0, y: 0, w: BASE.w };
let tween = 0;
const clampView = ({ x, y, w }) => {
  w = Math.min(BASE.w, Math.max(BASE.w / MAX_ZOOM, w));
  const h = (w * BASE.h) / BASE.w;
  return { x: Math.min(BASE.w - w, Math.max(0, x)), y: Math.min(BASE.h - h, Math.max(0, y)), w };
};
function setView(next) {
  view = clampView(next);
  const h = (view.w * BASE.h) / BASE.w, zoom = BASE.w / view.w;
  board.setAttribute("viewBox", `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${h.toFixed(2)}`);
  board.style.setProperty("--zs", Math.sqrt(zoom).toFixed(3));
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  stage.toggleAttribute("data-zoomed", zoom > 1.01);
}
const toBoard = (clientX, clientY) => {
  const r = board.getBoundingClientRect();
  return [view.x + ((clientX - r.left) / r.width) * view.w, view.y + ((clientY - r.top) / r.height) * ((view.w * BASE.h) / BASE.w)];
};
const zoomedAt = ([px, py], factor, from = view) => {
  const w = clampView({ ...from, w: from.w / factor }).w, k = w / from.w;
  return { x: px - (px - from.x) * k, y: py - (py - from.y) * k, w };
};
function animateTo(target) {
  cancelAnimationFrame(tween);
  const from = { ...view }, to = clampView(target), start = performance.now();
  if (still.matches) return setView(to);
  const stepTween = (now) => {
    const s = Math.min(1, (now - start) / 260), e = 1 - (1 - s) ** 3;
    setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e });
    if (s < 1) tween = requestAnimationFrame(stepTween);
  };
  tween = requestAnimationFrame(stepTween);
}
const centre = () => [view.x + view.w / 2, view.y + (view.w * BASE.h) / BASE.w / 2];
const fit = () => animateTo({ x: 0, y: 0, w: BASE.w });

stage.addEventListener("wheel", (event) => {
  if (event.deltaY > 0 && view.w >= BASE.w - 0.01) return; // fully out: let the page scroll on
  event.preventDefault();
  cancelAnimationFrame(tween);
  const rate = event.deltaMode === 1 ? 0.06 : event.ctrlKey ? 0.012 : 0.0022;
  setView(zoomedAt(toBoard(event.clientX, event.clientY), Math.exp(-event.deltaY * rate)));
  unfocus();
}, { passive: false });

const pointers = new Map();
const pan = { start: null, view: null, moved: false, pinch: null };
stage.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".zoom") || (event.pointerType === "mouse" && event.button !== 0)) return;
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  cancelAnimationFrame(tween);
  if (pointers.size === 1) Object.assign(pan, { start: [event.clientX, event.clientY], view: { ...view }, moved: false, pinch: null });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pan.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: toBoard((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), view: { ...view } };
    pan.moved = true;
  }
});
addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  const r = board.getBoundingClientRect();
  if (pan.pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    setView(zoomedAt(pan.pinch.mid, Math.hypot(a[0] - b[0], a[1] - b[1]) / pan.pinch.d, pan.pinch.view));
    return;
  }
  const dx = event.clientX - pan.start[0], dy = event.clientY - pan.start[1];
  if (!pan.moved && Math.hypot(dx, dy) < 4) return;
  if (!pan.moved) { pan.moved = true; stage.setAttribute("data-panning", ""); unfocus(); }
  setView({ x: pan.view.x - dx * (pan.view.w / r.width), y: pan.view.y - dy * (pan.view.w / r.width), w: pan.view.w });
});
const release = (event) => {
  if (!pointers.delete(event.pointerId)) return;
  if (pointers.size === 0) {
    if (!pan.moved && event.pointerType !== "mouse") { const id = pick(event.target); if (id) focus(id, event); else unfocus(); }
    if (!pan.moved && event.target.closest?.(".step-cap")) ripple();
    stage.removeAttribute("data-panning");
    setTimeout(() => { pan.moved = false; }, 0);
  } else if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    Object.assign(pan, { start: p, view: { ...view }, pinch: null });
  }
};
addEventListener("pointerup", release);
addEventListener("pointercancel", release);
stage.addEventListener("dblclick", (event) => {
  if (event.target.closest(".zoom")) return;
  const zoom = BASE.w / view.w;
  animateTo(zoom >= MAX_ZOOM * 0.99 ? { x: 0, y: 0, w: BASE.w } : zoomedAt(toBoard(event.clientX, event.clientY), 2));
});
for (const b of $$("[data-zoom]")) b.addEventListener("click", () => {
  if (b.dataset.zoom === "fit") fit();
  else animateTo(zoomedAt(centre(), b.dataset.zoom === "in" ? 1.6 : 1 / 1.6));
});
stage.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const step = view.w * 0.15;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (event.key === "+" || event.key === "=") animateTo(zoomedAt(centre(), 1.6));
  else if (event.key === "-" || event.key === "_") animateTo(zoomedAt(centre(), 1 / 1.6));
  else if (event.key === "0") fit();
  else if (moves[event.key]) animateTo({ x: view.x + moves[event.key][0], y: view.y + moves[event.key][1], w: view.w });
  else if (event.key === "r" || event.key === "R") ripple();
  else return;
  event.preventDefault();
});

// ── controls ───────────────────────────────────────────────────────────────────────────
for (const b of $$("[data-try]")) b.addEventListener("click", () => load(CATALOG.find((e) => e.name === b.dataset.try)));
$("[data-act=replay]").addEventListener("click", ripple);
$("[data-act=labels]").addEventListener("click", (event) => { const on = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(on)); board.toggleAttribute("data-nolabels", !on); });
$("[data-act=theme]").addEventListener("click", (event) => { const dark = document.body.dataset.theme !== "dark"; document.body.dataset.theme = dark ? "dark" : "light"; event.currentTarget.textContent = dark ? "Light" : "Dark"; try { localStorage.setItem("mips-theme", document.body.dataset.theme); } catch {} });
try { if (localStorage.getItem("mips-theme") === "dark") $("[data-act=theme]").click(); } catch {}
for (const b of $$("[data-view]")) b.addEventListener("click", () => { for (const o of $$("[data-view]")) o.setAttribute("aria-pressed", String(o === b)); board.dataset.view = b.dataset.view; });
board.dataset.view = "all";

setView(view);
for (const id of Object.keys(lever)) drawLever(id);
ripple();
