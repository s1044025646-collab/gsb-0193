import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_MOVES,
  applyMove,
  applySequence,
  inverseSequence,
  parseMove,
  parseSequence,
  solvedState,
} from '../src/cube/moves.js';
import {
  isSolved,
  replay,
  stateFromScramble,
  validateState,
  verifySolution,
} from '../src/cube/state.js';
import { generateScramble } from '../src/cube/scramble.js';

test('复原态合法且被识别为已复原', () => {
  const s = solvedState();
  assert.equal(validateState(s).ok, true);
  assert.equal(isSolved(s), true);
});

test('任意四分之一转连续四次、半转连续两次回到原状态', () => {
  for (const m of ALL_MOVES) {
    let s = solvedState();
    const times = m.suffix === '2' ? 2 : 4;
    for (let k = 0; k < times; k++) s = applyMove(s, m);
    assert.deepEqual(s, solvedState(), m.name);
  }
});

test('动作与逆动作相互抵消', () => {
  for (const name of ['R', "R'", 'U2', 'F', "B'", 'L2']) {
    const m = parseMove(name);
    let s = applyMove(solvedState(), m);
    s = applySequence(s, inverseSequence([m]));
    assert.ok(isSolved(s), name);
  }
  const seq = parseSequence("R U R' F2 L'");
  assert.ok(isSolved(applySequence(applySequence(solvedState(), seq), inverseSequence(seq))));
});

test('整体旋转后的局面不被当作零步复原', () => {
  // y 型整体旋转在固定朝向模型下不是零动作；这里用具体转动改变局面。
  const s = stateFromScramble('R U R').state;
  assert.equal(isSolved(s), false);
});

test('奇排列（单个面转动=4循环）合法', () => {
  const s = stateFromScramble('R').state;
  assert.equal(validateState(s).ok, true);
  assert.equal(isSolved(s), false);
});

test('单角扭转非法并给出具体错误', () => {
  const s = solvedState();
  s.co[3] = 1;
  const r = validateState(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('扭转') || e.includes('3')));
});

test('重复角块与缺失角块报错', () => {
  const s = solvedState();
  s.cp[0] = 2;
  s.cp[1] = 2;
  const r = validateState(s);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('重复')));
  assert.ok(r.errors.some((e) => e.includes('缺失')));
});

test('越界朝向与越界角块编号报错', () => {
  const a = solvedState();
  a.co[0] = 5;
  assert.ok(validateState(a).errors.some((e) => e.includes('越界')));
  const b = solvedState();
  b.cp[0] = 9;
  assert.ok(validateState(b).errors.some((e) => e.includes('越界')));
});

test('非法动作符号报具体错误', () => {
  assert.throws(() => parseMove('X'), /非法符号/);
  assert.throws(() => parseMove('R3'), /非法符号/);
});

test('固定种子产生稳定打乱', () => {
  const a = generateScramble(15, 42);
  const b = generateScramble(15, 42);
  assert.equal(a.text, b.text);
  assert.notEqual(generateScramble(15, 43).text, a.text);
});

test('逐步重放长度与终局正确', () => {
  const r = replay('R U F');
  assert.equal(r.steps.length, 4);
  assert.deepEqual(r.steps[0]!.state, solvedState());
  assert.deepEqual(r.steps[3]!.state, stateFromScramble('R U F').state);
});

test('外部解法核验：正确通过、错误给出首个问题', () => {
  const s = stateFromScramble('R U').state;
  assert.equal(verifySolution(s, "U' R'").solved, true);
  const bad = verifySolution(s, 'R');
  assert.equal(bad.solved, false);
  assert.ok(bad.issue);
  const illegal = verifySolution(s, 'X');
  assert.equal(illegal.ok, false);
});
