// node build.mjs  → dist/index.html
// A single-cycle MIPS datapath built as a populated circuit board: each unit is a chip cut in
// its textbook symbol, 32-bit buses are wide copper traces, 1-bit control lines are thin amber
// traces with LEDs. Geometry is laid out in the slide's own pixel coordinates (W converts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as k from "./kit/iso-kit.mjs";
import * as M from "./model.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const strip = (file) => read(file).replace(/^export /gm, "");

const WIDTH = 1000;
const HEIGHT = 640;
const W = ([sx, sy]) => [(sx - 40) / 2, (sy - 170) / 2];
const BOARD = { x: -4, y: -6, w: 690, d: 452, r: 10 };
const BOARD_H = 3;
const FOOT_H = 7;

const P = k.fitProjection(k.boxCorners(BOARD, -BOARD_H - FOOT_H, 12), WIDTH, HEIGHT, { pad: 14, azimuth: 84, elevation: 58 });
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const onBoard = (points, z = 0) => k.onTop(points.map(W), z, P);
const VIEW = k.towardViewer(P);
const px = (n) => Math.round(n * 10) / 10;

// ── Units, in slide pixels ──────────────────────────────────────────────────────────────
const rect = (x, y, w, h) => ({ x: (x - 40) / 2, y: (y - 170) / 2, w: w / 2, d: h / 2, r: 1.6 });
const ellipse = (cx, cy, rx, ry, n = 48) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return W([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); });
const aluRing = ([[x0, y0], [x1, y1], [, y2], [, y3]], notch) => [[x0, y0], [x1, y1], [x1, y2], [x0, y3], [x0, notch + 15], [x0 + 16, notch], [x0, notch - 15]].map(W);
const pillPlan = (x, y, w, h) => ({ ...rect(x, y, w, h), r: w / 4 });
const andRing = () => [W([1088, 400]), ...Array.from({ length: 17 }, (_, i) => { const t = -Math.PI / 2 + (i / 16) * Math.PI; return W([1114 + 24 * Math.cos(t), 420 + 20 * Math.sin(t)]); }), W([1088, 440])];
const CTRL = { cx: 573, cy: 474, rx: 34, ry: 100 };
const ctrlEdge = (y) => CTRL.cx + CTRL.rx * Math.sqrt(1 - ((y - CTRL.cy) / CTRL.ry) ** 2);

const UNITS = {
  pc: { name: "PC", plan: rect(72, 578, 36, 84), h: 9, mark: "PC", lcd: [76, 626, 28, 18] },
  four: { name: "4", plan: rect(160, 407, 28, 22), h: 3, mark: "4" },
  add4: { name: "Add", ring: aluRing([[218, 295], [268, 322], [268, 420], [218, 448]], 371), h: 7, mark: "ADD", markAt: [246, 412] },
  imem: { name: "Instruction memory", plan: rect(157, 588, 173, 180), h: 11, mark: "INSTRUCTION MEMORY", lcd: [175, 650, 137, 40] },
  ctrl: { name: "Control", ring: ellipse(CTRL.cx, CTRL.cy, CTRL.rx, CTRL.ry, 64), h: 7, mark: "CONTROL", markAt: [560, 474], vertical: true },
  regs: { name: "Registers", plan: rect(618, 588, 172, 180), h: 11, mark: "REGISTERS", lcd: [636, 650, 136, 40] },
  sext: { name: "Sign extend", ring: ellipse(762, 842, 27, 60), h: 6, mark: "SIGN EXT", markAt: [762, 846], vertical: true },
  shlj: { name: "Shift left 2 (jump)", ring: ellipse(523, 232, 22, 37), h: 5, mark: "«2", markAt: [523, 238] },
  shlb: { name: "Shift left 2 (branch)", ring: ellipse(898, 392, 22, 37), h: 5, mark: "«2", markAt: [898, 398] },
  aluctl: { name: "ALU control", ring: ellipse(918, 866, 26, 58), h: 6, mark: "ALU CTRL", markAt: [906, 846], vertical: true, lcd: [911, 858, 22, 32] },
  badd: { name: "Branch adder", ring: aluRing([[946, 270], [1043, 315], [1043, 375], [946, 420]], 345), h: 7, mark: "ADD", markAt: [1000, 368] },
  alu: { name: "ALU", ring: aluRing([[946, 602], [1043, 650], [1043, 705], [946, 752]], 677), h: 9, mark: "ALU", markAt: [990, 640], lcd: [970, 690, 64, 18] },
  and: { name: "AND gate", ring: andRing(), h: 5, mark: "&", markAt: [1112, 424] },
  dmem: { name: "Data memory", plan: rect(1105, 637, 175, 181), h: 11, mark: "DATA MEMORY", lcd: [1123, 700, 139, 40] },
  mRegDst: { name: "RegDst mux", pill: [543, 652, 28, 100], h: 6, ins: [672, 732], sel: "RegDst" },
  mALUSrc: { name: "ALUSrc mux", pill: [882, 678, 28, 94], h: 6, ins: [690, 760], sel: "ALUSrc" },
  mMemtoReg: { name: "MemtoReg mux", pill: [1313, 685, 29, 97], h: 6, ins: [768, 698], sel: "MemtoReg" },
  mPCSrc: { name: "PCSrc mux", pill: [1157, 238, 28, 120], h: 6, ins: [255, 345], sel: "pcsrc" },
  mJump: { name: "Jump mux", pill: [1255, 238, 28, 120], h: 6, ins: [345, 255], sel: "Jump" },
};

