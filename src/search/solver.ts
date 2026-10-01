import { ALL_MOVES, FACE_NAMES, FaceName, Move, SOLVED, CubieState } from "../cube/constants.js";
import { applyMove, isSolved, movesToNotation, validateState } from "../cube/state.js";
import { PatternDatabases, heuristic } from "./pdb.js";

const OPPOSITE: Record<FaceName, FaceName> = {
  U: "D",
  D: "U",
  F: "B",
  B: "F",
  L: "R",
  R: "L",
};

export type StopReason = "solved" | "node_budget" | "timeout" | "no_solution";

export interface SolveOptions {
  /** 允许扩展的最大节点数（含根节点）；达到即停止，不再宣称最优。 */
  maxNodes?: number;
  /** 墙钟超时（毫秒）。 */
  timeoutMs?: number;
}

export interface SolveResult {
  solvable: boolean;
  /** 是否在预算/时限内完成完整迭代并由此证明最短。 */
  provenOptimal: boolean;
  moves: Move[];
  notation: string;
  length: number;
  /** 最后一次（已完整执行的）迭代深度界。 */
  depthBound: number;
  nodesExpanded: number;
  heuristicRoot: number;
  elapsedMs: number;
  stopReason: StopReason;
  iterations: { bound: number; nodes: number }[];
}

export function solve(start: CubieState, pdbs: PatternDatabases, options: SolveOptions = {}): SolveResult {
  const t0 = Date.now();
  const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY;
  const timeoutMs = options.timeoutMs ?? Number.POSITIVE_INFINITY;
  const iterations: { bound: number; nodes: number }[] = [];

  const h0 = heuristic(pdbs, start);
  const path: Move[] = [];
  let found: Move[] | null = null;
  let stopReason: StopReason = "no_solution";
  let lastBound = 0;
  let nodes = 0;
  let aborted = false;

  function shouldStop(): "node_budget" | "timeout" | null {
    if (nodes >= maxNodes) return "node_budget";
    if (timeoutMs !== Number.POSITIVE_INFINITY && Date.now() - t0 >= timeoutMs) return "timeout";
    return null;
  }

  /**
   * @returns -2 找到解；-1 命中预算/时限；否则返回下一最小 f 界（Infinity 表示无后继）。
   */
  function dfs(state: CubieState, g: number, bound: number, prevFace: FaceName | null): number {
    const stop = shouldStop();
    if (stop) {
      stopReason = stop;
      aborted = true;
      return -1;
    }
    nodes++;
    const f = g + heuristic(pdbs, state);
    if (f > bound) return f;
    if (isSolved(state)) return -2;
    let nextBound = Number.POSITIVE_INFINITY;
    for (const move of ALL_MOVES) {
      if (move.face === prevFace) continue;
      const opp = prevFace === null ? null : OPPOSITE[prevFace];
      // 相邻、同轴向两个面：固定面序，去掉交换等价分支
      if (move.face === opp && FACE_NAMES.indexOf(move.face) < FACE_NAMES.indexOf(prevFace!)) continue;
      path.push(move);
      const r = dfs(applyMove(state, move), g + 1, bound, move.face);
      if (r === -2 || r === -1) return r;
      path.pop();
      if (r < nextBound) nextBound = r;
    }
    return nextBound;
  }

  if (isSolved(start)) {
    found = [];
    stopReason = "solved";
  } else {
    let bound = h0;
    while (found === null && !aborted) {
      lastBound = bound;
      const before = nodes;
      const r = dfs(start, 0, bound, null);
      iterations.push({ bound, nodes: nodes - before });
      if (r === -2) {
        found = [...path];
        stopReason = "solved";
        break;
      }
      if (r === -1) break; // 预算/时限；已完成的迭代仍证明了 >? 长度，下界用 lastBound
      if (r === Number.POSITIVE_INFINITY) {
        stopReason = "no_solution";
        break;
      }
      bound = r;
    }
  }

  const elapsedMs = Date.now() - t0;
  const moves = found ?? [];
  return {
    solvable: found !== null,
    provenOptimal: stopReason === "solved",
    moves,
    notation: movesToNotation(moves),
    length: moves.length,
    depthBound: lastBound,
    nodesExpanded: nodes,
    heuristicRoot: h0,
    elapsedMs,
    stopReason,
    iterations,
  };
}

export interface ReplayStep {
  step: number;
  move: string | null;
  state: { cp: number[]; co: number[] };
  solved: boolean;
}

/** 逐步重放：step=0 为初始局面，之后每施加一个动作产生一步。 */
export function replay(start: CubieState, moves: readonly Move[]): ReplayStep[] {
  const out: ReplayStep[] = [
    { step: 0, move: null, state: { cp: [...start.cp], co: [...start.co] }, solved: isSolved(start) },
  ];
  let cur = start;
  moves.forEach((m, i) => {
    cur = applyMove(cur, m);
    out.push({
      step: i + 1,
      move: m.notation,
      state: { cp: [...cur.cp], co: [...cur.co] },
      solved: isSolved(cur),
    });
  });
  return out;
}

export interface VerificationResult {
  valid: boolean;
  reachesSolved: boolean;
  length: number;
  firstErrorStep: number | null;
  firstError: string | null;
  finalState: { cp: number[]; co: number[] };
  replay: ReplayStep[];
}

/**
 * 外部解法核验：逐步执行给定序列并记录首个问题。
 * 动作记号本身无法解析、执行后出现非法局面、或最终未复原都会被报告。
 */
export function verifySolution(start: CubieState, moves: readonly Move[]): VerificationResult {
  const replaySteps = replay(start, moves);
  let firstErrorStep: number | null = null;
  let firstError: string | null = null;
  for (let i = 1; i < replaySteps.length; i++) {
    const s = replaySteps[i]!.state;
    const vr = validateState(s);
    if (!vr.valid) {
      firstErrorStep = i - 1;
      firstError = `第 ${i} 步(${replaySteps[i]!.move})后局面非法: ${vr.errors[0]}`;
      break;
    }
  }
  const final = replaySteps[replaySteps.length - 1]!;
  const reachesSolved = final.solved;
  if (firstError === null && !reachesSolved) {
    firstErrorStep = moves.length > 0 ? moves.length - 1 : null;
    firstError =
      moves.length === 0
        ? "初始局面并非复原态，空解法无法复原"
        : `执行完 ${moves.length} 个动作后仍未到达复原态（最终状态 ${final.state.cp.join("")}/${final.state.co.join("")}）`;
  }
  return {
    valid: firstError === null,
    reachesSolved,
    length: moves.length,
    firstErrorStep,
    firstError,
    finalState: final.state,
    replay: replaySteps,
  };
}

/**
 * 小深度独立广度优先枚举：不使用 PDB，直接在状态图上 BFS，
 * 用于与 IDA* 结果交叉验证最短步数。
 */
export function bfsOptimalLength(start: CubieState, maxDepth: number): {
  distance: number;
  reached: number;
} {
  if (isSolved(start)) return { distance: 0, reached: 1 };
  const key = (s: CubieState) => `${s.cp.join("")}${s.co.join("")}`;
  const seen = new Set<string>([key(start)]);
  let frontier: CubieState[] = [start];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    depth++;
    const next: CubieState[] = [];
    for (const s of frontier) {
      for (const m of ALL_MOVES) {
        const ns = applyMove(s, m);
        const k = key(ns);
        if (!seen.has(k)) {
          seen.add(k);
          if (isSolved(ns)) return { distance: depth, reached: seen.size };
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  return { distance: -1, reached: seen.size };
}

export { SOLVED };
