import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateFromScramble } from '../src/cube/state.js';
import { getOrBuildPatternDb } from '../src/pdb/store.js';
import { openDatabase } from '../src/db/database.js';
import { AnalyzerService } from '../src/services/analyzer.js';

const dataDir = process.env.PCUBE_TEST_DATA ?? join(process.cwd(), 'data');
const pdb = getOrBuildPatternDb(dataDir);
const db = openDatabase(mkdtempSync(join(tmpdir(), 'pcube-')));
const svc = new AnalyzerService(db, pdb);

test('复原态零步且已证明最优', () => {
  const r = svc.solve(svc.getSolved());
  assert.equal(r.length, 0);
  assert.equal(r.optimal, true);
  assert.equal(r.stopReason, 'solved_proven');
});

test('单步打乱解长为 1', () => {
  const s = stateFromScramble('R').state;
  const r = svc.solve(s);
  assert.equal(r.length, 1);
  assert.equal(r.optimal, true);
});

test('浅层不同打乱都被证明最短', () => {
  for (const seq of ['U', "R'", 'F2', 'R U', 'U R F', "R U R' F'", 'D L2 B']) {
    const s = stateFromScramble(seq).state;
    const r = svc.solve(s);
    assert.equal(r.optimal, true, seq);
    assert.equal(r.stopReason, 'solved_proven', seq);
    assert.ok(r.length <= seq.split(' ').length, seq);
    // 用解法回放必须真的复原
    assert.equal(svc.verify(s, r.solutionText).solved, true, seq);
  }
});

test('合法奇排列可解且最短', () => {
  const s = stateFromScramble('R').state;
  const r = svc.solve(s);
  assert.equal(r.optimal, true);
  assert.equal(r.length, 1);
});

test('节点预算终止：不宣称最短、也不宣称无解', () => {
  // 取一个较深局面，给极小节点预算
  const s = stateFromScramble(generateDeep()).state;
  const r = svc.solve(s, { nodeBudget: 3, timeBudgetMs: 60000 });
  assert.equal(r.stopReason, 'node_budget');
  assert.equal(r.optimal, false);
});

test('时间预算终止同样不宣称最短', () => {
  const s = stateFromScramble(generateDeep()).state;
  const r = svc.solve(s, { nodeBudget: 1e9, timeBudgetMs: 0 });
  assert.equal(r.stopReason, 'time_budget');
  assert.equal(r.optimal, false);
});

test('小深度独立 BFS 与求解器解长一致', () => {
  for (const seq of ['R', 'U F', "R U R'", 'L2 D', 'B R F']) {
    const s = stateFromScramble(seq).state;
    const sol = svc.solve(s);
    const bfs = svc.bfsVerify(s, 5);
    assert.notEqual(bfs.distance, -1, seq);
    assert.equal(bfs.distance, sol.length, seq);
  }
});

test('分析结果持久化并可重启后读取', () => {
  const s = stateFromScramble('R U F').state;
  const r = svc.solve(s);
  const id = svc.saveAnalysis({ state: s, source: 'test', scramble: 'R U F', solve: r, params: {} });
  const loaded = svc.loadAnalysis(id)!;
  assert.deepEqual(loaded.state, s);
  assert.equal(loaded.solution, r.solutionText);
  assert.equal(loaded.optimal, true);
});

function generateDeep(): string {
  // 14 个无同面相邻的动作，通常距离较深
  return "R U R' F' U F U' R2 F R U' R' U2 F";
}