// ── Wires, in slide pixels: each is one source → one destination ────────────────────────
const C = (y) => [px(ctrlEdge(y)), y];
const ROUTES = {
  pc_imem: { from: "pc", to: "imem", paths: [[[108, 620], [157, 620]]] },
  pc_add: { from: "pc", to: "add4", paths: [[[108, 620], [122, 620], [122, 325], [218, 325]]], joins: [[122, 620]] },
  four: { from: "four", to: "add4", paths: [[[188, 418], [218, 418]]] },
  pc4_mux: { from: "add4", to: "mPCSrc", paths: [[[268, 350], [830, 350], [830, 255], [1157, 255]]], joins: [[412, 350]] },
  pc4_badd: { from: "add4", to: "badd", paths: [[[268, 350], [830, 350], [830, 298], [946, 298]]], joins: [[830, 298]] },
  pc4_hi: { from: "add4", to: "jaddr", paths: [[[268, 350], [412, 350], [412, 277], [590, 277], [590, 232]]], end: "join" },
  instr: { from: "imem", to: "fields", paths: [[[330, 679], [382, 679]], [[347, 679], [347, 232]], [[382, 474], [382, 842]]], joins: [[347, 679], [382, 679]], end: "none" },
  f_target: { from: "instr", to: "shlj", paths: [[[347, 232], [501, 232]]] },
  f_op: { from: "instr", to: "ctrl", paths: [[[382, 474], [539, 474]]] },
  f_rs: { from: "instr", to: "regs", paths: [[[382, 609], [618, 609]]], joins: [[382, 609]] },
  f_rt: { from: "instr", to: "regs", paths: [[[382, 656], [618, 656]]], joins: [[382, 656]] },
  f_rt_mux: { from: "instr", to: "mRegDst", paths: [[[382, 656], [508, 656], [508, 672], [543, 672]]], joins: [[508, 656]] },
  f_rd: { from: "instr", to: "mRegDst", paths: [[[382, 732], [543, 732]]], joins: [[382, 732]] },
  f_imm: { from: "instr", to: "sext", paths: [[[382, 842], [735, 842]]] },
  f_funct: { from: "instr", to: "aluctl", paths: [[[600, 842], [600, 918], [870, 918], [870, 866], [892, 866]]], joins: [[600, 842]] },
  wr: { from: "mRegDst", to: "regs", paths: [[[571, 702], [618, 702]]] },
  rd1: { from: "regs", to: "alu", paths: [[[790, 632], [946, 632]]] },
  rd2_mux: { from: "regs", to: "mALUSrc", paths: [[[790, 690], [882, 690]]] },
  rd2_mem: { from: "regs", to: "dmem", paths: [[[790, 690], [815, 690], [815, 785], [1105, 785]]], joins: [[815, 690]] },
  sext_mux: { from: "sext", to: "mALUSrc", paths: [[[789, 842], [848, 842], [848, 760], [882, 760]]] },
  sext_shl: { from: "sext", to: "shlb", paths: [[[789, 842], [848, 842], [848, 392], [876, 392]]], joins: [[848, 760]] },
  alub: { from: "mALUSrc", to: "alu", paths: [[[910, 725], [946, 725]]] },
  res_mem: { from: "alu", to: "dmem", paths: [[[1043, 698], [1105, 698]]] },
  res_mux: { from: "alu", to: "mMemtoReg", paths: [[[1043, 698], [1062, 698], [1062, 830], [1295, 830], [1295, 768], [1313, 768]]], joins: [[1062, 698]] },
  zero: { from: "alu", to: "and", paths: [[[1043, 660], [1072, 660], [1072, 430], [1090, 430]]] },
  mem_rd: { from: "dmem", to: "mMemtoReg", paths: [[[1280, 698], [1313, 698]]] },
  wd: { from: "mMemtoReg", to: "regs", paths: [[[1342, 733], [1360, 733], [1360, 965], [582, 965], [582, 748], [618, 748]]] },
  shl_badd: { from: "shlb", to: "badd", paths: [[[920, 392], [946, 392]]] },
  btarget: { from: "badd", to: "mPCSrc", paths: [[[1043, 345], [1157, 345]]] },
  pcsrc: { from: "and", to: "mPCSrc", paths: [[[1138, 420], [1171, 420], [1171, 358]]] },
  m1: { from: "mPCSrc", to: "mJump", paths: [[[1185, 300], [1215, 300], [1215, 345], [1255, 345]]] },
  jtarget: { from: "shlj", to: "jaddr", paths: [[[545, 232], [590, 232]]], end: "join" },
  jaddr: { from: "jaddr", to: "mJump", paths: [[[590, 232], [1228, 232], [1228, 255], [1255, 255]]], joins: [[590, 232]] },
  next: { from: "mJump", to: "pc", paths: [[[1283, 300], [1302, 300], [1302, 183], [53, 183], [53, 620], [72, 620]]] },
  c_RegDst: { from: "ctrl", to: "mRegDst", paths: [[C(398), [615, 398], [615, 366], [365, 366], [365, 790], [557, 790], [557, 752]]] },
  c_Jump: { from: "ctrl", to: "mJump", paths: [[C(417), [744, 417], [744, 210], [1269, 210], [1269, 238]]] },
  c_Branch: { from: "ctrl", to: "and", paths: [[C(436), [1055, 436], [1055, 410], [1090, 410]]] },
  c_MemRead: { from: "ctrl", to: "dmem", paths: [[C(455), [1215, 455], [1215, 637]]] },
  c_MemtoReg: { from: "ctrl", to: "mMemtoReg", paths: [[C(474), [1327, 474], [1327, 685]]] },
  c_ALUOp: { from: "ctrl", to: "aluctl", paths: [[C(493), [922, 493], [922, 809]]] },
  c_MemWrite: { from: "ctrl", to: "dmem", paths: [[C(512), [1170, 512], [1170, 637]]] },
  c_ALUSrc: { from: "ctrl", to: "mALUSrc", paths: [[C(531), [896, 531], [896, 678]]] },
  c_RegWrite: { from: "ctrl", to: "regs", paths: [[C(550), [703, 550], [703, 588]]] },
  alu_op: { from: "aluctl", to: "alu", paths: [[[944, 866], [972, 866], [972, 739]]] },
};
const META = Object.fromEntries(M.WIRES.map((w) => [w.id, w]));
for (const id of Object.keys(ROUTES)) if (!META[id]) throw new Error(`route ${id} has no wire in the model`);
for (const w of M.WIRES) if (!ROUTES[w.id]) throw new Error(`wire ${w.id} has no route`);

