// 八个角块 / 角位置的编号（固定朝向，沿用通用角块记号）
//   0 URF   1 UFL   2 ULB   3 UBR
//   4 DFR   5 DLF   6 DBL   7 DRB
// 状态用两个长度为 8 的数组表示：
//   cp[i] = 位于角位置 i 上的角块编号
//   co[i] = 该角块的扭转量，取值 0/1/2
export type Corner = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CubeState {
  cp: number[]; // corner permutation，长度 8
  co: number[]; // corner orientation，长度 8，元素 0..2
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';
export type Suffix = '' | "'" | '2';

export interface Move {
  face: Face;
  suffix: Suffix; // '' 顺时针, "'" 逆时针, '2' 半转
  name: string;
  quarterPower: 1 | 3 | 2; // 在四分之一转动循环中的幂
}
