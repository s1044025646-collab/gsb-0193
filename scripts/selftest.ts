import { applyMove, ALL_MOVES, applySequence, parseSequence, inverseSequence, solvedState } from '../src/cube/moves.js';
import { isSolved, validateState, stateFromScramble } from '../src/cube/state.js';

let fails = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { fails++; console.error('FAIL', name); } else console.log('ok', name);
}

// 1) 任意动作四次四分之一转 / 两次半转回到原状态
for (const m of ALL_MOVES) {
  let s = solvedState();
  if (m.suffix === '2') {
    s = applyMove(applyMove(s, m), m);
  } else {
    for (let k = 0; k < 4; k++) s = applyMove(s, m);
  }
  check(`four/half identity ${m.name}`, isSolved(s));
}

// 2) 动作 + 逆动作回到原状态
for (const seq of ['R U F2 D\' L B\'', 'R R\'']) {
  const moves = parseSequence(seq);
  const s1 = applySequence(solvedState(), moves);
  const s2 = applySequence(s1, inverseSequence(moves));
  check(`inverse restores: ${seq}`, isSolved(s2));
}

// 3) R 之后 R' 复原
check('R then Rprime solved', isSolved(applyMove(stateFromScramble('R').state, parseSequence("R'")[0]!)));

// 4) 单角扭转非法，奇排列合法
const twist = solvedState();
twist.co[0] = 1;
check('single twist invalid', !validateState(twist).ok);

const odd = stateFromScramble('R').state; // 单次面转动是 4-循环 = 奇排列
check('R state valid (odd parity allowed)', validateState(odd).ok);

// 5) 重复角块报错
const dup = solvedState();
dup.cp[1] = 0; dup.cp[0] = 0;
const vr = validateState(dup);
check('duplicate cubie flagged', !vr.ok && vr.errors.some((e) => e.includes('重复')));

// 6) 越界朝向
const bad = solvedState();
bad.co[2] = 3;
check('orientation out of range', !validateState(bad).ok);

console.log(fails === 0 ? 'SELFTEST PASSED' : `SELFTEST FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
