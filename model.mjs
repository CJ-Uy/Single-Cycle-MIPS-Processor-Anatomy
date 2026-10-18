// Single-cycle MIPS datapath (Patterson & Hennessy, with Jump), as a pure model.
// Every wire on the board gets a value every cycle; `used` says whether that value
// can reach anything that is written at the clock edge (PC, a register, memory).

export const TEXT_BASE = 0x00400000;
export const DATA_BASE = 0x10010000;

export const REG_NAMES = ["zero", "at", "v0", "v1", "a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra"];
const R = Object.fromEntries(REG_NAMES.map((name, index) => [name, index]));

const OP = { R: 0x00, j: 0x02, beq: 0x04, lw: 0x23, sw: 0x2b };
const FUNCT = { add: 0x20, sub: 0x22, and: 0x24, or: 0x25, slt: 0x2a };

const rType = (name, rd, rs, rt) => ({ asm: `${name} $${rd}, $${rs}, $${rt}`, word: ((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | FUNCT[name]) >>> 0 });
const iType = (name, rs, rt, imm, asm) => ({ asm, word: ((OP[name] << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xffff)) >>> 0 });
const mem = (name, rt, offset, base) => iType(name, base, rt, offset, `${name} $${rt}, ${offset}($${base})`);
const beq = (rs, rt, offset) => iType("beq", rs, rt, offset, `beq $${rs}, $${rt}, ${offset}`);
const jump = (target) => ({ asm: `j 0x${hex(target)}`, word: ((OP.j << 26) | ((target >>> 2) & 0x3ffffff)) >>> 0 });

export const PROGRAM = [
  { ...mem("lw", "t1", 0, "s0"), note: "Load A[0] = 7 into $t1." },
  { ...mem("lw", "t2", 4, "s0"), note: "Load A[1] = 5 into $t2." },
  { ...rType("add", "t3", "t1", "t2"), note: "$t3 = 7 + 5 = 12." },
  { ...mem("sw", "t3", 8, "s0"), note: "Store the sum into A[2]." },
  { ...rType("sub", "t4", "t3", "t1"), note: "$t4 = 12 − 7 = 5." },
  { ...beq("t4", "t2", 1), note: "5 == 5, so the branch is taken: skip the next instruction." },
  { ...rType("and", "t5", "t1", "t2"), note: "Skipped by the branch above (unless you jump here yourself)." },
  { ...rType("slt", "t5", "t2", "t1"), note: "$t5 = (5 < 7) = 1." },
  { ...beq("t5", "zero", -9), note: "1 ≠ 0, so not taken. Its offset is negative: watch the sign extender." },
  { ...rType("or", "t6", "t1", "t2"), note: "$t6 = 7 | 5 = 7." },
  { ...jump(TEXT_BASE), note: "Jump back to the start: the loop never ends." },
];

export function initialState() {
  const regs = new Array(32).fill(0);
  regs[R.s0] = DATA_BASE;
  return { pc: TEXT_BASE, regs, mem: { [DATA_BASE]: 7, [DATA_BASE + 4]: 5, [DATA_BASE + 8]: 0 }, cycle: 0 };
}

export function hex(value, digits = 8) {
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, "0").slice(-digits);
}

// Control unit truth table. x marks a don't-care; the hardware still drives 0 on it.
const CONTROL = {
  R: { RegDst: 1, ALUSrc: 0, MemtoReg: 0, RegWrite: 1, MemRead: 0, MemWrite: 0, Branch: 0, ALUOp: 2, Jump: 0, x: [] },
  lw: { RegDst: 0, ALUSrc: 1, MemtoReg: 1, RegWrite: 1, MemRead: 1, MemWrite: 0, Branch: 0, ALUOp: 0, Jump: 0, x: [] },
  sw: { RegDst: 0, ALUSrc: 1, MemtoReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 1, Branch: 0, ALUOp: 0, Jump: 0, x: ["RegDst", "MemtoReg"] },
  beq: { RegDst: 0, ALUSrc: 0, MemtoReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 0, Branch: 1, ALUOp: 1, Jump: 0, x: ["RegDst", "MemtoReg"] },
  j: { RegDst: 0, ALUSrc: 0, MemtoReg: 0, RegWrite: 0, MemRead: 0, MemWrite: 0, Branch: 0, ALUOp: 0, Jump: 1, x: ["RegDst", "ALUSrc", "MemtoReg", "ALUOp"] },
};
const CLASS_OF = { 0x00: "R", 0x23: "lw", 0x2b: "sw", 0x04: "beq", 0x02: "j" };
export const SIGNALS = ["RegDst", "Jump", "Branch", "MemRead", "MemtoReg", "ALUOp", "MemWrite", "ALUSrc", "RegWrite"];

export function control(opcode) {
  const kind = CLASS_OF[opcode];
  if (!kind) throw new Error(`opcode ${opcode} is not wired on this board`);
  return { kind, ...CONTROL[kind] };
}

