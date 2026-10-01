import { createHash } from "node:crypto";
import {
  ALL_MOVES,
  CornerPerm,
  CornerOri,
  CubieState,
  MOVE_CO,
  MOVE_CP,
  Move,
  SOLVED,
} from "../cube/constants.js";
import { applyMove, applyMoves } from "../cube/state.js";

export const PDB_ALGO_VERSION = "pdb-2x2-corner-v2";

/** 两个不相交的四角块子集（顶层四角 / 底层四角）。 */
export const PDB_GROUPS: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
];

/** 基于转动表内容计算稳定版本指纹，转动约定一变即失效。 */
export function pdbFingerprint(): string {
  const h = createHash("sha256");
  h.update(PDB_ALGO_VERSION);
  h.update(JSON.stringify(MOVE_CP));
  h.update(JSON.stringify(MOVE_CO));
  h.update(JSON.stringify(PDB_GROUPS));
  return h.digest("hex").slice(0, 16);
}

// 抽象状态：被追踪角块保留编号 0..7 与真实朝向；其余 4 个角块一律用
// “哑角块”编号 8 表示（4 份可区分副本，分布在被追踪组之外的位置）。
// 哑角块也参与全部转动，因此投影对所有面转动闭合，BFS 不会漏状态。

function project(state: CubieState, group: readonly number[]): CubieState {
  const cp = state.cp.map((c) => (group.includes(c) ? c : 8));
  const co = state.co.map((o, i) => (group.includes(state.cp[i]!) ? o : 0));
  return { cp: cp as unknown as CornerPerm, co: co as unknown as CornerOri };
}

// 编码：8 槽，每槽 9 种编号(0..8)，再乘 3^8 朝向。
// 实际可达状态数 = 8P4 * 3^4 = 136080，远小于编码空间，故 BFS 用 Map 存储。
function encode(state: CubieState): number {
  let permCode = 0;
  for (let i = 0; i < 8; i++) permCode = permCode * 9 + state.cp[i]!;
  let oriCode = 0;
  for (let i = 0; i < 8; i++) oriCode = oriCode * 3 + state.co[i]!;
  return permCode * 6561 + oriCode;
}

export interface PDB {
  groupIndex: number;
  fingerprint: string;
  /** 抽象状态编码 -> 距复原态的精确步数（半转计 1 步）。 */
  dist: Map<number, number>;
  size: number;
}

/** 以复原态投影为根，对单个角块子集做全广度优先枚举，得到精确距离表。 */
export function buildGroupPDB(groupIndex: number): PDB {
  const group = PDB_GROUPS[groupIndex]!;
  const root = project(SOLVED, group);
  const rootCode = encode(root);
  const dist = new Map<number, number>([[rootCode, 0]]);
  let frontier: CubieState[] = [root];
  let depth = 0;
  // 抽象转移：真实角块正常计算朝向；哑角块(编号 8)的扭转不可观测，统一归零，
  // 从而保证投影对任意面转动闭合。
  const abstractMove = (s: CubieState, move: Move): CubieState => {
    const ns = applyMove(s, move);
    const co = ns.co.map((o, i) => (ns.cp[i] === 8 ? 0 : o)) as unknown as CornerOri;
    return { cp: ns.cp, co };
  };
  while (frontier.length > 0) {
    depth++;
    const next: CubieState[] = [];
    for (const s of frontier) {
      for (const move of ALL_MOVES) {
        const ns = abstractMove(s, move);
        const code = encode(ns);
        if (!dist.has(code)) {
          dist.set(code, depth);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  return { groupIndex, fingerprint: pdbFingerprint(), dist, size: dist.size };
}

export interface PatternDatabases {
  fingerprint: string;
  tables: PDB[];
}

export function buildAllPDB(): PatternDatabases {
  const tables = PDB_GROUPS.map((_, i) => buildGroupPDB(i));
  return { fingerprint: pdbFingerprint(), tables };
}

/** 组合启发：两个子问题各自所需步数的最大值，为可采纳下界。 */
export function heuristic(pdbs: PatternDatabases, state: CubieState): number {
  let h = 0;
  for (let g = 0; g < PDB_GROUPS.length; g++) {
    const code = encode(project(state, PDB_GROUPS[g]!));
    const d = pdbs.tables[g]!.dist.get(code);
    if (d === undefined) throw new Error("模式数据库缺少状态条目（数据库损坏或版本不符）");
    if (d > h) h = d;
  }
  return h;
}

// 序列化：Map<number,number> 以定宽文本条目(key + dist1)紧凑存储。
// key 上界 9^8 * 3^8 - 1 = 3,026,697,260,640（13 位），故键宽取 13。
const KEY_DIGITS = 13;

export function serializePDB(pdbs: PatternDatabases): Buffer {
  const meta = Buffer.from(
    JSON.stringify({ magic: PDB_ALGO_VERSION, fp: pdbs.fingerprint }) + "\n",
    "utf8",
  );
  const parts: Buffer[] = [meta];
  for (const t of pdbs.tables) {
    const header = Buffer.from(JSON.stringify({ g: t.groupIndex, size: t.size }) + "\n", "utf8");
    parts.push(header);
    const body = Buffer.alloc(t.size * (KEY_DIGITS + 1));
    let off = 0;
    const sortedKeys = [...t.dist.keys()].sort((a, b) => a - b);
    for (const k of sortedKeys) {
      const d = t.dist.get(k)!;
      body.write(k.toString().padStart(KEY_DIGITS, "0"), off, "ascii");
      body.write(String(d), off + KEY_DIGITS, "ascii");
      off += KEY_DIGITS + 1;
    }
    parts.push(body);
  }
  return Buffer.concat(parts);
}

export function deserializePDB(buf: Buffer): PatternDatabases {
  let off = 0;
  const nl1 = buf.indexOf(0x0a, off);
  const meta = JSON.parse(buf.subarray(off, nl1).toString("utf8")) as {
    magic: string;
    fp: string;
  };
  if (meta.magic !== PDB_ALGO_VERSION) throw new Error("模式数据库版本不匹配");
  if (meta.fp !== pdbFingerprint()) throw new Error("模式数据库指纹不匹配（转动约定已变更），请重新构建");
  off = nl1 + 1;
  const tables: PDB[] = [];
  for (let g = 0; g < PDB_GROUPS.length; g++) {
    const nl = buf.indexOf(0x0a, off);
    const header = JSON.parse(buf.subarray(off, nl).toString("utf8")) as { g: number; size: number };
    off = nl + 1;
    const dist = new Map<number, number>();
    for (let i = 0; i < header.size; i++) {
      const key = Number(buf.subarray(off, off + KEY_DIGITS).toString("ascii"));
      const d = Number(buf.subarray(off + KEY_DIGITS, off + KEY_DIGITS + 1).toString("ascii"));
      dist.set(key, d);
      off += KEY_DIGITS + 1;
    }
    tables.push({ groupIndex: header.g, fingerprint: meta.fp, dist, size: header.size });
  }
  return { fingerprint: meta.fp, tables };
}

// 供外部一致性测试使用
export const _stateHelpers = { applyMove, applyMoves };