// ── Board ──────────────────────────────────────────────────────────────────────────────
function board() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOARD, -BOARD_H - FOOT_H, BOARD_H, P)}"/>`];
  const feet = k.corners(BOARD, 14).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 6.4, -BOARD_H - FOOT_H, 1.4, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 4.6, -BOARD_H - FOOT_H + 1.4, FOOT_H - 1.4, P, 24), { tone: "mid" }));
    out.push(L(k.knurl(x, y, 4.6, -BOARD_H - FOOT_H + 2.4, -BOARD_H - 1, 14, P), { tone: "faint" }));
  }
  out.push(S(k.slabOf(BOARD, -BOARD_H, BOARD_H, P, 8, 1.2), { tone: "mid", inner: L(k.sideSeam(BOARD, -BOARD_H / 2, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BOARD, 4), 0, P), { tone: "faint" }));
  // mounting holes: plated ring, screw head, slot
  for (const [x, y] of k.corners(BOARD, 14)) {
    out.push(L(k.ring(x, y, 6.4, 0, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 3.8, 0, 1.2, P, 24), { tone: "mid" }));
    out.push(L(k.lineOnTop([x - 2.6, y - 0.6], [x + 2.6, y + 0.6], 1.2, P), { tone: "lo", free: true }));
  }
  // fiducials
  for (const [x, y] of [[BOARD.x + 30, BOARD.y + 10], [BOARD.x + BOARD.w - 30, BOARD.y + BOARD.d - 10]]) {
    out.push(L(k.ring(x, y, 2.4, 0, P, 20), { tone: "lo" }), D([at([x, y, 0])], { size: 0.9, tone: "mid" }));
  }
  return out.join("");
}

