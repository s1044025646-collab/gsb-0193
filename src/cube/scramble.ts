import { ALL_MOVES, FACE_NAMES, FaceName, Move, SOLVED } from "./constants.js";
import { applyMoves } from "./state.js";

/** 可复现的 32 位伪随机数生成器（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPPOSITE: Record<FaceName, FaceName> = {
  U: "D",
  D: "U",
  F: "B",
  B: "F",
  L: "R",
  R: "L",
};

const MOVES_BY_FACE: Record<FaceName, Move[]> = Object.fromEntries(
  FACE_NAMES.map((f) => [f, ALL_MOVES.filter((m) => m.face === f)]),
) as Record<FaceName, Move[]>;

export interface ScrambleResult {
  seed: number;
  length: number;
  moves: Move[];
  notation: string;
  state: ReturnType<typeof applyMoves>;
}

/**
 * 固定种子打乱：生成 length 个动作。
 * 相邻动作不同面，且不与前一动作的对面相邻（HTM 标准去冗余），
 * 保证同一种子与长度产生完全一致的结果。
 */
export function generateScramble(seed: number, length: number): ScrambleResult {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`打乱长度必须为非负整数，实际 ${length}`);
  }
  const rand = mulberry32(seed >>> 0);
  const moves: Move[] = [];
  let prevFace: FaceName | null = null;
  let prevOpp: FaceName | null = null;
  for (let i = 0; i < length; i++) {
    const candidates = FACE_NAMES.filter((f) => f !== prevFace && f !== prevOpp);
    const face = candidates[Math.floor(rand() * candidates.length)]!;
    const faceMoves = MOVES_BY_FACE[face];
    const move = faceMoves[Math.floor(rand() * faceMoves.length)]!;
    moves.push(move);
    prevFace = face;
    prevOpp = OPPOSITE[face];
  }
  const state = applyMoves(SOLVED, moves);
  return {
    seed: seed >>> 0,
    length,
    moves,
    notation: moves.map((m) => m.notation).join(" "),
    state,
  };
}
