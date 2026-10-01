#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../db/database.js';
import { getOrBuildPatternDb, PDB_VERSION } from '../pdb/store.js';
import { AnalyzerService } from '../services/analyzer.js';
import { solvedState } from '../cube/moves.js';
import type { CubeState } from '../cube/types.js';

const dataDir = process.env.PCUBE_DATA_DIR ?? join(process.cwd(), 'data');

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function loadStateInput(svc: AnalyzerService): CubeState {
  const file = arg('file');
  const scramble = arg('scramble');
  if (file) {
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return svc.importState({ cp: obj.cp, co: obj.co });
  }
  if (scramble !== undefined) return svc.fromSolved(scramble).state;
  const cp = arg('cp');
  const co = arg('co');
  if (cp && co) {
    return svc.importState({ cp: cp.split(',').map(Number), co: co.split(',').map(Number) });
  }
  return solvedState();
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const db = openDatabase(dataDir);
  const pdb = getOrBuildPatternDb(dataDir);
  const svc = new AnalyzerService(db, pdb);

  switch (cmd) {
    case 'solved':
      return out({ state: svc.getSolved() });
    case 'validate': {
      const file = arg('file');
      const obj = file ? JSON.parse(readFileSync(file, 'utf8')) : { cp: arg('cp', '')!.split(',').map(Number), co: arg('co', '')!.split(',').map(Number) };
      return out(svc.validate(obj as CubeState));
    }
    case 'scramble': {
      const length = Number(arg('length', '12'));
      const seed = Number(arg('seed', '1'));
      const r = svc.scramble(length, seed);
      const id = svc.saveAnalysis({ state: r.state, source: 'cli-scramble', scramble: r.text, seed, params: { length, seed } });
      return out({ id, seed, length, sequence: r.text, state: r.state, corners: svc.cornerTable(r.state) });
    }
    case 'execute': {
      const state = loadStateInput(svc);
      const r = svc.execute(state, arg('sequence', '')!);
      return out({ state: r.state, sequence: r.moves.map((m) => m.name).join(' ') });
    }
    case 'from-solved': {
      const r = svc.fromSolved(arg('sequence', '')!);
      return out({ state: r.state, corners: svc.cornerTable(r.state) });
    }
    case 'solve': {
      const state = loadStateInput(svc);
      const params = {
        nodeBudget: arg('node-budget') ? Number(arg('node-budget')) : undefined,
        timeBudgetMs: arg('time-ms') ? Number(arg('time-ms')) : undefined,
        maxDepth: arg('max-depth') ? Number(arg('max-depth')) : undefined,
      };
      const result = svc.solve(state, params);
      const id = svc.saveAnalysis({
        state,
        source: 'cli-solve',
        scramble: arg('scramble') ?? null,
        solve: result,
        params: params as Record<string, unknown>,
      });
      const verify = result.solution.length
        ? svc.verify(state, result.solutionText)
        : { solved: svc.isSolved(state) };
      return out({ id, ...result, replayCheck: verify });
    }
    case 'replay':
      return out(svc.replay(arg('sequence', '')!));
    case 'verify': {
      const state = loadStateInput(svc);
      return out(svc.verify(state, arg('solution', '')!));
    }
    case 'inverse':
      return out(svc.inverse(arg('sequence', '')!));
    case 'bfs-verify': {
      const state = loadStateInput(svc);
      const r = svc.bfsVerify(state, Number(arg('max-depth', '5')));
      return out({ distance: r.distance, visited: r.visited, path: r.path.map((m) => m.name) });
    }
    case 'get': {
      const row = svc.loadAnalysis(Number(arg('id', '0')));
      if (!row) return out({ error: '未找到记录' });
      return out(row);
    }
    case 'list':
      return out({ analyses: svc.listAnalyses(Number(arg('limit', '50'))) });
    case 'pdb': {
      if (process.argv[3] === 'build') {
        const { buildPatternDbs } = await import('../pdb/pattern.js');
        const { savePatternDb, defaultPdbPath, PDB_VERSION } = await import('../pdb/store.js');
        const t0 = Date.now();
        const { distA, distB } = buildPatternDbs((label, done) =>
          process.stderr.write(`[pdb] 分区${label} ${done}\n`),
        );
        const path = defaultPdbPath(dataDir);
        savePatternDb(path, distA, distB);
        const v = PDB_VERSION as string;
        return out({ ok: true, path, version: v, elapsedMs: Date.now() - t0 });
      }
      if (process.argv[3] === 'info') {
        const { defaultPdbPath: dpath } = await import('../pdb/store.js');
        return out({ version: PDB_VERSION, path: dpath(dataDir) });
      }
      return out({ error: '用法: pdb build|info' });
    }
    default:
      return out({
        usage: [
          'solved | validate --file f.json | scramble --length 12 --seed 1',
          'from-solved --sequence "R U R2" | execute --scramble "R" --sequence "U"',
          'solve --scramble "R U F" [--node-budget N] [--time-ms N] [--max-depth N]',
          'replay --sequence "R U" | verify --scramble "R" --solution "R\'"',
          'inverse --sequence "R U2" | bfs-verify --scramble "R U" --max-depth 5',
          'get --id 1 | list --limit 20 | pdb build|info',
        ],
      });
  }
}

main().catch((e: unknown) => {
  out({ error: (e as Error).message });
  process.exitCode = 1;
});
