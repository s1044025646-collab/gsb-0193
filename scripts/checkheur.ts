import { ALL_MOVES, applyMove, solvedState } from '../src/cube/moves.js';
import { isSolved, stateKey } from '../src/cube/state.js';
import { getOrBuildPatternDb } from '../src/pdb/store.js';

const pdb = getOrBuildPatternDb(process.cwd() + '/data');
// 对深度 0..6 做正向 BFS，比较启发值 h 与真实距离 d。
const dist = new Map<string, number>();
dist.set(stateKey(solvedState()), 0);
let frontier = [solvedState()];
let depth = 0;
let bad = 0;
const hAtDepth: Record<number, number[]> = {};
while (frontier.length && depth < 6) {
  const nx: typeof frontier = [];
  for (const s of frontier) {
    for (const m of ALL_MOVES) {
      const c = applyMove(s, m);
      const k = stateKey(c);
      if (dist.has(k)) continue;
      dist.set(k, depth + 1);
      nx.push(c);
      const h = pdb.heuristic(c);
      (hAtDepth[depth + 1] ??= []).push(h);
      if (!(h <= depth + 1)) { bad++; if (bad <= 5) console.log('VIOL d=', depth + 1, 'h=', h, JSON.stringify(c)); }
    }
  }
  frontier = nx;
  depth++;
}
for (const d of Object.keys(hAtDepth).map(Number).sort((a, b) => a - b)) {
  const arr = hAtDepth[d]!;
  console.log(`depth=${d} states=${arr.length} hMin=${Math.min(...arr)} hMax=${Math.max(...arr)}`);
}
console.log('admissibility violations:', bad, 'total visited:', dist.size);
process.exit(bad ? 1 : 0);
