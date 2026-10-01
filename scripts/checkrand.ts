import { ALL_MOVES, applySequence, parseSequence } from '../src/cube/moves.js';
import { getOrBuildPatternDb } from '../src/pdb/store.js';

const pdb = getOrBuildPatternDb(process.cwd() + '/data');
let bad = 0;
const { generateScramble } = await import('../src/cube/scramble.js');
const { solvedState } = await import('../src/cube/moves.js');
for (const len of [1, 2, 3, 4, 5, 6, 7, 8, 10, 14]) {
  let over = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const { moves } = generateScramble(len, seed * 7919 + len);
    const s = applySequence(solvedState(), moves);
    if (pdb.heuristic(s) > len) { over++; if (over <= 3) console.log('over len', len, pdb.heuristic(s), moves.map(m=>m.name).join(' '), JSON.stringify(s)); }
  }
  console.log('len', len, 'over', over);
  bad += over;
}
process.exit(bad ? 1 : 0);
