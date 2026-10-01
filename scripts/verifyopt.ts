import { ALL_MOVES, applyMove, solvedState } from '../src/cube/moves.js';
import { stateKey } from '../src/cube/state.js';
import { getOrBuildPatternDb } from '../src/pdb/store.js';
import { openDatabase } from '../src/db/database.js';
import { AnalyzerService } from '../src/services/analyzer.js';

const pdb = getOrBuildPatternDb(process.cwd() + '/data');
const db = openDatabase(process.cwd() + '/data');
const svc = new AnalyzerService(db, pdb);

const dist = new Map<string, number>();
dist.set(stateKey(solvedState()), 0);
let frontier = [solvedState()];
const maxDepth = Number(process.argv[2] ?? 5);
let mismatches = 0;
let checked = 0;
for (let depth = 0; depth < maxDepth; depth++) {
  const nx: typeof frontier = [];
  for (const s of frontier) {
    for (const m of ALL_MOVES) {
      const c = applyMove(s, m);
      const k = stateKey(c);
      if (dist.has(k)) continue;
      dist.set(k, depth + 1);
      nx.push(c);
    }
  }
  // 对本层全部状态求解
  for (const s of nx) {
    const r = svc.solve(s, { nodeBudget: 5_000_000, timeBudgetMs: 30000 });
    checked++;
    if (!r.optimal || r.length !== depth + 1) {
      mismatches++;
      if (mismatches <= 10) console.log('MISMATCH exact=', depth + 1, 'got=', r.length, 'optimal=', r.optimal, JSON.stringify(s));
    }
  }
  console.log(`depth ${depth + 1}: ${nx.length} states checked`);
  frontier = nx;
}
console.log(`checked=${checked} mismatches=${mismatches}`);
process.exit(mismatches ? 1 : 0);