// The front strip: crystal, STEP switch, power LED, header and the name plate.
function frontStrip() {
  const out = [];
  const y0 = 414;
  // crystal oscillator can (HC-49)
  const xtal = { x: 56, y: y0, w: 18, d: 7, r: 3.4 };
  out.push(S(k.slabOf(k.insetPlan(xtal, -0.8), 0, 0.8, P, 6), { tone: "lo" }));
  out.push(S(k.slabOf(xtal, 0.8, 5, P, 6, 0.6), { tone: "mid" }));
  out.push(D([at([60, y0 + 3.5, 5.8]), at([70, y0 + 3.5, 5.8])], { size: 0.5 }));
  // STEP tactile switch: body, four legs, round cap (the cap is live)
  const sw = { x: 22, y: y0 - 3, w: 13, d: 13, r: 1.2 };
  for (const [x, y] of [[22.5, y0 - 4.4], [33.5, y0 - 4.4]]) out.push(S(k.slabOf({ x, y, w: 1.6, d: 2, r: 0.3 }, 0, 1, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf(sw, 0, 3.4, P, 3, 0.5), { tone: "mid" }));
  for (const [x, y] of [[22.5, y0 + 10.4], [33.5, y0 + 10.4]]) out.push(S(k.slabOf({ x, y, w: 1.6, d: 2, r: 0.3 }, 0, 1, P, 2), { tone: "lo" }));
  out.push(D(k.corners(sw, 1.8).map(([x, y]) => at([x, y, 3.4])), { size: 0.45 }));
  out.push(`<g class="step-cap" data-unit="step">${S(k.cylinder(28.5, y0 + 3.5, 3.6, 3.4, 3, P, 28, 0.4), { tone: "hi" })}${L(k.ring(28.5, y0 + 3.5, 2.2, 6.4, P, 24), { tone: "faint" })}</g>`);
  // power LED with resistor
  out.push(S(k.slabOf({ x: 88, y: y0 + 1, w: 6, d: 3, r: 0.5 }, 0, 1.2, P, 2), { tone: "mid" }));
  out.push(S(k.cylinder(103, y0 + 3, 2.4, 0, 2.6, P, 20), { tone: "mid" }));
  out.push(`<path class="led-lens" data-led="power" d="${k.ring(103, y0 + 3, 1.7, 2.6, P, 20)}"/>`);
  // 2×8 header
  const hdr = { x: 470, y: y0 - 1, w: 42, d: 10, r: 0.8 };
  out.push(S(k.slabOf(hdr, 0, 2.6, P, 2, 0.4), { tone: "lo" }));
  const pins = [];
  for (let i = 0; i < 8; i++) for (const y of [y0 + 1.5, y0 + 6.5]) pins.push([473 + i * 5.1, y]);
  for (const [x, y] of pins.sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) out.push(S(k.slabOf({ x: x - 0.7, y: y - 0.7, w: 1.4, d: 1.4, r: 0.2 }, 2.6, 4.4, P, 1), { tone: "mid", crease: "none" }));
  // name plate
  const plate = { x: 540, y: y0 - 2, w: 118, d: 16, r: 1.4 };
  out.push(S(k.slabOf(plate, 0, 0.8, P, 4, 0.4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 1.4), 0.8, P), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([546, y0 + 5.6], 0.8, P, "x"), "MIPS-1 · SINGLE CYCLE", { size: 4.6, tone: "mid" }));
  out.push(L(k.lineOnTop([546, y0 + 9.6], [610, y0 + 9.6], 0.8, P), { tone: "lo", free: true }));
  out.push(L(k.lineOnTop([546, y0 + 11.6], [590, y0 + 11.6], 0.8, P), { tone: "faint", free: true }));
  out.push(D([at([plate.x + 3, plate.y + 8, 0.8]), at([plate.x + plate.w - 3, plate.y + 8, 0.8])], { size: 0.45 }));
  out.push(silk([24, y0 + 16.5], "STEP"), silk([56, y0 + 13], "CLK 25MHz"), silk([86, y0 + 9.5], "PWR"), silk([470, y0 + 15.5], "J1 · DEBUG"));
  return out.join("");
}

const silk = (pt, text, size = 3.6, anchor = "start") => `<text class="silk" transform="${k.topMatrix(pt, 0, P, "x")}" font-size="${size}" text-anchor="${anchor}">${text}</text>`;
const silkS = (spt, text, size, anchor) => silk(W(spt), text, size, anchor);

