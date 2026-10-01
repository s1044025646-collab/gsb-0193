import type { CubeState, Face } from '../cube/types.js';
import { ALL_MOVES } from '../cube/moves.js';

// 两个互不相交的角块分区，各自构成一个可加（加法）模式库。
export const PARTITION_A = [0, 1, 2, 3]; // URF UFL ULB UBR
export const PARTITION_B = [4, 5, 6, 7]; // DFR DLF DBL DRB

export const PERM_COUNT = 8 * 7 * 6 * 5; // 6720
export const ORI_COUNT = 3 ** 4; // 81
export const ABSTRACT_COUNT = PERM_COUNT * ORI_COUNT; // 544320（可达到约 242k）
export const UNREACHED = 255;

// 抽象状态：分区四个位置上出现的“本区角块”的有序排列 + 各自朝向。
// 非本区角块一律记为占位 -1；在单个模式库内只需追踪本区四个角块。
export interface AbstractState {
  occ: Int8Array; // 长度 8，该位置是否为“已追踪角块”，是则存其编号 0..7，否则 -1
  ori: Int8Array; // 长度 8，已追踪位置的朝向，未追踪为 0
}

export function project(state: CubeState, partition: number[]): AbstractState {
  const member = new Uint8Array(8);
  partition.forEach((c) => (member[c] = 1));
  const occ = new Int8Array(8).fill(-1);
  const ori = new Int8Array(8);
  for (let pos = 0; pos < 8; pos++) {
    const c = state.cp[pos]!;
    if (member[c]) {
      occ[pos] = c;
      ori[pos] = state.co[pos]!;
    }
  }
  return { occ, ori };
}

// Lehmann-like 下降阶乘编码排列，base-3 编码四个朝向。
export function rankAbstract(a: AbstractState, partition: number[]): number {
  const trackedPositions: number[] = [];
  for (let pos = 0; pos < 8; pos++) if (a.occ[pos] !== -1) trackedPositions.push(pos);
  // 排列秩：四个被追踪角块（按分区编号顺序）当前所在位置的有序排列
  let permRank = 0;
  const placed: number[] = [];
  for (let k = 0; k < 4; k++) {
    const cubie = partition[k]!;
    let posOf = -1;
    for (let p = 0; p < 8; p++) if (a.occ[p] === cubie) posOf = p;
    let smaller = 0;
    for (const q of placed) if (q < posOf) smaller++;
    const avail = posOf - smaller;
    permRank = permRank * (8 - k) + avail;
    placed.push(posOf);
  }
  let oriRank = 0;
  for (const pos of trackedPositions) oriRank = oriRank * 3 + a.ori[pos]!;
  return permRank * ORI_COUNT + oriRank;
}

// 从完整状态直接计算两个模式库的距离（查表）。
export class PatternDb {
  constructor(
    readonly distA: Uint8Array,
    readonly distB: Uint8Array,
    readonly version: string,
  ) {}

  heuristic(state: CubeState): number {
    const da = this.distA[rankAbstract(project(state, PARTITION_A), PARTITION_A)]!;
    const db = this.distB[rankAbstract(project(state, PARTITION_B), PARTITION_B)]!;
    if (da === UNREACHED || db === UNREACHED) {
      // 理论上合法状态都可达；保险起见给一个保守下界。
      return Math.max(da === UNREACHED ? 0 : da, db === UNREACHED ? 0 : db);
    }
    return Math.max(da, db);
  }
}

