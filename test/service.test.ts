import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function rmrfRetry(path: string, tries = 5): void {
  for (let i = 0; i < tries; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EPERM" && (e as NodeJS.ErrnoException).code !== "EBUSY") throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (i + 1));
    }
  }
}
import { AnalyzerService } from "../src/service.js";
import { loadConfig } from "../src/config.js";

function freshService() {
  const dir = mkdtempSync(join(tmpdir(), "pocketcube-test-"));
  const config = loadConfig({ POCKETCUBE_DATA_DIR: dir }, process.cwd());
  const svc = AnalyzerService.create(config);
  return { dir, config, svc };
}

test("端到端：打乱 -> 求解 -> 缓存 -> 关闭重开读取同一结果", () => {
  const { dir, config, svc } = freshService();
  try {
    const scr = svc.scramble(555, 7);
    const sol1 = svc.solveCode(scr.state.code, { maxNodes: 100000 });
    assert.equal(sol1.provenOptimal, true);
    assert.equal(sol1.fromCache, false);

    const sol2 = svc.solveCode(scr.state.code, { maxNodes: 100000 });
    assert.equal(sol2.fromCache, true);
    assert.equal(sol2.notation, sol1.notation);
    const id = sol1.solutionId;
    svc.close();

    const reopened = AnalyzerService.create(config);
    const row = reopened.store.getSolutionById(id);
    assert.ok(row);
    assert.equal(row!.notation, sol1.notation);
    assert.equal(row!.proven_optimal, 1);
    // 不同参数不串缓存
    const other = reopened.solveCode(scr.state.code, { maxNodes: 100001 });
    assert.equal(other.fromCache, false);
    reopened.close();
  } finally {
    svc.close();
    rmrfRetry(dir);
  }
});

test("PDB 缓存二次加载来自 cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "pocketcube-pdb-"));
  const config = loadConfig({ POCKETCUBE_DATA_DIR: dir }, process.cwd());
  try {
    const first = AnalyzerService.create(config);
    assert.equal(first.pdbInfo.source, "built");
    first.close();
    const second = AnalyzerService.create(config);
    assert.equal(second.pdbInfo.source, "cache");
    second.close();
  } finally {
    rmrfRetry(dir);
  }
});

test("导入非法局面返回 CubeError", () => {
  const { dir, svc } = freshService();
  try {
    assert.throws(
      () => svc.importState([0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 0, 0, 0, 0, 0, 0], null),
      /不能被 3 整除/,
    );
  } finally {
    svc.close();
    rmrfRetry(dir);
  }
});

test("verify API 能指出错误解法的首个问题", () => {
  const { dir, svc } = freshService();
  try {
    const scr = svc.scramble(8, 5);
    const sol = svc.solveCode(scr.state.code, {});
    const wrong = svc.verify(scr.state.code, `${sol.notation} U`);
    assert.equal(wrong.valid, false);
    assert.ok(wrong.firstError!.includes("未到达复原态"));
  } finally {
    svc.close();
    rmrfRetry(dir);
  }
});
