import type { DatabaseSync } from 'node:sqlite';
import type { CubeState, Move } from '../cube/types.js';
import {
  applySequence,
  inverseSequence,
  movesToString,
  parseSequence,
  solvedState,
} from '../cube/moves.js';
import {
  assertValid,
  cornerTable,
  isSolved,
  replay,
  stateFromScramble,
  validateState,
  verifySolution,
  type VerifyResult,
} from '../cube/state.js';
import { generateScramble } from '../cube/scramble.js';
import { solve, type SolveParams, type SolveResult } from '../solve/solver.js';
import { bfsExactDistance } from '../solve/bfs.js';
import type { PatternDb } from '../pdb/pattern.js';
import { getAnalysis, insertAnalysis, listAnalyses } from '../db/database.js';

export class AnalyzerService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly pdb: PatternDb,
  ) {}

  getSolved(): CubeState {
    return solvedState();
  }

  importState(input: { cp: number[]; co: number[] }): CubeState {
    const s: CubeState = { cp: input.cp.slice(), co: input.co.slice() };
    return assertValid(s);
  }

  scramble(length: number, seed: number): { state: CubeState; moves: Move[]; text: string } {
    const { moves, text } = generateScramble(length, seed);
    return { state: applySequence(solvedState(), moves), moves, text };
  }

  execute(state: CubeState, sequenceText: string): { state: CubeState; moves: Move[] } {
    assertValid(state);
    const moves = parseSequence(sequenceText);
    return { state: applySequence(state, moves), moves };
  }

  fromSolved(sequenceText: string): { state: CubeState; moves: Move[] } {
    return stateFromScramble(sequenceText);
  }

  solve(state: CubeState, params: SolveParams = {}): SolveResult {
    assertValid(state);
    return solve(state, this.pdb, params);
  }

  replay(sequenceText: string) {
    return replay(sequenceText);
  }

  verify(state: CubeState, solutionText: string): VerifyResult {
    return verifySolution(state, solutionText);
  }

  inverse(sequenceText: string): { inverse: Move[]; text: string } {
    const inv = inverseSequence(parseSequence(sequenceText));
    return { inverse: inv, text: movesToString(inv) };
  }

  validate(state: CubeState) {
    return validateState(state);
  }

  cornerTable(state: CubeState) {
    assertValid(state);
    return cornerTable(state);
  }

  isSolved(state: CubeState) {
    return isSolved(state);
  }

  bfsVerify(state: CubeState, maxDepth: number, visitedLimit?: number) {
    return bfsExactDistance(state, maxDepth, visitedLimit);
  }

  saveAnalysis(record: {
    state: CubeState;
    source: string;
    scramble?: string | null;
    seed?: number | null;
    solve?: SolveResult | null;
    params?: Record<string, unknown>;
  }): number {
    return insertAnalysis(this.db, {
      state_cp: record.state.cp.join(','),
      state_co: record.state.co.join(','),
      source: record.source,
      scramble: record.scramble ?? null,
      seed: record.seed ?? null,
      solution: record.solve ? record.solve.solutionText : null,
      solution_length: record.solve ? record.solve.length : null,
      optimal: record.solve ? (record.solve.optimal ? 1 : 0) : null,
      nodes: record.solve ? record.solve.nodes : null,
      bounds: record.solve ? JSON.stringify(record.solve.boundsTried) : null,
      final_bound: record.solve ? record.solve.finalBound : null,
      elapsed_ms: record.solve ? record.solve.elapsedMs : null,
      stop_reason: record.solve ? record.solve.stopReason : null,
      params_json: JSON.stringify(record.params ?? {}),
    });
  }

  loadAnalysis(id: number) {
    const row = getAnalysis(this.db, id);
    if (!row) return undefined;
    return hydrate(row);
  }

  listAnalyses(limit = 50) {
    return listAnalyses(this.db, limit).map(hydrate);
  }
}

function hydrate(row: ReturnType<typeof getAnalysis> & object) {
  const r = row as unknown as {
    id: number;
    state_cp: string;
    state_co: string;
    source: string;
    scramble: string | null;
    seed: number | null;
    solution: string | null;
    solution_length: number | null;
    optimal: number | null;
    nodes: number | null;
    bounds: string | null;
    final_bound: number | null;
    elapsed_ms: number | null;
    stop_reason: string | null;
    params_json: string;
    created_at: string;
  };
  return {
    id: r.id,
    state: { cp: r.state_cp.split(',').map(Number), co: r.state_co.split(',').map(Number) } as CubeState,
    source: r.source,
    scramble: r.scramble,
    seed: r.seed,
    solution: r.solution,
    solutionLength: r.solution_length,
    optimal: r.optimal === null ? null : r.optimal === 1,
    nodes: r.nodes,
    bounds: r.bounds ? (JSON.parse(r.bounds) as number[]) : null,
    finalBound: r.final_bound,
    elapsedMs: r.elapsed_ms,
    stopReason: r.stop_reason,
    params: JSON.parse(r.params_json),
    createdAt: r.created_at,
  };
}