// ── Traces ─────────────────────────────────────────────────────────────────────────────
function traces() {
  const data = [], control = [], pads = [], joins = [];
  for (const [id, route] of Object.entries(ROUTES)) {
    const meta = META[id];
    const d = route.paths.map((path) => onBoard(path)).join("");
    const ctl = meta.kind === "bool" || meta.kind === "ctl";
    const g = `<g class="tr" data-w="${id}" data-kind="${meta.kind}" data-from="${route.from}" data-to="${route.to}"><path class="u" d="${d}"/><path class="b" d="${d}"/><path class="g" d="${d}"/>${route.paths.map((path) => `<path class="p" pathLength="1" d="${onBoard(path)}"/>`).join("")}<path class="f" d="${d}"/><path class="h" d="${d}"/></g>`;
    (ctl ? control : data).push(g);
    for (const j of route.joins ?? []) joins.push(`<circle class="join" data-w="${id}" cx="${px(at([...W(j), 0])[0])}" cy="${px(at([...W(j), 0])[1])}" r="${ctl ? 1.2 : 1.7}"/>`);
    const last = route.paths[route.paths.length - 1];
    if (route.end !== "none") pads.push(padAt(last[last.length - 1], ctl));
    if (!["instr"].includes(route.from)) pads.push(padAt(route.paths[0][0], ctl));
  }
  return { data: data.join(""), control: control.join(""), pads: pads.join(""), joins: joins.join("") };
}
const padAt = (spt, ctl) => { const [x, y] = at([...W(spt), 0]); return `<circle class="pad" cx="${px(x)}" cy="${px(y)}" r="${ctl ? 1 : 1.4}"/>`; };

// Leads: a short metal lead where a trace meets a chip, split by which side of the chip it is on.
function leads() {
  const near = [], far = [];
  const add = (p, q) => {
    const [x0, y0] = W(p), [x1, y1] = W(q);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const dir = [(x1 - x0) / len, (y1 - y0) / len];
    const reach = 3.6;
    const ex = x0 + dir[0] * reach, ey = y0 + dir[1] * reach;
    const wide = 1.3;
    const plan = { x: Math.min(x0, ex) - (dir[0] ? 0 : wide), y: Math.min(y0, ey) - (dir[1] ? 0 : wide), w: Math.abs(ex - x0) || wide * 2, d: Math.abs(ey - y0) || wide * 2, r: 0.3 };
    const svg = S(k.slabOf(plan, 0, 1.1, P, 1), { tone: "mid", crease: "none" });
    (dir[0] * VIEW[0] + dir[1] * VIEW[1] > 0 ? near : far).push(svg);
  };
  for (const [id, route] of Object.entries(ROUTES)) {
    const first = route.paths[0], last = route.paths[route.paths.length - 1];
    if (route.from !== "instr" && route.from !== "jaddr" && UNITS[route.from]) add(first[0], first[1]);
    if (route.end !== "join" && route.end !== "none" && UNITS[route.to]) add(last[last.length - 1], last[last.length - 2]);
  }
  return { near: near.join(""), far: far.join("") };
}

// ── Chips ──────────────────────────────────────────────────────────────────────────────
function chip(id, u) {
  const out = [];
  const z0 = u.plan ? 1.4 : 0;
  const top = z0 + u.h;
  if (u.plan) {
    if (u.h > 8) out.push(`<path class="iso-halo chip-halo" d="${k.haloOf(u.plan, 0, 0.1, P)}"/>`);
    out.push(S(k.slabOf(k.insetPlan(u.plan, -1.6), 0, z0, P, 4, 0.3), { tone: "lo" }));
    out.push(S(k.slabOf(u.plan, z0, u.h, P, 4, 0.9), { tone: "hi", inner: L(k.sideSeam(u.plan, z0 + 1.6, P, 4), { tone: "faint" }) }));
    out.push(L(k.planOutline(k.insetPlan(u.plan, 2.2), top, P, 4), { tone: "faint" }));
    out.push(D([at([u.plan.x + 4, u.plan.y + 4, top])], { size: 1, tone: "mid" }));
  } else if (u.pill) {
    const plan = pillPlan(...u.pill);
    out.push(S(k.slabOf(plan, 0, u.h, P, 10, 0.6), { tone: "hi" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 1.6), u.h, P, 10), { tone: "faint" }));
  } else {
    out.push(S(k.extrude(u.ring, 0, u.h, P, { convex: id !== "add4" && id !== "badd" && id !== "alu", bevel: 0.6 }), { tone: "hi" }));
  }
  if (u.mark) {
    const [mx, my] = u.markAt ? W(u.markAt) : [u.plan.x + u.plan.w / 2, u.plan.y + 9];
    const size = u.plan ? (u.plan.w < 30 ? 4.6 : 5.2) : 4.2;
    if (u.vertical) out.push(`<text class="mark" transform="${k.topMatrix([mx, my], top, P, "y")}" font-size="${size}" text-anchor="middle">${u.mark}</text>`);
    else out.push(`<text class="mark" transform="${k.topMatrix([mx, my], top, P, "x")}" font-size="${size}" text-anchor="middle">${u.mark}</text>`);
  }
  if (u.lcd) out.push(lcd(id, u.lcd, top));
  if (u.pill) out.push(muxTop(id, u));
  if (id === "ctrl") out.push(ctrlLeds(top));
  if (id === "alu") out.push(led("zero", W([1025, 668]), top, 1.7));
  if (id === "and") out.push(led("pcsrc", W([1108, 420]), top, 1.7));
  return `<g class="unit" data-unit="${id}">${out.join("")}</g>`;
}

