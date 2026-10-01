import { Move, SOLVED } from "./cube/constants.js";
import {
  applyMoves,
  cornerTable,
  CubeError,
  decodeState,
  encodeState,
  makeState,
  movesToNotation,
  parseSequence,
} from "./cube/state.js";
import { generateScramble } from "./cube/scramble.js";
import { loadOrBuildPDB } from "./search/pdbManager.js";
import { PatternDatabases } from "./search/pdb.js";
import { bfsOptimalLength, replay, solve, SolveOptions, SolveResult, verifySolution } from "./search/solver.js";
import { Store } from "./db/store.js";
import { AppConfig } from "./config.js";

export interface PublicState {
  code: string;
  cp: number[];
  co: number[];
  corners: ReturnType<typeof cornerTable>;
  solved: boolean;
}

export function toPublic(state: Parameters<typeof encodeState>[0]): PublicState {
  const code = encodeState(state);
  const solved = code === "01234567/00000000";
  return { code, cp: [...state.cp], co: [...state.co], corners: cornerTable(state), solved };
}

export class AnalyzerService {
  readonly pdbs: PatternDatabases;
  readonly store: Store;
  readonly pdbInfo: { source: string; buildMs: number };

  constructor(
    readonly config: AppConfig,
    pdbLoad: ReturnType<typeof loadOrBuildPDB>,
  ) {
    this.pdbs = pdbLoad.pdbs;
    this.pdbInfo = { source: pdbLoad.source, buildMs: pdbLoad.buildMs };
    this.store = new Store(config.dbPath);
  }

  static create(config: AppConfig, forceRebuild = false): AnalyzerService {
    return new AnalyzerService(config, loadOrBuildPDB(config.pdbPath, forceRebuild));
  }

  scramble(seed: number, length: number) {
    const r = generateScramble(seed, length);
    const stateRow = this.store.upsertState(
      encodeState(r.state),
      r.state.cp.join(","),
      r.state.co.join(","),
      `scramble:${seed >>> 0}`,
      `scramble seed=${seed >>> 0} len=${length}`,
    );
    this.store.logAction(stateRow.id, "scramble", { seed: seed >>> 0, length, moves: r.notation });
    return {
      seed: seed >>> 0,
      length,
      moves: r.moves.map((m) => m.notation),
      notation: r.notation,
      state: toPublic(r.state),
      stateId: stateRow.id,
    };
  }

  importState(cp: number[], co: number[], label: string | null = null) {
    const state = makeState(cp, co);
    const row = this.store.upsertState(encodeState(state), cp.join(","), co.join(","), "import", label);
    this.store.logAction(row.id, "import", { cp, co });
    return { state: toPublic(state), stateId: row.id };
  }

  decode(code: string) {
    const state = decodeState(code);
    return { state: toPublic(state) };
  }

  execute(code: string, sequence: string) {
    let state = decodeState(code);
    let moves: Move[];
    try {
      moves = parseSequence(sequence);
    } catch (e) {
      if (e instanceof CubeError) throw e;
      throw e;
    }
    state = applyMoves(state, moves);
    // 动作执行结果也必须物理合法（合法局面经合法转动恒合法）
    const row = this.store.upsertState(
      encodeState(state),
      state.cp.join(","),
      state.co.join(","),
      `apply:${code}`,
      null,
    );
    this.store.logAction(row.id, "apply", { from: code, moves: sequence });
    return {
      input: sequence,
      parsed: moves.map((m) => m.notation),
      state: toPublic(state),
      stateId: row.id,
    };
  }

