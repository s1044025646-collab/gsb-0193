import test from "node:test";
import assert from "node:assert/strict";
import { SOLVED, ALL_MOVES } from "../src/cube/constants.js";
import {
  applyMove,
  applyMoves,
  inverseMove,
  inverseSequence,
  parseMove,
  parseSequence,
  statesEqual,
  validateState,
  makeState,
  encodeState,
  decodeState,
  CubeError,
} from "../src/cube/state.js";
import { generateScramble } from "../src/cube/scramble.js";

test("复原态合法", () => {
  assert.equal(validateState(SOLVED).valid, true);
});

test("每个动作连续四次四分之一转（含半转展开）回到原状", () => {
  for (const move of ALL_MOVES) {
    const quarter = parseMove(move.face);
    let s = SOLVED;
    s = applyMove(s, quarter);
    s = applyMove(s, quarter);
    s = applyMove(s, quarter);
    s = applyMove(s, quarter);
    assert.ok(statesEqual(s, SOLVED), `${move.face} 四次顺转未复原`);
  }
});

test("动作与其逆动作复合回到原状", () => {
  for (const move of ALL_MOVES) {
    const s = applyMove(applyMove(SOLVED, move), inverseMove(move));
    assert.ok(statesEqual(s, SOLVED), `${move.notation} * 逆 未复原`);
  }
});

test("两个半转回到原状", () => {
  for (const move of ALL_MOVES.filter((m) => m.suffix === "2")) {
    const s = applyMove(applyMove(SOLVED, move), move);
    assert.ok(statesEqual(s, SOLVED), `${move.notation} 两次未复原`);
  }
});

test("半转等于两个四分之一转", () => {
  for (const face of ["U", "R", "F", "D", "L", "B"] as const) {
    const half = parseMove(`${face}2`);
    const q = parseMove(face);
    const a = applyMove(SOLVED, half);
    const b = applyMove(applyMove(SOLVED, q), q);
    assert.ok(statesEqual(a, b), `${face}2 与两次四分之一转不一致`);
  }
});

test("序列与其逆序列复合复原", () => {
  const seq = parseSequence("R U R' F2 U' L");
  const s = applyMoves(SOLVED, seq);
  const back = applyMoves(s, inverseSequence(seq));
  assert.ok(statesEqual(back, SOLVED));
});

test("解析器接受常见变体并拒绝非法记号", () => {
  assert.equal(parseMove("r2").notation, "R2");
  assert.equal(parseMove("r’").notation, "R'");
  assert.equal(parseMove("U").notation, "U");
  assert.throws(() => parseMove("X"), CubeError);
  assert.throws(() => parseMove("R3"), CubeError);
  assert.throws(() => parseMove("UU"), CubeError);
});

test("非法：重复角块 / 缺失角块", () => {
  const r = validateState({ cp: [0, 0, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("重复")));
  assert.ok(r.errors.some((e) => e.includes("缺少")));
});

test("非法：越界编号与越界朝向", () => {
  const r = validateState({ cp: [0, 1, 2, 3, 4, 5, 6, 9], co: [0, 0, 3, 0, 0, 0, 0, 0] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("越界")));
});

test("非法：单角扭转（朝向和不被 3 整除）", () => {
  const r = validateState({ cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(r.valid, false);
  assert.ok(r.errors[0]!.includes("不能被 3 整除"));
  assert.throws(() => makeState([0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 0, 0, 0, 0, 0, 0]), CubeError);
});

test("奇排列在二阶魔方合法（不要求偶排列）", () => {
  // 一个可由真实转动达到的奇排列局面
  const s = applyMoves(SOLVED, parseSequence("R U R'"));
  assert.equal(validateState(s).valid, true);
});

test("固定种子打乱确定性", () => {
  const a = generateScramble(123, 15).notation;
  const b = generateScramble(123, 15).notation;
  const c = generateScramble(124, 15).notation;
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("状态码编解码往返", () => {
  const s = applyMoves(SOLVED, parseSequence("F R U2"));
  const code = encodeState(s);
  assert.ok(statesEqual(decodeState(code), s));
});

test("整体旋转后的局面不被当作复原态", () => {
  // 用合法转动生成一个与复原态不同（即使角块仍按编号就位但有扭转/错位）的局面
  const s = applyMoves(SOLVED, parseSequence("R U R' U'"));
  assert.ok(!statesEqual(s, SOLVED));
  assert.equal(encodeState(s) === encodeState(SOLVED), false);
});
