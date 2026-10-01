import type { Move } from './types.js';
import { FACES, makeMove, movesToString } from './moves.js';
import type { Suffix } from './types.js';

// mulberry32：确定性 32 位伪随机，固定种子 => 固定打乱序列。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUFFIXES: Suffix[] = ['', "'", '2'];

// 生成不与上一步同面的随机动作（保证记号层面合法且可重放）。
export function generateScramble(length: number, seed: number): { moves: Move[]; text: string } {
  if (!Number.isInteger(length) || length < 0 || length > 1000) {
    throw new Error('打乱长度必须是 0..1000 的整数');
  }
  const rnd = mulberry32(seed);
  const moves: Move[] = [];
  let lastFace = -1;
  for (let i = 0; i < length; i++) {
    let fi: number;
    do {
      fi = Math.floor(rnd() * 6);
    } while (fi === lastFace);
    lastFace = fi;
    const sx = SUFFIXES[Math.floor(rnd() * 3)]!;
    moves.push(makeMove(FACES[fi]!, sx));
  }
  return { moves, text: movesToString(moves) };
}
