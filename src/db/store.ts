import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface StoredState {
  id: number;
  code: string;
  cp: string;
  co: string;
  source: string;
  label: string | null;
  created_at: string;
}

export interface StoredSolution {
  id: number;
  state_id: number;
  notation: string;
  length: number;
  proven_optimal: number;
  stop_reason: string;
  nodes_expanded: number;
  depth_bound: number;
  heuristic_root: number;
  elapsed_ms: number;
  iterations_json: string;
  params_json: string;
  pdb_fingerprint: string;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        cp TEXT NOT NULL,
        co TEXT NOT NULL,
        source TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS solutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id INTEGER NOT NULL REFERENCES states(id),
        notation TEXT NOT NULL,
        length INTEGER NOT NULL,
        proven_optimal INTEGER NOT NULL,
        stop_reason TEXT NOT NULL,
        nodes_expanded INTEGER NOT NULL,
        depth_bound INTEGER NOT NULL,
        heuristic_root INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        iterations_json TEXT NOT NULL,
        params_json TEXT NOT NULL,
        pdb_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_id INTEGER REFERENCES states(id),
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
  }

 upsertState(code: string, cp: string, co: string, source: string, label: string | null): StoredState {
    this.db
      .prepare(
        `INSERT INTO states(code, cp, co, source, label) VALUES (?,?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET source=excluded.source, label=COALESCE(excluded.label, states.label)`,
      )
      .run(code, cp, co, source, label);
    return this.getStateByCode(code)!;
  }

  getStateByCode(code: string): StoredState | null {
    return (this.db.prepare(`SELECT * FROM states WHERE code = ?`).get(code) as unknown as StoredState | undefined) ?? null;
  }

  getStateById(id: number): StoredState | null {
    return (this.db.prepare(`SELECT * FROM states WHERE id = ?`).get(id) as unknown as StoredState | undefined) ?? null;
  }

  listStates(limit = 100): StoredState[] {
    return this.db.prepare(`SELECT * FROM states ORDER BY id DESC LIMIT ?`).all(limit) as unknown as StoredState[];
  }

  saveSolution(row: Omit<StoredSolution, "id" | "created_at">): StoredSolution {
    const info = this.db
      .prepare(
        `INSERT INTO solutions
         (state_id, notation, length, proven_optimal, stop_reason, nodes_expanded,
          depth_bound, heuristic_root, elapsed_ms, iterations_json, params_json, pdb_fingerprint)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.state_id,
        row.notation,
        row.length,
        row.proven_optimal,
        row.stop_reason,
        row.nodes_expanded,
        row.depth_bound,
        row.heuristic_root,
        row.elapsed_ms,
        row.iterations_json,
        row.params_json,
        row.pdb_fingerprint,
      );
    return this.db.prepare(`SELECT * FROM solutions WHERE id = ?`).get(Number(info.lastInsertRowid)) as unknown as StoredSolution;
  }

  /** 相同局面 + 相同参数 + 相同 PDB 指纹的已存解法（稳定缓存）。 */
  findSolution(stateId: number, paramsJson: string, fingerprint: string): StoredSolution | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM solutions WHERE state_id=? AND params_json=? AND pdb_fingerprint=?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(stateId, paramsJson, fingerprint) as unknown as StoredSolution | undefined) ?? null
    );
  }

  getSolutionById(id: number): StoredSolution | null {
    return (this.db.prepare(`SELECT * FROM solutions WHERE id = ?`).get(id) as unknown as StoredSolution | undefined) ?? null;
  }

  listSolutions(limit = 100): StoredSolution[] {
    return this.db.prepare(`SELECT * FROM solutions ORDER BY id DESC LIMIT ?`).all(limit) as unknown as StoredSolution[];
  }

  logAction(stateId: number | null, kind: string, payload: unknown): void {
    this.db
      .prepare(`INSERT INTO action_logs(state_id, kind, payload_json) VALUES (?,?,?)`)
      .run(stateId, kind, JSON.stringify(payload));
  }

  close(): void {
    try {
      this.db.close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ERR_INVALID_STATE") throw e;
    }
  }
}
