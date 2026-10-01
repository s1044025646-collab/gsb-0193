import type { CubeState, ValidationResult } from './types.js';
import { movesToString, parseSequence, applySequence, solvedState, cloneState } from './moves.js';

export const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];

export function isSolved(s: CubeState): boolean {
  for (let i = 0; i < 8; i++) {
    if (s.cp[i] !== i || s.co[i] !== 0) return false;
  }
  return true;
}

// 合法性检查：
//  1) 八个角块编号都在 0..7；
//  2) 每个角块恰好出现一次（无重复、无缺失）；
//  3) 所有扭转量都在 0..2；
//  4) 扭转量之和能被 3 整除（角块朝向的物理守恒约束）。
// 注意：二阶魔方不要求角块排列为偶排列，奇排列同样合法。
export function validateState(s: CubeState): ValidationResult {
  const errors: string[] = [];
  if (!s || !Array.isArray(s.cp) || !Array.isArray(s.co)) {
    return { ok: false, errors: ['状态必须包含长度为 8 的 cp 与 co 数组'] };
  }
  if (s.cp.length !== 8) errors.push(`cp 长度必须为 8，实际为 ${s.cp.length}`);
  if (s.co.length !== 8) errors.push(`co 长度必须为 8，实际为 ${s.co.length}`);

  const seen = new Array<boolean>(8).fill(false);
  for (let i = 0; i < s.cp.length && i < 8; i++) {
    const c: number | undefined = s.cp[i];
    if (c === undefined) continue;
    if (!Number.isInteger(c) || c < 0 || c > 7) {
      errors.push(`cp[${i}]=${String(c)} 越界，角块编号必须在 0..7`);
      continue;
    }
    if (seen[c]!) {
      errors.push(`角块 ${c} (${CORNER_NAMES[c]}) 重复出现于位置 ${i}`);
    }
    seen[c] = true;
  }
  for (let c = 0; c < 8; c++) {
    if (!seen[c] && s.cp.length === 8) errors.push(`角块 ${c} (${CORNER_NAMES[c]}) 缺失`);
  }

  let twistSum = 0;
  for (let i = 0; i < s.co.length && i < 8; i++) {
    const o: number | undefined = s.co[i];
    if (o === undefined) continue;
    if (!Number.isInteger(o) || o < 0 || o > 2) {
      errors.push(`co[${i}]=${String(o)} 越界，朝向必须在 0..2`);
      continue;
    }
    twistSum += o;
  }
  if (errors.length === 0 && twistSum % 3 !== 0) {
    errors.push(`角块朝向之和 ${twistSum} 不能被 3 整除，违反物理扭转守恒（单角扭转非法）`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertValid(s: CubeState): CubeState {
  const r = validateState(s);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return s;
}

// 紧凑键（合法状态唯一），用于缓存与去重。
export function stateKey(s: CubeState): string {
  return `${s.cp.join(',')}|${s.co.join(',')}`;
}

export function parseStateJson(text: string): CubeState {
  const obj = JSON.parse(text) as { cp?: unknown; co?: unknown };
  if (!Array.isArray(obj.cp) || !Array.isArray(obj.co)) {
    throw new Error('JSON 必须包含 cp 与 co 两个数组');
  }
  const s: CubeState = { cp: obj.cp.map(Number), co: obj.co.map(Number) };
  return assertValid(s);
}

// 从复原态施加转动序列生成局面。
export function stateFromScramble(sequenceText: string): { state: CubeState; moves: ReturnType<typeof parseSequence> } {
  const moves = parseSequence(sequenceText);
  return { state: applySequence(solvedState(), moves), moves };
}

export function cornerTable(s: CubeState) {
  return s.cp.map((cubie, pos) => ({
    position: pos,
    positionName: CORNER_NAMES[pos],
    cubie,
    cubieName: CORNER_NAMES[cubie] ?? '无效',
    orientation: s.co[pos],
    home: cubie === pos,
  }));
}

// 生成逐步重放记录（从复原态开始）。
export function replay(sequenceText: string) {
  const moves = parseSequence(sequenceText);
  const steps: { index: number; move: string; state: CubeState }[] = [];
  let cur = cloneState(solvedState());
  steps.push({ index: 0, move: '(初始)', state: cloneState(cur) });
  moves.forEach((m, i) => {
    cur = applySequence(cur, [m]);
    steps.push({ index: i + 1, move: m.name, state: cloneState(cur) });
  });
  return { sequence: movesToString(moves), steps };
}

// 外部解法核验：从给定局面按解法逐步执行，返回首个问题（若有）。
export interface VerifyResult {
  ok: boolean;
  solved: boolean;
  issue?: { step: number; move: string; message: string };
  finalState: CubeState;
  steps: number;
}

export function verifySolution(start: CubeState, solutionText: string): VerifyResult {
  const initial = validateState(start);
  if (!initial.ok) {
    return {
      ok: false,
      solved: false,
      issue: { step: 0, move: '(初始局面)', message: initial.errors.join('；') },
      finalState: start,
      steps: 0,
    };
  }
  let tokens: string[];
  try {
    tokens = solutionText.trim().split(/\s+/).filter(Boolean);
    // 提前解析以定位非法记号
    tokens.forEach((t) => parseSequence(t));
  } catch (e) {
    return {
      ok: false,
      solved: false,
      issue: { step: 0, move: '', message: (e as Error).message },
      finalState: start,
      steps: 0,
    };
  }
  let cur = cloneState(start);
  for (let i = 0; i < tokens.length; i++) {
    let m;
    try {
      m = parseSequence(tokens[i]!)[0]!;
    } catch (e) {
      return {
        ok: false,
        solved: false,
        issue: { step: i + 1, move: tokens[i]!, message: (e as Error).message },
        finalState: cur,
        steps: i,
      };
    }
    cur = applySequence(cur, [m]);
  }
  const solved = isSolved(cur);
  return {
    ok: true,
    solved,
    issue: solved
      ? undefined
      : { step: tokens.length, move: '(最终局面)', message: '执行完毕但未回到标准复原态' },
    finalState: cur,
    steps: tokens.length,
  };
}
