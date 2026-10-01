import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
// Node >=22.5 内置 SQLite（实验模块，Node 22/23+ 可直接使用）。
import { DatabaseSync } from 'node:sqlite';

export interface AnalysisRow {
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
}

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'pocketcube.db'));
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_cp TEXT NOT NULL,
      state_co TEXT NOT NULL,
      source TEXT NOT NULL,
      scramble TEXT,
      seed INTEGER,
      solution TEXT,
      solution_length INTEGER,
      optimal INTEGER,
      nodes INTEGER,
      bounds TEXT,
      final_bound INTEGER,
      elapsed_ms INTEGER,
      stop_reason TEXT,
      params_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function insertAnalysis(
  db: DatabaseSync,
  data: Omit<AnalysisRow, 'id' | 'created_at'>,
): number {
  const stmt = db.prepare(`
    INSERT INTO analyses
      (state_cp, state_co, source, scramble, seed, solution, solution_length,
       optimal, nodes, bounds, final_bound, elapsed_ms, stop_reason, params_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    data.state_cp,
    data.state_co,
    data.source,
    data.scramble,
    data.seed,
    data.solution,
    data.solution_length,
    data.optimal,
    data.nodes,
    data.bounds,
    data.final_bound,
    data.elapsed_ms,
    data.stop_reason,
    data.params_json,
  );
  return Number(res.lastInsertRowid);
}

export function getAnalysis(db: DatabaseSync, id: number): AnalysisRow | undefined {
  return db.prepare('SELECT * FROM analyses WHERE id=?').get(id) as AnalysisRow | undefined;
}

export function listAnalyses(db: DatabaseSync, limit = 50): AnalysisRow[] {
  return db
    .prepare('SELECT * FROM analyses ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as AnalysisRow[];
}
