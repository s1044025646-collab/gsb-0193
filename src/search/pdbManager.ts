import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  PatternDatabases,
  buildAllPDB,
  deserializePDB,
  pdbFingerprint,
  serializePDB,
} from "./pdb.js";

export interface PDBLoadInfo {
  pdbs: PatternDatabases;
  source: "cache" | "built";
  path: string;
  buildMs: number;
}

/**
 * 加载模式数据库：优先读取项目内缓存，指纹（由转动表内容派生）不匹配时重建。
 * 写入采用临时文件 + 原子改名，避免半截缓存。
 */
export function loadOrBuildPDB(cachePath: string, forceRebuild = false): PDBLoadInfo {
  if (!forceRebuild && existsSync(cachePath)) {
    try {
      const buf = readFileSync(cachePath);
      const pdbs = deserializePDB(buf);
      if (pdbs.fingerprint === pdbFingerprint()) {
        return { pdbs, source: "cache", path: cachePath, buildMs: 0 };
      }
    } catch {
      // 损坏/版本不符：落到重建
    }
  }
  const t0 = Date.now();
  const pdbs = buildAllPDB();
  const buildMs = Date.now() - t0;
  mkdirSync(dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp-${process.pid}`;
  writeFileSync(tmp, serializePDB(pdbs));
  renameSync(tmp, cachePath);
  return { pdbs, source: "built", path: cachePath, buildMs };
}