// 在抽象空间中直接做广度优先枚举（一次转动 = 一步，半转也一步）。
function buildOne(partition: number[], onProgress?: (done: number) => void): Uint8Array {
  const dist = new Uint8Array(ABSTRACT_COUNT).fill(UNREACHED);
  const member = new Uint8Array(8);
  partition.forEach((c) => (member[c] = 1));

  const solvedOcc = new Int8Array(8).fill(-1);
  const solvedOri = new Int8Array(8);
  partition.forEach((c) => {
    solvedOcc[c] = c;
  });
  const start = { occ: solvedOcc, ori: solvedOri };
  const startRank = rankAbstract(start, partition);
  dist[startRank] = 0;

  // 队列存抽象状态（为节省内存，重建 occ/ori 成本高，故直接存两个数组）
  const queueOcc: Int8Array[] = [Int8Array.from(start.occ)];
  const queueOri: Int8Array[] = [Int8Array.from(start.ori)];
  let head = 0;
  let reached = 1;

  while (head < queueOcc.length) {
    const occ = queueOcc[head]!;
    const ori = queueOri[head]!;
    const d = dist[rankAbstract({ occ, ori }, partition)]!;
    head++;

    for (const move of ALL_MOVES) {
      const no = new Int8Array(8).fill(-1);
      const nori = new Int8Array(8);
      // 抽象转移：把“已追踪角块”当作实体随面转动移动；未追踪位置保持占位。
      for (let pos = 0; pos < 8; pos++) {
        const c = occ[pos];
        if (c === undefined || c === -1) continue;
        // 对该角块施加转动：求它到达的新位置与新朝向
        let curPos: number = pos;
        let curOri = ori[pos]!;
        for (let k = 0; k < move.quarterPower; k++) {
          // 四分之一转下，角块从位置 curPos 移动到满足 cpTable[face][newPos]=curPos 的 newPos
          curPos = QUARTER_DEST[move.face][curPos]!;
          curOri = (curOri + TWIST_AT_DEST[move.face][curPos]!) % 3;
        }
        no[curPos] = c;
        nori[curPos] = curOri;
      }
      const r = rankAbstract({ occ: no, ori: nori }, partition);
      if (dist[r] === UNREACHED) {
        dist[r] = d + 1;
        queueOcc.push(no);
        queueOri.push(nori);
        reached++;
      }
    }
    if (onProgress && head % 5000 === 0) onProgress(reached);
  }
  onProgress?.(reached);
  return dist;
}

// QUARTER_DEST[face][srcPos] = 四分之一顺时针转动后，原本在 srcPos 的角块所在位置。
// 由 cp 表 cpNew[newPos]=old[cpTable[newPos]] 反解：src = cpTable[newPos]。
const QUARTER_DEST: Record<Face, number[]> = {
  U: invertDest([3, 0, 1, 2, 4, 5, 6, 7]),
  R: invertDest([4, 1, 2, 0, 7, 5, 6, 3]),
  F: invertDest([1, 5, 2, 3, 0, 4, 6, 7]),
  D: invertDest([0, 1, 2, 3, 5, 6, 7, 4]),
  L: invertDest([0, 2, 6, 3, 4, 1, 5, 7]),
  B: invertDest([0, 1, 3, 7, 4, 5, 2, 6]),
};

// 角块到达新位置 newPos 后增加的扭转量（与 moves.ts 的 CO 表一致）。
const TWIST_AT_DEST: Record<Face, number[]> = {
  U: [0, 0, 0, 0, 0, 0, 0, 0],
  R: [2, 0, 0, 1, 1, 0, 0, 2],
  F: [1, 2, 0, 0, 2, 1, 0, 0],
  D: [0, 0, 0, 0, 0, 0, 0, 0],
  L: [0, 1, 2, 0, 0, 2, 1, 0],
  B: [0, 0, 1, 2, 0, 0, 2, 1],
};

function invertDest(cpTable: number[]): number[] {
  const dest = new Array<number>(8);
  for (let newPos = 0; newPos < 8; newPos++) dest[cpTable[newPos]!] = newPos;
  return dest;
}

export function buildPatternDbs(onProgress?: (label: string, done: number) => void): {
  distA: Uint8Array;
  distB: Uint8Array;
} {
  const distA = buildOne(PARTITION_A, (d) => onProgress?.('A', d));
  const distB = buildOne(PARTITION_B, (d) => onProgress?.('B', d));
  return { distA, distB };
}