// LCD window recessed into a chip top. Lines are filled live.
function lcd(id, [x, y, w, h], z) {
  const plan = rect(x, y, w, h);
  const rows = id === "pc" || id === "alu" || id === "aluctl" ? 1 : 2;
  const size = id === "pc" ? 3.2 : id === "aluctl" ? 3.2 : id === "alu" ? 4.2 : 4.4;
  const out = [`<path class="lcd-bg" d="${k.planOutline(plan, z, P, 2)}"/>`, L(k.planOutline(k.insetPlan(plan, -0.7), z, P, 2), { tone: "lo" })];
  for (let r = 0; r < rows; r++) {
    const ty = plan.y + (rows === 1 ? plan.d / 2 + size * 0.36 : plan.d * (r === 0 ? 0.36 : 0.78) + size * 0.2);
    out.push(`<text class="lcd-text" data-lcd="${id}:${r}" transform="${k.topMatrix([plan.x + plan.w / 2, ty], z, P, "x")}" font-size="${size}" text-anchor="middle"> </text>`);
  }
  return out.join("");
}

const led = (name, [x, y], z, r = 1.9) => `<g class="led" data-led="${name}">${S(k.cylinder(x, y, r, z, 0.9, P, 18), { tone: "mid", crease: "none" })}<path class="led-glow" d="${k.ring(x, y, r * 2.4, z + 0.9, P, 24)}"/><path class="led-lens" d="${k.ring(x, y, r * 0.78, z + 0.9, P, 18)}"/></g>`;
function ctrlLeds(z) {
  return M.SIGNALS.map((name, i) => { const y = 398 + i * 19; return led(name, W([ctrlEdge(y) - 11, y]), z); }).join("");
}

// A mux: a pill with a rotary selector whose lever points at the input it passes through.
const MUX = {};
function muxTop(id, u) {
  const plan = pillPlan(...u.pill);
  const [x, y, w] = u.pill;
  const centre = W([x + w / 2, u.pill[1] + u.pill[3] / 2]);
  const inputs = u.ins.map((sy) => W([x + 5, sy]));
  MUX[id] = { centre, inputs, z: u.h + 1.4, sel: u.sel };
  const out = [S(k.cylinder(centre[0], centre[1], 4.6, u.h, 1.4, P, 28, 0.3), { tone: "mid" })];
  out.push(L(k.radialTicks(centre[0], centre[1], 4.6, 24, 6, u.h + 1.4, [0.6, 1.1], P).major, { tone: "faint" }));
  u.ins.forEach((sy, i) => out.push(`<text class="mark mux-n" transform="${k.topMatrix(W([x + 6, sy + 3]), u.h, P, "x")}" font-size="3.4" text-anchor="middle">${i}</text>`));
  out.push(`<path class="lever" data-lever="${id}" d=""/>`);
  out.push(D([at([...centre, u.h + 1.4])], { size: 0.9, tone: "hi" }));
  return out.join("");
}

// Decoupling capacitors beside the big chips: small parts that a real board carries.
function caps() {
  const out = [];
  for (const [sx, sy] of [[140, 590], [600, 590], [1090, 640], [800, 600], [340, 760], [1290, 640]]) {
    const [x, y] = W([sx, sy]);
    out.push(S(k.slabOf({ x: x - 1.6, y: y - 3, w: 3.2, d: 6, r: 0.4 }, 0, 1.8, P, 2, 0.3), { tone: "mid" }));
    out.push(L(k.lineOnTop([x - 1.6, y - 1.4], [x + 1.6, y - 1.4], 1.8, P), { tone: "faint" }), L(k.lineOnTop([x - 1.6, y + 1.4], [x + 1.6, y + 1.4], 1.8, P), { tone: "faint" }));
  }
  return out.join("");
}

