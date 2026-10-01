import type { CubeState, Move } from '../cube/types.js';
import { ALL_MOVES, applyMove, solvedState } from '../cube/moves.js';
import { isSolved, stateKey, validateState } from '../cube/state.js';

export interface BfsVerification {
  targetDepth: number;
  visited: number;
  exactDistance: number;
  matchesClaim: boolean;
  shortestPath: Move[];
}

// 从复原态正向枚举到 maxDepth（节点数随深度指数增长，仅供浅层独立校验）。
// 返回 target 在枚举树中的真实最短距离（若超出深度则为 -1）。
export function bfsExactDistance(
  target: CubeState,
  maxDepth: number,
  visitedLimit = 2_000_000,
): { distance: number; path: Move[]; visited: number } {
  validateState(target);
  const start = solvedState();
  if (isSolved(target)) return { distance: 0, path: [], visited: 1 };
  const prev = new Map<string, { parent: string; move: Move } | null>();
  prev.set(stateKey(start), null);
  let frontier: CubeState[] = [start];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next: CubeState[] = [];
    for (const cur of frontier) {
      for (const move of ALL_MOVES) {
        const child = applyMove(cur, move);
        const key = stateKey(child);
        if (prev.has(key)) continue;
        prev.set(key, { parent: stateKey(cur), move });
        if (stateKey(child) === stateKey(target)) {
          return { distance: depth + 1, path: reconstruct(prev, key), visited: prev.size };
        }
        next.push(child);
        if (prev.size > visitedLimit) {
          throw new Error(`BFS 枚举超过节点上限 ${visitedLimit}（深度 ${depth + 1}），请减小深度`);
        }
      }
    }
    frontier = next;
    depth++;
  }
  return { distance: -1, path: [], visited: prev.size };
}

function reconstruct(
  prev: Map<string, { parent: string; move: Move } | null>,
  key: string,
): Move[] {
  const moves: Move[] = [];
  let cur = key;
  while (true) {
    const node = prev.get(cur);
    if (!node) break;
    moves.push(node.move);
    cur = node.parent;
  }
  return moves.reverse();
}
