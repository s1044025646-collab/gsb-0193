import {
  ALL_MOVES,
  CORNER_NAMES,
  CornerPerm,
  CornerOri,
  CubieState,
  FACE_NAMES,
  FaceName,
  MOVE_CO,
  MOVE_CP,
  Move,
  MoveSuffix,
  SOLVED,
} from "./constants.js";

export class CubeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CubeError";
  }
}

export function cloneState(s: CubieState): CubieState {
  return { cp: [...s.cp] as CornerPerm, co: [...s.co] as CornerOri };
}

export function statesEqual(a: CubieState, b: CubieState): boolean {
  for (let i = 0; i < 8; i++) if (a.cp[i] !== b.cp[i] || a.co[i] !== b.co[i]) return false;
  return true;
}

/** 对当前局面施加某一面的 1/4 顺时针对应 power 次（power=1,2,3）。返回新状态。 */
export function applyFaceTurn(
  state: CubieState,
  face: FaceName,
  power: 1 | 2 | 3 = 1,
): CubieState {
  let cur = state;
  for (let p = 0; p < power; p++) {
    const mcp = MOVE_CP[face];
    const mco = MOVE_CO[face];
    const ncp: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    const nco: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const src = mcp[i]!;
      ncp[i] = cur.cp[src]!;
      nco[i] = (cur.co[src]! + mco[i]!) % 3;
    }
    cur = { cp: ncp as unknown as CornerPerm, co: nco as unknown as CornerOri };
  }
  return cur;
}

export function applyMove(state: CubieState, move: Move): CubieState {
  return applyFaceTurn(state, move.face, move.power);
}

/** 依次施加动作序列。 */
export function applyMoves(state: CubieState, moves: readonly Move[]): CubieState {
  let cur = state;
  for (const m of moves) cur = applyMove(cur, m);
  return cur;
}

/** 解析单个记号，如 R / r / r' / R’(中文撇) / R2 / r2 / R`。 */
export function parseMove(token: string): Move {
  const norm = token
    .trim()
    .toUpperCase()
    .replace(/[’′`]/g, "'");
  if (norm.length < 1 || norm.length > 2) {
    throw new CubeError(`非法动作记号: "${token}"，应为面名(U/R/F/D/L/B)加可选后缀 ' 或 2`, "BAD_MOVE", {
      token,
    });
  }
  const face = norm[0] as FaceName;
  if (!FACE_NAMES.includes(face)) {
    throw new CubeError(
      `非法动作面: "${norm[0]}"，合法面为 ${FACE_NAMES.join("/")}`,
      "BAD_MOVE_FACE",
      { token, face: norm[0] },
    );
  }
  let suffix: MoveSuffix = "";
  if (norm.length === 2) {
    const s = norm[1];
    if (s === "'") suffix = "'";
    else if (s === "2") suffix = "2";
    else {
      throw new CubeError(
        `非法动作后缀: "${s}"，合法后缀为 ' (逆时针) 或 2 (半转)`,
        "BAD_MOVE_SUFFIX",
        { token, suffix: s },
      );
    }
  }
  return ALL_MOVES.find((m) => m.face === face && m.suffix === suffix)!;
}

/** 解析以空白分隔的动作序列，空串视为空序列。 */
export function parseSequence(text: string): Move[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.map(parseMove);
}

/** 动作序列的规范记号文本。 */
export function movesToNotation(moves: readonly Move[]): string {
  return moves.map((m) => m.notation).join(" ");
}

/** 动作取逆（同一面：''<->'''，'2' 不变）。 */
export function inverseMove(move: Move): Move {
  const invSuffix: MoveSuffix = move.suffix === "" ? "'" : move.suffix === "'" ? "" : "2";
  return ALL_MOVES.find((m) => m.face === move.face && m.suffix === invSuffix)!;
}

/** 序列取逆：反转顺序并逐个取逆。 */
export function inverseSequence(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(inverseMove);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 合法性检查：
 *  - 角块编号必须在 0..7 且恰好各出现一次（不允许重复/缺失）；
 *  - 朝向必须在 0..2（越界报错）；
 *  - 扭转量之和必须 mod 3 === 0（物理可实现约束）。
 * 注意：二阶角块排列可以是奇排列，故不做排列奇偶性限制。
 */
export function validateState(state: { cp: readonly number[]; co: readonly number[] }): ValidationResult {
  const errors: string[] = [];
  if (state.cp.length !== 8) errors.push(`角块数组长度必须为 8，实际 ${state.cp.length}`);
  if (state.co.length !== 8) errors.push(`朝向数组长度必须为 8，实际 ${state.co.length}`);

  const seen = new Array<number>(8).fill(0);
  state.cp.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 0 || c > 7) {
      errors.push(`角位 ${i}(${CORNER_NAMES[i] ?? i}) 的角块编号越界: ${c}（合法范围 0..7）`);
    } else {
      seen[c]! += 1;
    }
  });
  seen.forEach((count, c) => {
    if (count === 0) errors.push(`缺少角块 ${c}(${CORNER_NAMES[c]})`);
    else if (count > 1) errors.push(`角块 ${c}(${CORNER_NAMES[c]}) 重复出现 ${count} 次`);
  });

  state.co.forEach((o, i) => {
    if (!Number.isInteger(o) || o < 0 || o > 2) {
      errors.push(`角位 ${i}(${CORNER_NAMES[i] ?? i}) 的朝向越界: ${o}（合法值 0/1/2）`);
    }
  });

  const oriAllInRange = state.co.every((o) => Number.isInteger(o) && o >= 0 && o <= 2);
  if (oriAllInRange) {
    const sum = state.co.reduce((a, b) => a + b, 0);
    if (sum % 3 !== 0) {
      errors.push(`角块扭转量之和 ${sum} 不能被 3 整除（物理上不可实现，如单角扭转）`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValid(state: { cp: readonly number[]; co: readonly number[] }): void {
  const r = validateState(state);
  if (!r.valid) {
    throw new CubeError(`非法魔方状态: ${r.errors.join("；")}`, "INVALID_STATE", { errors: r.errors });
  }
}

export function isSolved(state: CubieState): boolean {
  return statesEqual(state, SOLVED);
}

/** 由松散输入（普通数组）构造状态并校验。 */
export function makeState(cp: readonly number[], co: readonly number[]): CubieState {
  const state: CubieState = {
    cp: [...cp] as unknown as CornerPerm,
    co: [...co] as unknown as CornerOri,
  };
  assertValid(state);
  return state;
}

/** 生成角块表：角位 -> 当前角块名 + 朝向。 */
export function cornerTable(state: CubieState): {
  position: string;
  cubie: string;
  orientation: number;
}[] {
  return state.cp.map((c, i) => ({
    position: CORNER_NAMES[i]!,
    cubie: CORNER_NAMES[c]!,
    orientation: state.co[i]!,
  }));
}

/** 状态的紧凑可逆文本表示，如 "01234567/00000000"。 */
export function encodeState(state: CubieState): string {
  return `${state.cp.join("")}/${state.co.join("")}`;
}

export function decodeState(text: string): CubieState {
  const m = /^([0-7]{8})\/([0-2]{8})$/.exec(text.trim());
  if (!m) {
    throw new CubeError(
      `无法解析状态码 "${text}"，期望形如 01234567/00000000`,
      "BAD_STATE_CODE",
      { text },
    );
  }
  const cp = m[1]!.split("").map(Number);
  const co = m[2]!.split("").map(Number);
  return makeState(cp, co);
}