// Silkscreen: the bit ranges and signal names printed on the board, as on the slide.
function silkscreen() {
  const out = [];
  const label = (spt, text, anchor) => out.push(silkS(spt, text, 4.2, anchor));
  label([352, 226], "Instruction [25–0]");
  label([388, 469], "Instruction [31–26]");
  label([388, 604], "[25–21]");
  label([388, 651], "[20–16]");
  label([388, 727], "[15–11]");
  label([388, 837], "Instruction [15–0]");
  label([606, 913], "[5–0]");
  label([420, 272], "PC+4 [31–28]");
  label([600, 226], "Jump address [31–0]");
  label([90, 178], "Next PC");
  M.SIGNALS.forEach((name, i) => label([620, 398 + i * 19 - 3], name));
  label([956, 860], "ALU operation");
  label([1050, 655], "Zero");
  label([1046, 693], "result");
  // bus-width slashes, as on the slide
  for (const [sx, sy, n] of [[478, 232, 26], [568, 232, 28], [700, 842, 16], [805, 842, 32]]) {
    const [x, y] = W([sx, sy]);
    out.push(L(k.lineOnTop([x - 1.6, y + 2.6], [x + 1.6, y - 2.6], 0, P), { tone: "mid", free: true }));
    out.push(silk([x + 1.4, y - 3.2], String(n), 3.2));
  }
  out.push(silkS([548, 772], "MUX", 3), silkS([886, 790], "MUX", 3), silkS([1316, 800], "MUX", 3), silkS([1158, 376], "MUX", 3), silkS([1256, 376], "MUX", 3));
  return out.join("");
}

// ── Assemble ───────────────────────────────────────────────────────────────────────────
const T = traces();
const LEADS = leads();
const order = Object.entries(UNITS).sort(([, a], [, b]) => depthOfUnit(a) - depthOfUnit(b));
function depthOfUnit(u) {
  if (u.plan) return k.depthOf([u.plan.x + u.plan.w / 2, u.plan.y + u.plan.d, 0], P);
  if (u.pill) { const p = pillPlan(...u.pill); return k.depthOf([p.x + p.w / 2, p.y + p.d, 0], P); }
  return Math.max(...u.ring.map(([x, y]) => k.depthOf([x, y, 0], P)));
}
const chips = order.map(([id, u]) => chip(id, u)).join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  className: "board",
  label: "A single-cycle MIPS processor built as a circuit board. Each unit of the datapath is a chip cut in its textbook symbol: PC, instruction memory, control, register file, sign extend, ALU and ALU control, data memory, two adders, two shift-left-2 units, an AND gate and five multiplexers with selector levers. Wide grey traces carry 32-bit data, thinner ones carry instruction fields, and thin amber traces carry 1-bit control signals whose LEDs light when they are 1.",
  body: [
    board(),
    `<g class="silkscreen">${silkscreen()}</g>`,
    frontStrip(),
    `<g class="traces data">${T.data}</g>`,
    `<g class="traces control">${T.control}</g>`,
    `<g class="pads">${T.pads}${T.joins}</g>`,
    caps(),
    LEADS.far,
    chips,
    LEADS.near,
  ],
});

const INFO = JSON.parse(read("info.json"));
const DATA = { P, MUX, ROUTES: Object.fromEntries(Object.entries(ROUTES).map(([id, r]) => [id, { from: r.from, to: r.to }])), INFO };

