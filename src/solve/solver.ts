import type { CubeState, Move } from '../cube/types.js';
import { ALL_MOVES, applyMove } from '../cube/moves.js';
import { isSolved } from '../cube/state.js';
import type { PatternDb } from '../pdb/pattern.js';

export interface SolveParams {
  nodeBudget?: number; // 最大搜索节点数（默认 5_000_000）
  timeBudgetMs?: number; // 最大墙钟时间毫秒（默认 10_000）
  maxDepth?: number; // 硬深度上限（默认 20）
}

export type StopReason =
  | 'solved_proven' // 在最终界内找到解并完整搜索完该界 => 最短性已证明
  | 'node_budget' // 节点预算耗尽：可能已找到解，但尚未证明最短
  | 'time_budget' // 时间预算耗尽：可能已找到解，但尚未证明最短
  | 'depth_limit'; // 达到硬深度仍无证明

export interface SolveResult {
  solved: boolean;
  solution: Move[];
  solutionText: string;
  length: number;
  optimal: boolean; // 是否证明为最短
  nodes: number; // 展开的搜索节点数
  boundsTried: number[]; // 历次深度界
  finalBound: number;
  elapsedMs: number;
  stopReason: StopReason;
  heuristicStart: number;
}

// IDA*，启发式 h=max(两个可加模式库距离)。
// 可采纳性：每个模式库存的是该分区投影空间内到目标的真实最短距离，
// 任意完整解法在该投影上都构成一条等长路径，故真实最优长度 >= 每个库距离，
// 从而 h<=真实最优；IDA* 在不跳过任何状态的前提下不会漏掉最优解。
// 剪枝只去掉“相邻动作作用于同一面”的组合：同一面的转动彼此可交换，
// 任何含相邻同面动作的序列都可合并为至多一步，因而不可能是最短解的前缀。
export function solve(state: CubeState, pdb: PatternDb, params: SolveParams = {}): SolveResult {
  const nodeBudget = params.nodeBudget ?? 5_000_000;
  const timeBudgetMs = params.timeBudgetMs ?? 10_000;
  const maxDepth = params.maxDepth ?? 20;
  const started = Date.now();
  const deadline = started + timeBudgetMs;

  const h0 = pdb.heuristic(state);
  if (isSolved(state)) {
    return pack([], 0, [], h0, 0, 'solved_proven', true);
  }

  let nodes = 0;
  let stop: StopReason | null = null;
  const boundsTried: number[] = [];
  let best: Move[] | null = null;
  let bound = h0;

  while (bound <= maxDepth) {
    if (Date.now() >= deadline) {
      return pack(best ?? [], bound, boundsTried, h0, nodes, 'time_budget', false);
    }
    boundsTried.push(bound);
    const path: Move[] = [];
    const found = dfs(state, bound, 0, -1, path);
    if (found) {
      best = found.slice();
      // 本轮从根完整搜索到该界并找到解 => 该界即最短长度。
      return pack(best, bound, boundsTried, h0, nodes, 'solved_proven', true);
    }
    if (stop) {
      return pack(best ?? [], bound, boundsTried, h0, nodes, stop, false);
    }
    bound++;
  }
  return pack(best ?? [], bound, boundsTried, h0, nodes, 'depth_limit', false);

  function pack(
    solution: Move[],
    finalBound: number,
    bt: number[],
    hStart: number,
    n: number,
    reason: StopReason,
    optimal: boolean,
  ): SolveResult {
    return {
      solved: solution.length > 0 || isSolved(state),
      solution,
      solutionText: solution.map((m) => m.name).join(' '),
      length: solution.length,
      optimal,
      nodes: n,
      boundsTried: bt,
      finalBound,
      elapsedMs: Date.now() - started,
      stopReason: reason,
      heuristicStart: hStart,
    };
  }

  // 返回找到的解（动作数组）或 null。剪枝/预算时设置 stop。
  function dfs(cur: CubeState, bound: number, g: number, lastFaceIndex: number, path: Move[]): Move[] | null {
    nodes++;
    if (nodes > nodeBudget) {
      stop = 'node_budget';
      return null;
    }
    if ((nodes & 255) === 0 && Date.now() > deadline) {
      stop = 'time_budget';
      return null;
    }
    const h = pdb.heuristic(cur);
    if (g + h > bound) return null;
    if (isSolved(cur)) return path.slice();

    // 后继按 h 升序尝试，先找优质解（不影响完备性）。
    const candidates: { move: Move; next: CubeState; h: number }[] = [];
    for (const move of ALL_MOVES) {
      const fi = FACE_INDEX[move.face as string]!;
      if (fi === lastFaceIndex) continue; // 同面相邻动作不可能出现在最短解中
      const next = applyMove(cur, move);
      const nh = pdb.heuristic(next);
      if (g + 1 + nh > bound) continue; // f 界剪枝，可采纳保证不丢最优
      candidates.push({ move, next, h: nh });
    }
    candidates.sort((a, b) => a.h - b.h);
    for (const c of candidates) {
      path.push(c.move);
      const r = dfs(c.next, bound, g + 1, FACE_INDEX[c.move.face as string]!, path);
      if (r) return r;
      if (stop) return null;
      path.pop();
    }
    return null;
  }
}

const FACE_INDEX: Record<string, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
