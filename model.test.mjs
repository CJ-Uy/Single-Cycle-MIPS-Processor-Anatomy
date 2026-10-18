// node model.test.mjs — runs the program around its loop twice and checks the datapath.
import assert from "node:assert/strict";
import { CATALOG, DATA_BASE, PROGRAM, TEXT_BASE, catalogState, initialState, step } from "./model.mjs";

assert.equal(PROGRAM[0].word, 0x8e090000, "lw $t1, 0($s0)");
assert.equal(PROGRAM[2].word, 0x012a5820, "add $t3, $t1, $t2");
assert.equal(PROGRAM[3].word, 0xae0b0008, "sw $t3, 8($s0)");
assert.equal(PROGRAM[8].word, 0x11a0fff7, "beq $t5, $zero, -9");
assert.equal(PROGRAM[11].word, 0x08100000, "j 0x00400000");
assert.equal(PROGRAM[10].word, 0x21ef0001, "addi $t7, $t7, 1");

let state = initialState();
const trace = [];
for (let i = 0; i < 24; i++) {
  const r = step(state);
  trace.push(r);
  state = r.after;
}
const at = (n) => trace[n];
assert.equal(at(0).after.regs[9], 7);
assert.equal(at(2).value.res_mux, 12);
assert.equal(at(3).after.mem[DATA_BASE + 8], 12);
assert.equal(at(5).taken, true, "beq taken");
assert.equal(at(5).after.pc, TEXT_BASE + 0x1c, "skips the and");
assert.equal(at(6).line.asm, "slt $t5, $t2, $t1");
assert.equal(at(6).after.regs[13], 1);
assert.equal(at(7).value.sext_mux, 0xfffffff7, "negative offset sign-extends");
assert.equal(at(7).taken, false);
assert.equal(at(9).after.regs[15], 1, "addi counts");
assert.equal(at(10).after.pc, TEXT_BASE, "j loops");
assert.equal(at(11).index, 0);
assert.equal(at(20).after.regs[15], 2, "second trip");

// Path tracing: what each kind of instruction really uses.
const lw = at(0).used, add = at(2).used, sw = at(3).used, beq = at(5).used, j = at(10).used;
assert.ok(lw.has("mem_rd") && lw.has("sext_mux") && !lw.has("rd2_mux") && !lw.has("f_rd"));
assert.ok(add.has("f_funct") && add.has("f_rd") && !add.has("mem_rd") && !add.has("sext_mux"));
assert.ok(sw.has("rd2_mem") && !sw.has("wd") && !sw.has("c_RegDst") && sw.has("c_RegWrite"));
assert.ok(beq.has("zero") && beq.has("btarget") && !beq.has("pc4_mux") && !beq.has("res_mem"));
assert.ok(at(7).used.has("pc4_mux") && !at(7).used.has("btarget"), "not-taken beq uses PC+4");
assert.ok(j.has("jaddr") && j.has("pc4_hi") && !j.has("rd1") && !j.has("zero") && !j.has("c_ALUOp"));
assert.ok(!add.has("zero"), "Branch = 0 makes Zero irrelevant");
// Each catalogue example runs alone.
const solo = Object.fromEntries(CATALOG.map((e) => [e.name, step(catalogState(e), [e.line])]));
assert.equal(solo.addi.after.regs[11], 4, "7 + (-3)");
assert.ok(solo.addi.used.has("sext_mux") && !solo.addi.used.has("mem_rd"));
assert.equal(solo.slt.after.regs[11], 1, "signed: -2 < 5");
assert.equal(solo.and.after.regs[11], 8);
assert.equal(solo.or.after.regs[11], 14);
assert.equal(solo.lw.after.regs[11], 5);
assert.equal(solo.sw.after.mem[DATA_BASE + 8], 42);
assert.equal(solo.beq.after.pc, TEXT_BASE + 16);
assert.equal(solo.j.after.pc, TEXT_BASE + 0x40);
console.log("model ok:", trace.slice(0, 12).map((r) => r.line.asm).join(" | "));