const body = `
<header class="intro">
  <p class="eyebrow">Computer organisation · study figure</p>
  <h1>The single-cycle MIPS processor, as a circuit board</h1>
  <p class="lede">Every instruction runs from one clock edge to the next. Watch the values ripple from the PC through the board, see which wires the instruction really uses, and which 1-bit control lines (amber) steer it there.</p>
  <ol class="quick">
    <li><b>Press Clock</b> (or →) to run one instruction. Values ripple out from the PC, unit by unit.</li>
    <li><b>Read the wires.</b> Wide = 32-bit data, thin amber = 1-bit control, LED lit = 1. Faded = nothing uses it this cycle.</li>
    <li><b>Hover anything</b> for its value and job. Try one instruction alone with <b>Run one on its own</b> below.</li>
  </ol>
</header>
${k.plateHtml({
  fig: "Fig 1",
  title: "Single-cycle datapath",
  hint: "Hover a wire or chip · press STEP",
  readout: "",
  keys: [
    { mark: "bus", label: "32-bit data bus: wide trace" },
    { mark: "field", label: "Instruction field (4–28 bits): medium trace" },
    { mark: "ctl", label: "1-bit control / flag: amber, LED lit = 1" },
    { mark: "dashed", label: "Don't-care (X) or unused this cycle: faded" },
    { mark: "flow", label: "Moving dashes: value this instruction uses" },
  ],
  caption: "Layout follows Patterson & Hennessy's datapath with Jump (JAL, JR, JALR omitted). The clock period must fit the slowest instruction, lw: PC → instruction memory → registers → ALU → data memory → MemtoReg mux → register file. Every other instruction waits for it — the price of a single cycle.",
  body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Single-cycle MIPS board. Right arrow steps one clock cycle, left arrow steps back, space plays or pauses, R replays the cycle.">${svg}<div class="tip" hidden></div></div>`,
})}
<div class="dock" aria-label="Clock controls">
  <div class="bar">
    <div class="group">
      <button data-act="prev" title="Step back (←)">◀ Back</button>
      <button data-act="step" class="primary" title="Clock edge (→)">Clock ▶</button>
      <button data-act="play" title="Play / pause (space)">Pause</button>
      <button data-act="replay" title="Replay this cycle (R)">Replay</button>
      <label class="speed">Speed <select data-act="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    </div>
    <div class="group seg" role="radiogroup" aria-label="Show">
      <button data-view="all" aria-pressed="true">All wires</button>
      <button data-view="bool" aria-pressed="false">1-bit only</button>
      <button data-view="data" aria-pressed="false">Data only</button>
      <button data-view="used" aria-pressed="false">Used path</button>
    </div>
    <div class="group">
      <button data-act="labels" aria-pressed="true">Labels</button>
      <button data-act="theme">Dark</button>
    </div>
  </div>
  <div class="phases" aria-hidden="true">${["Fetch", "Decode", "Read regs", "Execute", "Memory", "Write-back", "Next PC", "Clock edge"].map((p) => `<span data-phase="${p}">${p}</span>`).join("")}</div>
  <p class="now" data-now aria-live="off"></p>
</div>
<section class="deck" aria-label="Instruction details">
  <article class="panel enc">
    <div class="enc-head">
      <h2>Instruction <small data-format></small></h2>
      <div class="picker" role="group" aria-label="Run one instruction on its own">
        <span>Run one on its own:</span>${M.CATALOG.map((e) => `<button data-try="${e.name}" aria-pressed="false">${e.name}</button>`).join("")}<button data-try="program" aria-pressed="true" class="prog-btn">Whole program</button>
      </div>
    </div>
    <div class="enc-row"><code class="syntax" data-syntax></code><span class="means">means</span><code class="rtl" data-rtl></code></div>
    <div class="fields" data-fields></div>
    <p class="enc-note">Hover a field to light the board traces its bits travel on. The fields are split off by wiring alone, no logic.</p>
  </article>
  <div class="cols">
    <article class="panel">
      <h2>Program <small>click a line to jump there</small></h2>
      <ol class="prog">${M.PROGRAM.map((line, i) => `<li data-i="${i}"><span class="addr">${M.hex(M.TEXT_BASE + i * 4)}</span><code class="word">${M.hex(line.word)}</code><span class="asm">${line.asm}</span></li>`).join("")}</ol>
      <p class="note" data-note></p>
    </article>
    <article class="panel">
      <h2>Control signals <small data-kindline></small></h2>
      <table class="sig"><tbody>${M.SIGNALS.map((s) => `<tr data-sig="${s}"><th>${s}</th><td class="v"><span class="bit"></span></td><td class="why"></td></tr>`).join("")}</tbody></table>
      <p class="aluline" data-aluline></p>
    </article>
    <article class="panel">
      <h2 data-insp-title>Inspector</h2>
      <div class="insp" data-insp></div>
      <h2 class="sub">State <small>changes at the clock edge</small></h2>
      <div class="state" data-state></div>
    </article>
  </div>
</section>`;

const CSS = read("page.css");
let html = k.pageHtml({ title: "Single-cycle MIPS · anatomy", theme: "light", width: 1180, body, script: strip("kit/iso-kit.mjs") + "\n" + strip("model.mjs") + `\nconst DATA = ${JSON.stringify(DATA)};\n` + read("live.js") });
html = html.replace("</style>", CSS + "</style>").replace(`<html lang="en">`, `<html lang="en"><!-- built by build.mjs -->`);
mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("./dist/index.html", import.meta.url), html);
console.log("wrote dist/index.html", (html.length / 1024).toFixed(0) + " KB");
