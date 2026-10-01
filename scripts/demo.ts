import { join } from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { getOrBuildPatternDb } from '../src/pdb/store.js';
import { AnalyzerService } from '../src/services/analyzer.js';

const dataDir = process.env.PCUBE_DATA_DIR ?? join(process.cwd(), 'data');
const pdb = getOrBuildPatternDb(dataDir);
const db = openDatabase(dataDir);
const svc = new AnalyzerService(db, pdb);

function title(t: string): void {
  console.log('\n=== ' + t + ' ===');
}

// 1. 固定种子生成局面
title('1) 固定种子打乱（seed=20261001，长度 8）');
const scr = svc.scramble(8, 20261001);
console.log('动作:', scr.text);
console.log('状态 cp:', scr.state.cp.join(','));
console.log('状态 co:', scr.state.co.join(','));
console.log('角块表:');
for (const c of svc.cornerTable(scr.state)) {
  console.log(
    `  位置 ${c.positionName.padEnd(4)} <- 角块 ${c.cubieName.padEnd(4)} 扭转=${c.orientation} ${c.home ? '(已归位)' : ''}`,
  );
}

// 2. 搜索最短复原
title('2) IDA* 最短复原');
const sol = svc.solve(scr.state, { nodeBudget: 5_000_000, timeBudgetMs: 15000 });
console.log('解法:', sol.solutionText || '(空序列，已是复原态)');
console.log(`长度=${sol.length} 最短性已证明=${sol.optimal}`);
console.log(`节点数=${sol.nodes} 深度界=[${sol.boundsTried.join(',')}] 最终界=${sol.finalBound}`);
console.log(`耗时=${sol.elapsedMs}ms 停止原因=${sol.stopReason} 初始启发=${sol.heuristicStart}`);

// 3. 逐步重放
title('3) 逐步重放复原过程');
const rep = svc.replay(sol.solutionText);
let cur = scr.state;
console.log('起始局面:', JSON.stringify(scr.state));
for (let i = 1; i < rep.steps.length; i++) {
  cur = svc.execute(cur, rep.steps[i]!.move).state;
  console.log(`  第${i}步 ${rep.steps[i]!.move.padEnd(3)} -> ${svc.isSolved(cur) ? '复原态' : '继续'}`);
}

// 4. 外部解法核验（给出首个问题）
title('4) 外部解法核验');
const good = svc.verify(scr.state, sol.solutionText);
console.log('正确解法核验:', good.solved ? '通过' : '失败');
const badSeq = sol.solutionText.replace(/^\S+/, 'R2');
const bad = svc.verify(scr.state, badSeq);
console.log(`错误解法 "${badSeq}" => solved=${bad.solved}`);
console.log('首个问题:', JSON.stringify(bad.issue));

// 5. 持久化与重启读取
title('5) 保存分析并按 ID 重新读取（模拟重启）');
const id = svc.saveAnalysis({
  state: scr.state,
  source: 'demo',
  scramble: scr.text,
  seed: 20261001,
  solve: sol,
  params: { nodeBudget: 5_000_000, timeBudgetMs: 15000 },
});
const db2 = openDatabase(dataDir);
const svc2 = new AnalyzerService(db2, pdb);
const loaded = svc2.loadAnalysis(id)!;
console.log(`记录 #${loaded.id}  scramble=${loaded.scramble}`);
console.log(`解法=${loaded.solution}  长度=${loaded.solutionLength}  最优=${loaded.optimal}`);
console.log(`节点=${loaded.nodes}  停止原因=${loaded.stopReason}  参数=${JSON.stringify(loaded.params)}`);

// 6. 小深度独立 BFS 验证
title('6) 独立 BFS 校验最短步数');
const bfs = svc.bfsVerify(scr.state, 8);
console.log(`BFS 精确最短距离=${bfs.distance}（枚举 ${bfs.visited} 个状态），与 IDA* 结果 ${bfs.distance === sol.length ? '一致' : '不一致'}`);

console.log('\n演示完成。');
