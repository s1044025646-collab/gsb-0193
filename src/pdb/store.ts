import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ABSTRACT_COUNT,
  PatternDb,
  buildPatternDbs,
} from './pattern.js';

// 版本号在以下任一变化时应提升：分区、转动表、编码或 BFS 规则。
export const PDB_VERSION = 'pocketcube-pdb-v1';
export const PDB_FILE = 'patterndb.bin';

// 文件布局：magic(20B) | versionLen(1) | version(n) | sha256(32B) | distA | distB
const MAGIC = Buffer.from('PCUBEPDB\0\0\0\0\0\0\0\0\0\0\0\0', 'ascii');

export function defaultPdbPath(dataDir: string): string {
  return join(dataDir, 'pdb', PDB_FILE);
}

export function savePatternDb(path: string, distA: Uint8Array, distB: Uint8Array): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const version = Buffer.from(PDB_VERSION, 'utf8');
  const payload = Buffer.concat([Buffer.from(distA), Buffer.from(distB)]);
  const hash = createHash('sha256').update(version).update(payload).digest();
  const header = Buffer.alloc(20 + 1 + version.length + 32);
  MAGIC.copy(header, 0);
  header[20] = version.length;
  version.copy(header, 21);
  hash.copy(header, 21 + version.length);
  writeFileSync(path, Buffer.concat([header, payload]));
}

export function loadPatternDb(path: string): PatternDb {
  if (!existsSync(path)) throw new Error(`模式数据库不存在: ${path}`);
  const buf = readFileSync(path);
  if (buf.length < 53 || !buf.subarray(0, 20).equals(MAGIC)) {
    throw new Error('模式数据库文件头不匹配，可能来自不兼容版本');
  }
  const vlen = buf[20]!;
  const version = buf.subarray(21, 21 + vlen).toString('utf8');
  if (version !== PDB_VERSION) {
    throw new Error(`模式数据库版本不匹配: 文件=${version}，程序=${PDB_VERSION}，请重新构建`);
  }
  const hashOff = 21 + vlen;
  const payload = buf.subarray(hashOff + 32);
  if (payload.length !== ABSTRACT_COUNT * 2) {
    throw new Error(`模式数据库大小异常: ${payload.length}（应为 ${ABSTRACT_COUNT * 2}）`);
  }
  const expect = createHash('sha256')
    .update(Buffer.from(version, 'utf8'))
    .update(payload)
    .digest();
  if (!buf.subarray(hashOff, hashOff + 32).equals(expect)) {
    throw new Error('模式数据库校验和错误，文件可能已损坏，请重新构建');
  }
  const distA = new Uint8Array(payload.subarray(0, ABSTRACT_COUNT));
  const distB = new Uint8Array(payload.subarray(ABSTRACT_COUNT));
  return new PatternDb(distA, distB, version);
}

let cached: PatternDb | null = null;

// 加载模式库，缺失或版本不符时自动在项目内重建。
export function getOrBuildPatternDb(dataDir: string): PatternDb {
  if (cached) return cached;
  const path = defaultPdbPath(dataDir);
  try {
    cached = loadPatternDb(path);
    return cached;
  } catch (e) {
    const reason = (e as Error).message;
    process.stderr.write(`[pdb] ${reason}，开始重建……\n`);
    const { distA, distB } = buildPatternDbs((label, done) => {
      if (done % 40000 < 5000) process.stderr.write(`[pdb] 分区${label} 已枚举 ${done}\n`);
    });
    savePatternDb(path, distA, distB);
    cached = new PatternDb(distA, distB, PDB_VERSION);
    return cached;
  }
}
