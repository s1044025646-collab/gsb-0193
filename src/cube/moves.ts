import type { CubeState, Face, Move, Suffix } from './types.js';

// 六个面“从该面正上方向下看为顺时针”的四分之一转
// （固定朝向，角块记号 URF/UFL/ULB/UBR/DFR/DLF/DBL/DRB）。
// cpNew[pos] = old.cp[cpTable[face][pos]]
// coNew[pos] = old.co[cpTable[face][pos]] + coTable[face][pos] (mod 3)
const CP: Record<Face, number[]> = {
  U: [3, 0, 1, 2, 4, 5, 6, 7],
  R: [4, 1, 2, 0, 7, 5, 6, 3],
  F: [1, 5, 2, 3, 0, 4, 6, 7],
  D: [0, 1, 2, 3, 5, 6, 7, 4],
  L: [0, 2, 6, 3, 4, 1, 5, 7],
  B: [0, 1, 3, 7, 4, 5, 2, 6],
};

const CO: Record<Face, number[]> = {
  U: [0, 0, 0, 0, 0, 0, 0, 0],
  R: [2, 0, 0, 1, 1, 0, 0, 2],
  F: [1, 2, 0, 0, 2, 1, 0, 0],
  D: [0, 0, 0, 0, 0, 0, 0, 0],
  B: [0, 0, 1, 2, 0, 0, 2, 1],
  L: [0, 1, 2, 0, 0, 2, 1, 0],
};

export const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

export function solvedState(): CubeState {
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };
}

export function cloneState(s: CubeState): CubeState {
  return { cp: s.cp.slice(), co: s.co.slice() };
}

// 对状态施加一次基础四分之一顺时针转动（内部使用）。
function quarterTurn(s: CubeState, face: Face): CubeState {
  const cp = CP[face];
  const co = CO[face];
  const nextCp = new Array<number>(8);
  const nextCo = new Array<number>(8);
  for (let pos = 0; pos < 8; pos++) {
    const src = cp[pos]!;
    nextCp[pos] = s.cp[src]!;
    nextCo[pos] = (s.co[src]! + co[pos]!) % 3;
  }
  return { cp: nextCp, co: nextCo };
}

export function applyMove(s: CubeState, move: Move): CubeState {
  let cur = s;
  for (let k = 0; k < move.quarterPower; k++) cur = quarterTurn(cur, move.face);
  return cur;
}

export function applySequence(state: CubeState, moves: Move[]): CubeState {
  let cur = state;
  for (const m of moves) cur = applyMove(cur, m);
  return cur;
}

// 逆转动：U <-> U'，U2 <-> U2。
export function inverseMove(m: Move): Move {
  if (m.suffix === '2') return m;
  return makeMove(m.face, m.suffix === '' ? "'" : '');
}

export function inverseSequence(moves: Move[]): Move[] {
  return moves.slice().reverse().map(inverseMove);
}

const SUFFIX_POWER: Record<Suffix, 1 | 3 | 2> = { '': 1, "'": 3, '2': 2 };

export function makeMove(face: Face, suffix: Suffix): Move {
  return { face, suffix, name: `${face}${suffix}`, quarterPower: SUFFIX_POWER[suffix] };
}

const FACE_SET = new Set<string>(FACES);
const VALID_NAMES = new Set<string>();
for (const f of FACES) for (const sx of ['', "'", '2'] as Suffix[]) VALID_NAMES.add(`${f}${sx}`);

export function isValidMoveName(token: string): boolean {
  return VALID_NAMES.has(token);
}

// 解析单个动作记号，如 R、R'、R2；非法时抛出带具体符号的错误。
export function parseMove(token: string): Move {
  const t = token.trim();
  if (t === '') throw new Error('空的动作记号');
  const face = t[0]!;
  if (!FACE_SET.has(face)) {
    throw new Error(`非法符号: "${token}"，首字符必须是 U/R/F/D/L/B 之一`);
  }
  let suffix: Suffix;
  const rest = t.slice(1);
  if (rest === '') suffix = '';
  else if (rest === "'") suffix = "'";
  else if (rest === '2') suffix = '2';
  else throw new Error(`非法符号: "${token}"，后缀只能是 '、2 或省略`);
  return makeMove(face as Face, suffix);
}

// 解析以空白分隔的动作序列。
export function parseSequence(text: string): Move[] {
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.map(parseMove);
}

export function movesToString(moves: Move[]): string {
  return moves.map((m) => m.name).join(' ');
}

export const ALL_MOVES: Move[] = (() => {
  const list: Move[] = [];
  for (const f of FACES) for (const sx of ['', "'", '2'] as Suffix[]) list.push(makeMove(f, sx));
  return list;
})();
