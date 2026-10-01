/**
 * 固定朝向的二阶魔方约定
 *
 * 角位编号（空间位置固定，不因整体旋转改变）：
 *   URF=0  UFL=1  ULB=2  UBR=3
 *   DFR=4  DLF=5  DBL=6  DRB=7
 *
 * 角块编号按其在复原态所处位置编号（与角位同名）：
 *   0..7 分别对应 URF,UFL,ULB,UBR,DFR,DLF,DBL,DRB。
 *
 * 朝向 cp[i] 表示当前位于角位 i 的角块编号；co[i] 为其扭转量 0/1/2。
 * 约定：扭转量相对“该角块在复原态时 U/D 面贴纸所在的位置”。
 * 物理约束：所有角块扭转量之和 mod 3 === 0。
 *
 * 面转动方向：面对该面看，顺时针为该面基本转动；后缀 '（撇/P）为逆时针，
 * 2 为半转。半转计 1 步。
 */

export const CORNER_NAMES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

export const FACE_NAMES = ["U", "R", "F", "D", "L", "B"] as const;
export type FaceName = (typeof FACE_NAMES)[number];

export type CornerPerm = readonly [number, number, number, number, number, number, number, number];
export type CornerOri = readonly [number, number, number, number, number, number, number, number];

export interface CubieState {
  cp: CornerPerm;
  co: CornerOri;
}

/**
 * 六个面顺时针 1/4 转的角块排列表。
 * moveCp[f][i] = 角位 i 在转动后，其角块来自转动前的角位 moveCp[f][i]。
 * 即 newCp[i] = oldCp[moveCp[f][i]]，参考 Kociemba cubie-level 定义。
 */
export const MOVE_CP: Record<FaceName, CornerPerm> = {
  // U: 顶面顺时针（俯视），URF<-UBR, UFL<-URF, ULB<-UFL, UBR<-ULB；D 层不动
  U: [3, 0, 1, 2, 4, 5, 6, 7],
  // R: 右面顺时针（从右侧看），影响 URF/DFR/DRB/UBR
  R: [4, 1, 2, 0, 7, 5, 6, 3],
  // F: 前面顺时针（从前面看），影响 URF/UFL/DLF/DFR
  F: [1, 5, 2, 3, 0, 4, 6, 7],
  // D: 底面顺时针（仰视），影响 DFR/DLF/DBL/DRB
  D: [0, 1, 2, 3, 5, 6, 7, 4],
  // L: 左面顺时针（从左侧看），影响 UFL/ULB/DBL/DLF
  L: [0, 2, 6, 3, 4, 1, 5, 7],
  // B: 后面顺时针（从后面看），影响 ULB/UBR/DRB/DBL
  B: [0, 1, 3, 7, 4, 5, 2, 6],
};

/**
 * 角块扭转增量表：newCo[i] = oldCo[src] + moveCo[f][i] (mod 3)。
 * U/D 转动不扭转角块；R/F/L/B 的四分之一转各影响四个角。
 */
export const MOVE_CO: Record<FaceName, CornerOri> = {
  U: [0, 0, 0, 0, 0, 0, 0, 0],
  R: [2, 0, 0, 1, 1, 0, 0, 2],
  F: [1, 2, 0, 0, 2, 1, 0, 0],
  D: [0, 0, 0, 0, 0, 0, 0, 0],
  L: [0, 1, 2, 0, 0, 2, 1, 0],
  B: [0, 0, 1, 2, 0, 0, 2, 1],
};

export const SOLVED: CubieState = {
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
};

/** 支持的 18 个基本动作，按面+修饰符展开；每个动作计 1 步。 */
export const MOVE_SUFFIXES = ["", "'", "2"] as const;
export type MoveSuffix = (typeof MOVE_SUFFIXES)[number];

export interface Move {
  face: FaceName;
  suffix: MoveSuffix;
  /** 规范记号，如 R'、F2、U */
  notation: string;
  /** 对应基本面顺时针转动的次数：1 / 3(逆时针) / 2(半转) */
  power: 1 | 3 | 2;
}

export function buildAllMoves(): Move[] {
  const moves: Move[] = [];
  for (const face of FACE_NAMES) {
    for (const suffix of MOVE_SUFFIXES) {
      moves.push({
        face,
        suffix,
        notation: `${face}${suffix}`,
        power: suffix === "" ? 1 : suffix === "2" ? 2 : 3,
      });
    }
  }
  return moves;
}

export const ALL_MOVES: readonly Move[] = buildAllMoves();