// ALU control: ALUOp 00 add, 01 subtract, 10 decode funct.
const ALU_OPS = { 0b0000: "and", 0b0001: "or", 0b0010: "add", 0b0110: "sub", 0b0111: "slt" };
const BY_FUNCT = { 0x20: 0b0010, 0x22: 0b0110, 0x24: 0b0000, 0x25: 0b0001, 0x2a: 0b0111 };
export function aluControl(aluOp, funct) {
  const code = aluOp === 0 ? 0b0010 : aluOp === 1 ? 0b0110 : BY_FUNCT[funct] ?? 0b0010;
  return { code, name: ALU_OPS[code] };
}

export function alu(code, a, b) {
  const result = code === 0b0000 ? a & b : code === 0b0001 ? a | b : code === 0b0010 ? a + b : code === 0b0110 ? a - b : (a | 0) < (b | 0) ? 1 : 0;
  return result >>> 0;
}

// Every wire on the board: [id, width, kind]. kind: data (32-bit), field (slice of the
// instruction), bool (1-bit), ctl (multi-bit control).
export const WIRES = [
  ["pc_imem", 32, "data"], ["pc_add", 32, "data"], ["four", 32, "data"],
  ["pc4_mux", 32, "data"], ["pc4_badd", 32, "data"], ["pc4_hi", 4, "field"],
  ["instr", 32, "data"], ["f_op", 6, "field"], ["f_rs", 5, "field"], ["f_rt", 5, "field"], ["f_rt_mux", 5, "field"],
  ["f_rd", 5, "field"], ["f_imm", 16, "field"], ["f_funct", 6, "field"], ["f_target", 26, "field"],
  ["wr", 5, "field"], ["rd1", 32, "data"], ["rd2_mux", 32, "data"], ["rd2_mem", 32, "data"],
  ["sext_mux", 32, "data"], ["sext_shl", 32, "data"], ["alub", 32, "data"], ["res_mem", 32, "data"], ["res_mux", 32, "data"],
  ["zero", 1, "bool"], ["mem_rd", 32, "data"], ["wd", 32, "data"], ["shl_badd", 32, "data"], ["btarget", 32, "data"],
  ["pcsrc", 1, "bool"], ["m1", 32, "data"], ["jtarget", 28, "field"], ["jaddr", 32, "data"], ["next", 32, "data"],
  ["c_RegDst", 1, "bool"], ["c_Jump", 1, "bool"], ["c_Branch", 1, "bool"], ["c_MemRead", 1, "bool"], ["c_MemtoReg", 1, "bool"],
  ["c_ALUOp", 2, "ctl"], ["c_MemWrite", 1, "bool"], ["c_ALUSrc", 1, "bool"], ["c_RegWrite", 1, "bool"], ["alu_op", 4, "ctl"],
].map(([id, width, kind]) => ({ id, width, kind }));

// Combinational depth: how many units a signal has passed through since the clock edge.
export const LEVEL = {
  pc_imem: 0, pc_add: 0, four: 0,
  instr: 1, pc4_mux: 1, pc4_badd: 1, pc4_hi: 1,
  f_op: 2, f_rs: 2, f_rt: 2, f_rt_mux: 2, f_rd: 2, f_imm: 2, f_funct: 2, f_target: 2,
  c_RegDst: 3, c_Jump: 3, c_Branch: 3, c_MemRead: 3, c_MemtoReg: 3, c_ALUOp: 3, c_MemWrite: 3, c_ALUSrc: 3, c_RegWrite: 3,
  rd1: 3, rd2_mux: 3, rd2_mem: 3, sext_mux: 3, sext_shl: 3, jtarget: 3,
  wr: 4, alu_op: 4, alub: 4, shl_badd: 4, jaddr: 4,
  res_mem: 5, res_mux: 5, zero: 5, btarget: 5,
  pcsrc: 6, mem_rd: 6,
  m1: 7, wd: 7,
  next: 8,
};
export const LEVELS = 9;

