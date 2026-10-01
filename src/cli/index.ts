#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { AnalyzerService } from "../service.js";
import { CubeError } from "../cube/state.js";
import { demo } from "./demo.js";

function j(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function num(args: string[], name: string): number | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`--${name} 需要数字参数`);
  return v;
}

function str(args: string[], name: string, def = ""): string {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : (args[i + 1] ?? def);
}

export function runCli(argv: string[]): number {
  const [command, ...rest] = argv;
  const config = loadConfig();
  let svc: AnalyzerService | null = null;
  try {
    switch (command) {
      case "pdb-build": {
        svc = AnalyzerService.create(config, rest.includes("--force"));
        console.log(j({ ok: true, fingerprint: svc.pdbs.fingerprint, pdb: svc.pdbInfo, path: config.pdbPath }));
        break;
      }
      case "solved": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.solvedState()));
        break;
      }
      case "scramble": {
        svc = AnalyzerService.create(config);
        const seed = num(rest, "seed") ?? 1;
        const length = num(rest, "length") ?? 12;
        console.log(j(svc.scramble(seed, length)));
        break;
      }
      case "import": {
        svc = AnalyzerService.create(config);
        const cp = str(rest, "cp").split(",").map(Number);
        const co = str(rest, "co").split(",").map(Number);
        console.log(j(svc.importState(cp, co, str(rest, "label") || null)));
        break;
      }
      case "execute": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.execute(str(rest, "code", "01234567/00000000"), str(rest, "moves"))));
        break;
      }
      case "solve": {
        svc = AnalyzerService.create(config);
        console.log(
          j(
            svc.solveCode(str(rest, "code", "01234567/00000000"), {
              maxNodes: num(rest, "max-nodes"),
              timeoutMs: num(rest, "timeout-ms"),
              useCache: !rest.includes("--no-cache"),
            }),
          ),
        );
        break;
      }
      case "replay": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.replayCode(str(rest, "code", "01234567/00000000"), str(rest, "moves"))));
        break;
      }
      case "verify": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.verify(str(rest, "code", "01234567/00000000"), str(rest, "moves"))));
        break;
      }
      case "bfs-check": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.bfsCheck(str(rest, "code", "01234567/00000000"), num(rest, "max-depth") ?? 6)));
        break;
      }
      case "states": {
        svc = AnalyzerService.create(config);
        console.log(j(svc.store.listStates()));
        break;
      }
      case "solutions": {
        svc = AnalyzerService.create(config);
        const id = num(rest, "id");
        console.log(j(id ? svc.store.getSolutionById(id) : svc.store.listSolutions()));
        break;
      }
      case "serve": {
        return startFromCli();
      }
      case "demo": {
        svc = AnalyzerService.create(config);
        demo(svc);
        break;
      }
      default:
        printUsage();
        return command === undefined ? 0 : 2;
    }
    return 0;
  } catch (e) {
    if (e instanceof CubeError) {
      console.error(j({ error: e.code, message: e.message, detail: e.detail }));
      return 1;
    }
    console.error((e as Error).stack ?? (e as Error).message);
    return 1;
  } finally {
    svc?.close();
  }
}

function startFromCli(): number {
  import("../api/server.js").then(({ startServer }) => {
    const cfg = loadConfig();
    const h = startServer(cfg);
    console.log(`[pocket-cube] HTTP API 已启动: http://localhost:${h.port}`);
    console.log(`[pocket-cube] 数据目录: ${cfg.dataDir}`);
  });
  return 0;
}

function printUsage(): void {
  console.log(`二阶魔方分析后端 CLI

用法: pocketcube <命令> [参数]

命令:
  pdb-build [--force]              构建/校验模式数据库（项目内缓存）
  solved                           输出固定朝向复原态与角块表
  scramble --seed 1 --length 12    固定种子打乱
  import --cp 0,.. --co 0,..       导入局面（含合法性校验）
  execute --code <码> --moves "R U R'"   对局面执行动作
  solve --code <码> [--max-nodes N] [--timeout-ms N] [--no-cache]
  replay --code <码> --moves ".."  逐步重放
  verify --code <码> --moves ".."  核验外部解法，报告首个问题
  bfs-check --code <码> --max-depth 6    独立 BFS 验证最短步数
  states / solutions [--id N]      查询 SQLite 记录
  serve                            启动 HTTP API
  demo                             完整端到端演示（含重启后读取）

环境变量:
  PORT 或 POCKETCUBE_PORT (默认 3000)
  POCKETCUBE_DATA_DIR (默认 ./data)
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli(process.argv.slice(2)));
}