  solveCode(code: string, options: SolveOptions & { useCache?: boolean } = {}) {
    const state = decodeState(code);
    const stateRow = this.store.upsertState(
      code,
      state.cp.join(","),
      state.co.join(","),
      "solve",
      null,
    );
    const params = {
      maxNodes: options.maxNodes ?? null,
      timeoutMs: options.timeoutMs ?? null,
    };
    const paramsJson = JSON.stringify(params);
    const useCache = options.useCache !== false;
    if (useCache) {
      const cached = this.store.findSolution(stateRow.id, paramsJson, this.pdbs.fingerprint);
      if (cached) {
        return this.publicSolution(cached, true, code);
      }
    }
    const result: SolveResult = solve(state, this.pdbs, {
      maxNodes: options.maxNodes,
      timeoutMs: options.timeoutMs,
    });
    const saved = this.store.saveSolution({
      state_id: stateRow.id,
      notation: result.notation,
      length: result.length,
      proven_optimal: result.provenOptimal ? 1 : 0,
      stop_reason: result.stopReason,
      nodes_expanded: result.nodesExpanded,
      depth_bound: result.depthBound,
      heuristic_root: result.heuristicRoot,
      elapsed_ms: result.elapsedMs,
      iterations_json: JSON.stringify(result.iterations),
      params_json: paramsJson,
      pdb_fingerprint: this.pdbs.fingerprint,
    });
    this.store.logAction(stateRow.id, "solve", {
      notation: result.notation,
      stopReason: result.stopReason,
      provenOptimal: result.provenOptimal,
    });
    return this.publicSolution(saved, false, code, result);
  }

  private publicSolution(row: ReturnType<Store["getSolutionById"]>, fromCache: boolean, code: string, fresh?: SolveResult) {
    const result = fresh ?? {
      moves: parseSequence(row!.notation),
      iterations: JSON.parse(row!.iterations_json),
    };
    return {
      solutionId: row!.id,
      stateCode: code,
      fromCache,
      moves: result.moves.map((m) => m.notation),
      notation: row!.notation,
      length: row!.length,
      provenOptimal: row!.proven_optimal === 1,
      stopReason: row!.stop_reason,
      nodesExpanded: row!.nodes_expanded,
      depthBound: row!.depth_bound,
      heuristicRoot: row!.heuristic_root,
      elapsedMs: row!.elapsed_ms,
      iterations: typeof result.iterations === "string" ? JSON.parse(row!.iterations_json) : result.iterations,
      pdbFingerprint: row!.pdb_fingerprint,
      note:
        row!.stop_reason === "node_budget" || row!.stop_reason === "timeout"
          ? "达到预算/时限：尚未证明该路径最短，也不表示无解；请提高预算后重试。"
          : undefined,
    };
  }

  replayCode(code: string, sequence: string) {
    const state = decodeState(code);
    const moves = parseSequence(sequence);
    return { code, sequence: movesToNotation(moves), steps: replay(state, moves) };
  }

  verify(code: string, sequence: string) {
    const state = decodeState(code);
    try {
      const moves = parseSequence(sequence);
      const r = verifySolution(state, moves);
      return {
        code,
        candidate: movesToNotation(moves),
        valid: r.valid,
        reachesSolved: r.reachesSolved,
        length: r.length,
        firstErrorStep: r.firstErrorStep,
        firstError: r.firstError,
        finalState: r.finalState,
        steps: r.replay,
      };
    } catch (e) {
      if (e instanceof CubeError) {
        const tokens = sequence.trim().split(/\s+/);
        const idx = tokens.findIndex((t) => {
          try {
            parseSequence(t);
            return false;
          } catch {
            return true;
          }
        });
        return {
          code,
          candidate: sequence,
          valid: false,
          reachesSolved: false,
          length: tokens.length,
          firstErrorStep: idx,
          firstError: `第 ${idx + 1} 个动作记号无法解析: ${e.message}`,
          finalState: null,
          steps: [],
        };
      }
      throw e;
    }
  }

  bfsCheck(code: string, maxDepth = 6) {
    const state = decodeState(code);
    return bfsOptimalLength(state, maxDepth);
  }

  solvedState(): PublicState {
    return toPublic(SOLVED);
  }

  close(): void {
    this.store.close();
  }
}
