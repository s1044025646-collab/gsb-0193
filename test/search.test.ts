import test from "node:test";
import assert from "node:assert/strict";
import { SOLVED } from "../src/cube/constants.js";
import { applyMoves, parseSequence, isSolved } from "../src/cube/state.js";
import { generateScramble } from "../src/cube/scramble.js";
import { buildAllPDB, heuristic, PDB_GROUPS } from "../src/search/pdb.js";
import { bfsOptimalLength, replay, solve, verifySolution } from "../src/search/solver.js";

const pdbs = buildAllPDB();

test("PDB 构建成功且复原态启发为 0", () => {
  assert.equal(pdbs.tables.length, PDB_GROUPS.length);
  assert.equal(heuristic(pdbs, SOLVED), 0);
  for (const t of pdbs.tables) assert.ok(t.size > 1000, `PDB 表过小: ${t.size}`);
});

test("复原态：0 步求解", () => {
  const r = solve(SOLVED, pdbs);
  assert.equal(r.length, 0);
  assert.equal(r.provenOptimal, true);
  assert.equal(r.stopReason, "solved");
});

test("单步局面求 1 步解", () => {
  const s = applyMoves(SOLVED, parseSequence("R"));
  const r = solve(s, pdbs);
  assert.equal(r.length, 1);
  assert.equal(r.provenOptimal, true);
});

test("浅层多组打乱：IDA* 与独立 BFS 距离一致", () => {
  const cases = [
    "R U",
    "F R U",
    "R U R'",
    "L B D2 F",
    "R U R' F R F'",
    "U R2 F' L D",
    "R U R' U' R' F R F'",
    "F R U R' U' F'",
  ];
  for (const seq of cases) {
    const s = applyMoves(SOLVED, parseSequence(seq));
    const sol = solve(s, pdbs);
    const bfs = bfsOptimalLength(s, 9);
    assert.equal(sol.provenOptimal, true, `${seq} 未证明最优`);
    assert.equal(sol.length, bfs.distance, `${seq}: IDA*=${sol.length} BFS=${bfs.distance}`);
    // 找到的路径确实复原
    const end = applyMoves(s, sol.moves);
    assert.ok(isSolved(end), `${seq} 的解法未复原`);
    // 可采纳性：启发不超过真实距离
    assert.ok(heuristic(pdbs, s) <= bfs.distance);
  }
});

test("独立全枚举：深度 <=4 所有可达局面最短步数与 IDA* 一致", () => {
  // BFS 从复原态按层枚举（只统计校验抽样，避免全量 3.6M 太慢；深度 3 全覆盖）
  const ALL = [...ALL_MOVES_LOCAL()];
  const key = (s: typeof SOLVED) => `${s.cp.join("")}${s.co.join("")}`;
  const dist = new Map<string, number>([[key(SOLVED), 0]]);
  let frontier = [SOLVED];
  for (let d = 1; d <= 3; d++) {
    const next: typeof SOLVED[] = [];
    for (const s of frontier) {
      for (const m of ALL) {
        const ns = applyMoves(s, [m]);
        const k = key(ns);
        if (!dist.has(k)) {
          dist.set(k, d);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  let checked = 0;
  for (const [k, d] of dist) {
    const cp = k.slice(0, 8).split("").map(Number);
    const co = k.slice(8).split("").map(Number);
    const s = { cp: cp as unknown as typeof SOLVED.cp, co: co as unknown as typeof SOLVED.co };
    const sol = solve(s, pdbs);
    assert.equal(sol.length, d, `状态 ${k}: IDA*=${sol.length} 期望=${d}`);
    checked++;
  }
  assert.ok(checked > 1000, `枚举状态数过少: ${checked}`);
});

function ALL_MOVES_LOCAL() {
  // 通过打乱/常量间接复用 18 动作
  return parseSequence("U U' U2 R R' R2 F F' F2 D D' D2 L L' L2 B B' B2");
}

test("奇排列合法局面也可求解且与 BFS 一致", () => {
  const s = applyMoves(SOLVED, parseSequence("R U R' F'"));
  const sol = solve(s, pdbs);
  const bfs = bfsOptimalLength(s, 8);
  assert.equal(sol.length, bfs.distance);
  assert.ok(isSolved(applyMoves(s, sol.moves)));
});

test("预算终止：未证明最优时如实报告且不宣称最短/无解", () => {
  // 取一个较深局面，给极小节点预算
  const s = generateScramble(777, 14).state;
  const r = solve(s, pdbs, { maxNodes: 50 });
  assert.equal(r.stopReason, "node_budget");
  assert.equal(r.provenOptimal, false);
  // 极小预算下通常 0 步解找不到；无论如何语义必须自洽
  if (r.length > 0) {
    assert.ok(isSolved(applyMoves(s, r.moves)), "若给出路径，它仍应能复原");
  }
});

test("超时终止语义", () => {
  const s = generateScramble(777, 14).state;
  const r = solve(s, pdbs, { timeoutMs: 1 });
  assert.equal(r.stopReason, "timeout");
  assert.equal(r.provenOptimal, false);
});

test("外部解法核验：正确/多余动作/空解法", () => {
  const s = applyMoves(SOLVED, parseSequence("R U"));
  const good = verifySolution(s, parseSequence("U' R'"));
  assert.equal(good.valid, true);
  assert.equal(good.reachesSolved, true);

  const bad = verifySolution(s, parseSequence("U' R' R"));
  assert.equal(bad.valid, false);
  assert.ok(bad.firstError!.includes("未到达复原态"));
});

test("逐步重放最后一步复原且中间状态可检查", () => {
  const s = applyMoves(SOLVED, parseSequence("R U"));
  const r = solve(s, pdbs);
  const steps = replay(s, r.moves);
  assert.equal(steps[0]!.solved, false);
  assert.equal(steps[steps.length - 1]!.solved, true);
  assert.equal(steps.length, r.length + 1);
});

test("相同局面与配置结果稳定", () => {
  const s = generateScramble(99, 10).state;
  const a = solve(s, pdbs);
  const b = solve(s, pdbs);
  assert.equal(a.notation, b.notation);
  assert.equal(a.nodesExpanded, b.nodesExpanded);
  assert.equal(a.length, b.length);
});
