import { AnalyzerService } from "../service.js";
import { generateScramble } from "../cube/scramble.js";
import { parseSequence, inverseSequence, movesToNotation } from "../cube/state.js";
import { loadConfig } from "../config.js";

function line(title: string): void {
  console.log(`\n===== ${title} =====`);
}

/** 端到端演示：生成局面 -> 求解 -> 逐步重放 -> 错误解法核验 -> 关闭后重启读取。 */
export function demo(svc: AnalyzerService): void {
  console.log(`数据目录: ${svc.config.dataDir}`);
  console.log(`PDB 指纹: ${svc.pdbs.fingerprint}（来源: ${svc.pdbInfo.source}, 构建耗时 ${svc.pdbInfo.buildMs}ms）`);

  line("1. 固定种子打乱生成局面 (seed=20261001, length=8)");
  const scr = svc.scramble(20261001, 8);
  console.log(`打乱动作: ${scr.notation}`);
  console.log("局面:", JSON.stringify(scr.state));
  const code = scr.state.code;

  line("2. IDA* 求最短复原");
  const sol = svc.solveCode(code, {});
  console.log(
    `解法: ${sol.notation}（${sol.length} 步，已证明最短=${sol.provenOptimal}，` +
      `停止原因=${sol.stopReason}，节点=${sol.nodesExpanded}，根启发=${sol.heuristicRoot}，耗时=${sol.elapsedMs}ms，界=${sol.depthBound}）`,
  );
  console.log("各轮迭代:", JSON.stringify(sol.iterations));
  const solutionId = sol.solutionId;

  line("3. 独立 BFS 交叉验证最短步数");
  const bfs = svc.bfsCheck(code, 8);
  console.log(`BFS 距离 = ${bfs.distance}，IDA* 长度 = ${sol.length}，一致=${bfs.distance === sol.length}`);

  line("4. 逐步重放求出的解法");
  const replay = svc.replayCode(code, sol.notation);
  for (const s of replay.steps) {
    console.log(
      `  step ${s.step}: ${s.move ?? "(起点)"} -> ${s.state.cp.join("")}/${s.state.co.join("")}${s.solved ? "  [复原]" : ""}`,
    );
  }

  line("5. 核验一条错误外部解法（报告首个问题）");
  const wrong = `${sol.notation} R`; // 多转一步，最终未复原
  const v1 = svc.verify(code, wrong);
  console.log(`候选: ${wrong}`);
  console.log(`  valid=${v1.valid} 首个问题(step=${v1.firstErrorStep}): ${v1.firstError}`);
  const v2 = svc.verify(code, "R R R R X");
  console.log(`含非法记号 "R R R R X": ${v2.firstError ?? v2.valid}`);

  line("6. 逆序列自检（打乱的逆序列应复原）");
  const inv = movesToNotation(inverseSequence(parseSequence(scr.notation)));
  const v3 = svc.verify(code, inv);
  console.log(`逆序列: ${inv} -> reachesSolved=${v3.reachesSolved}`);

  line("7. 模拟重启：新建服务实例后从 SQLite 读取同一分析结果");
  svc.close();
  const reopened = AnalyzerService.create(loadConfig());
  const row = reopened.store.getSolutionById(solutionId);
  console.log("重启后读取到的解法记录:", JSON.stringify(row, null, 2));
  reopened.close();

  line("8. 单角非法扭转（物理约束）");
  try {
    svc = AnalyzerService.create(loadConfig());
    svc.importState([0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 0, 0, 0, 0, 0, 0], null);
  } catch (e) {
    console.log(`按预期拒绝: ${(e as Error).message}`);
  }

  // 确定性自检：同种子打乱两次必须一致
  const a = generateScramble(42, 10).notation;
  const b = generateScramble(42, 10).notation;
  console.log(`\n确定性自检: ${a === b ? "通过" : "失败"}`);
}
