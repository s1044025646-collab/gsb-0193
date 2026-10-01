import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { AnalyzerService } from "../service.js";
import { CubeError } from "../cube/state.js";

interface Route {
  method: string;
  pattern: RegExp;
  handler: (svc: AnalyzerService, body: any, params: RegExpExecArray, query: URLSearchParams) => unknown;
}

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/health$/, handler: (svc) => ({ ok: true, pdb: svc.pdbInfo, fingerprint: svc.pdbs.fingerprint }) },
  { method: "GET", pattern: /^\/api\/solved$/, handler: (svc) => svc.solvedState() },
  { method: "GET", pattern: /^\/api\/states$/, handler: (svc) => ({ states: svc.store.listStates() }) },
  { method: "POST", pattern: /^\/api\/states$/, handler: (svc, b) => svc.importState(b.cp, b.co, b.label ?? null) },
  { method: "POST", pattern: /^\/api\/scramble$/, handler: (svc, b) => svc.scramble(toInt(b.seed, 0), toInt(b.length, 0)) },
  { method: "POST", pattern: /^\/api\/decode$/, handler: (svc, b) => svc.decode(String(b.code)) },
  { method: "POST", pattern: /^\/api\/execute$/, handler: (svc, b) => svc.execute(String(b.code), String(b.moves ?? "")) },
  {
    method: "POST",
    pattern: /^\/api\/solve$/,
    handler: (svc, b) =>
      svc.solveCode(String(b.code), {
        maxNodes: b.maxNodes === undefined ? undefined : toInt(b.maxNodes, 1, "maxNodes"),
        timeoutMs: b.timeoutMs === undefined ? undefined : toInt(b.timeoutMs, 1, "timeoutMs"),
        useCache: b.useCache !== false,
      }),
  },
  { method: "POST", pattern: /^\/api\/replay$/, handler: (svc, b) => svc.replayCode(String(b.code), String(b.moves ?? "")) },
  { method: "POST", pattern: /^\/api\/verify$/, handler: (svc, b) => svc.verify(String(b.code), String(b.moves ?? "")) },
  {
    method: "POST",
    pattern: /^\/api\/bfs-check$/,
    handler: (svc, b) => svc.bfsCheck(String(b.code), toInt(b.maxDepth ?? 6, 0, "maxDepth")),
  },
  { method: "GET", pattern: /^\/api\/solutions\/(\d+)$/, handler: (svc, _b, p) => ({ solution: svc.store.getSolutionById(Number(p[1])) }) },
  { method: "GET", pattern: /^\/api\/solutions$/, handler: (svc) => ({ solutions: svc.store.listSolutions() }) },
];

function toInt(v: unknown, min: number, field = "value"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new CubeError(`参数 ${field} 必须是 >= ${min} 的整数，实际 ${v}`, "BAD_PARAM");
  return n;
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new CubeError("请求体不是合法 JSON", "BAD_JSON");
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

export function startServer(config = loadConfig()): { close: () => void; port: number } {
  const svc = AnalyzerService.create(config);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
        if (url.pathname === "/") {
          send(res, 200, {
            service: "pocket-cube-analyzer",
            endpoints: routes.map((r) => `${r.method} ${r.pattern.source.replaceAll("\\", "").replace(/\^|\$|\(\.\+\)|\(\\d\+\)/g, "")}`),
          });
          return;
        }
        const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
        if (!route) {
          send(res, 404, { error: "not_found", message: `无此路由: ${req.method} ${url.pathname}` });
          return;
        }
        const body = req.method === "POST" ? await readJson(req) : {};
        const match = route.pattern.exec(url.pathname)!;
        const data = route.handler(svc, body, match, url.searchParams);
        send(res, 200, data);
      } catch (e) {
        if (e instanceof CubeError) {
          send(res, 400, { error: e.code, message: e.message, detail: e.detail });
        } else {
          send(res, 500, { error: "internal", message: (e as Error).message });
        }
      }
    })();
  });
  server.listen(config.port);
  return {
    port: config.port,
    close: () => {
      server.close();
      svc.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig();
  startServer(cfg);
  console.log(`[pocket-cube] HTTP API 已启动: http://localhost:${cfg.port}`);
  console.log(`[pocket-cube] 数据目录: ${cfg.dataDir}`);
}