// One clock cycle: every wire's value, which wires matter, and the state after the edge.
export function step(state) {
  const pc = state.pc >>> 0;
  const index = (pc - TEXT_BASE) / 4;
  const line = PROGRAM[index];
  if (!line || !Number.isInteger(index)) throw new Error(`no instruction at 0x${hex(pc)}`);
  const word = line.word;
  const f = {
    op: word >>> 26, rs: (word >>> 21) & 31, rt: (word >>> 16) & 31, rd: (word >>> 11) & 31,
    imm: word & 0xffff, funct: word & 63, target: word & 0x3ffffff,
  };
  const c = control(f.op);
  const pc4 = (pc + 4) >>> 0;
  const sext = ((f.imm << 16) >> 16) >>> 0;
  const shl = (sext << 2) >>> 0;
  const btarget = (pc4 + shl) >>> 0;
  const jtarget = (f.target << 2) >>> 0;
  const jaddr = ((pc4 & 0xf0000000) | jtarget) >>> 0;
  const rd1 = state.regs[f.rs] >>> 0;
  const rd2 = state.regs[f.rt] >>> 0;
  const wr = c.RegDst ? f.rd : f.rt;
  const op = aluControl(c.ALUOp, f.funct);
  const alub = c.ALUSrc ? sext : rd2;
  const res = alu(op.code, rd1, alub);
  const zero = res === 0 ? 1 : 0;
  const memRd = c.MemRead ? (state.mem[res] ?? 0) >>> 0 : null;
  const wd = c.MemtoReg ? memRd : res;
  const pcsrc = c.Branch & zero;
  const m1 = pcsrc ? btarget : pc4;
  const next = c.Jump ? jaddr : m1;

  const value = {
    pc_imem: pc, pc_add: pc, four: 4, pc4_mux: pc4, pc4_badd: pc4, pc4_hi: pc4 >>> 28,
    instr: word, f_op: f.op, f_rs: f.rs, f_rt: f.rt, f_rt_mux: f.rt, f_rd: f.rd, f_imm: f.imm, f_funct: f.funct, f_target: f.target,
    wr, rd1, rd2_mux: rd2, rd2_mem: rd2, sext_mux: sext, sext_shl: sext, alub, res_mem: res, res_mux: res, zero,
    mem_rd: memRd, wd, shl_badd: shl, btarget, pcsrc, m1, jtarget, jaddr, next, alu_op: op.code,
  };
  for (const name of SIGNALS) value[`c_${name}`] = c[name];

  // Walk back from what the clock edge writes, through the inputs each unit is really using.
  const used = new Set();
  const need = (...ids) => ids.forEach((id) => { if (!used.has(id)) { used.add(id); DEPS[id]?.(); } });
  const DEPS = {
    next: () => need("c_Jump", c.Jump ? "jaddr" : "m1"),
    jaddr: () => need("pc4_hi", "jtarget"), jtarget: () => need("f_target"), pc4_hi: () => need("pc_add", "four"),
    m1: () => need("pcsrc", pcsrc ? "btarget" : "pc4_mux"),
    pcsrc: () => (c.Branch ? need("c_Branch", "zero") : need("c_Branch")),
    pc4_mux: () => need("pc_add", "four"), pc4_badd: () => need("pc_add", "four"),
    btarget: () => need("pc4_badd", "shl_badd"), shl_badd: () => need("sext_shl"), sext_shl: () => need("f_imm"), sext_mux: () => need("f_imm"),
    zero: () => need("rd1", "alub", "alu_op"), res_mem: () => need("rd1", "alub", "alu_op"), res_mux: () => need("rd1", "alub", "alu_op"),
    alub: () => need("c_ALUSrc", c.ALUSrc ? "sext_mux" : "rd2_mux"),
    alu_op: () => need("c_ALUOp", ...(c.ALUOp === 2 ? ["f_funct"] : [])),
    rd1: () => need("f_rs"), rd2_mux: () => need("f_rt"), rd2_mem: () => need("f_rt"),
    wd: () => need("c_MemtoReg", c.MemtoReg ? "mem_rd" : "res_mux"),
    mem_rd: () => need("c_MemRead", "res_mem"),
    wr: () => need("c_RegDst", c.RegDst ? "f_rd" : "f_rt_mux"),
    f_op: () => need("instr"), f_rs: () => need("instr"), f_rt: () => need("instr"), f_rt_mux: () => need("instr"), f_rd: () => need("instr"),
    f_imm: () => need("instr"), f_funct: () => need("instr"), f_target: () => need("instr"), instr: () => need("pc_imem"),
  };
  need("next", "c_RegWrite", "c_MemWrite", "c_MemRead", "f_op");
  if (c.RegWrite) need("wr", "wd");
  if (c.MemWrite) need("res_mem", "rd2_mem");
  // A control line that is not a don't-care is always doing a job, even at 0.
  for (const name of SIGNALS) if (!c.x.includes(name)) used.add(`c_${name}`);
  for (const name of c.x) used.delete(`c_${name}`);
  used.add("f_op");
  used.add("instr");

  const regs = [...state.regs];
  const memNext = { ...state.mem };
  const writes = [];
  if (c.RegWrite && wr !== 0) { regs[wr] = wd >>> 0; writes.push({ kind: "reg", at: wr, value: wd >>> 0 }); }
  if (c.RegWrite && wr === 0) writes.push({ kind: "reg", at: 0, value: 0, ignored: true });
  if (c.MemWrite) { memNext[res] = rd2; writes.push({ kind: "mem", at: res, value: rd2 }); }
  writes.push({ kind: "pc", value: next });

  return {
    index, line, word, fields: f, control: c, alu: op, value, used,
    taken: Boolean(pcsrc), writes,
    after: { pc: next, regs, mem: memNext, cycle: state.cycle + 1 },
  };
}
