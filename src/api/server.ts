import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openDatabase } from '../db/database.js';
import { getOrBuildPatternDb } from '../pdb/store.js';
import { AnalyzerService } from '../services/analyzer.js';
import type { CubeState } from '../cube/types.js';

export interface ServerConfig {
  port: number;
  dataDir: string;
}

export function resolveConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? process.env.PCUBE_PORT ?? 8787);
  const dataDir = process.env.PCUBE_DATA_DIR ?? join(process.cwd(), 'data');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口无效: ${port}`);
  }
  return { port, dataDir };
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON: ${(e as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

export function createApp(svc: AnalyzerService) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, service: 'pocketcube-analyzer' });
      }
      if (req.method === 'GET' && path === '/solved') {
        return send(res, 200, { state: svc.getSolved() });
      }

      if (req.method === 'POST' && path === '/state/import') {
        const body = await readBody(req);
        const state = svc.importState({ cp: body.cp, co: body.co });
        return send(res, 200, { state, corners: svc.cornerTable(state), solved: svc.isSolved(state) });
      }
      if (req.method === 'POST' && path === '/state/validate') {
        const body = await readBody(req);
        return send(res, 200, svc.validate(body as CubeState));
      }
      if (req.method === 'POST' && path === '/scramble') {
        const body = await readBody(req);
        const length = Number(body.length ?? 12);
        const seed = Number(body.seed ?? 1);
        const r = svc.scramble(length, seed);
        return send(res, 200, { seed, length, sequence: r.text, state: r.state, corners: svc.cornerTable(r.state) });
      }
      if (req.method === 'POST' && path === '/execute') {
        const body = await readBody(req);
        const r = svc.execute(body.state as CubeState, String(body.sequence ?? ''));
        return send(res, 200, { state: r.state, sequence: r.moves.map((m) => m.name).join(' ') });
      }
      if (req.method === 'POST' && path === '/from-solved') {
        const body = await readBody(req);
        const r = svc.fromSolved(String(body.sequence ?? ''));
        return send(res, 200, { state: r.state, corners: svc.cornerTable(r.state) });
      }
      if (req.method === 'POST' && path === '/solve') {
        const body = await readBody(req);
        const params = {
          nodeBudget: body.nodeBudget,
          timeBudgetMs: body.timeBudgetMs,
          maxDepth: body.maxDepth,
        };
        const result = svc.solve(body.state as CubeState, stripUndefined(params));
        let id: number | undefined;
        if (body.save !== false) {
          id = svc.saveAnalysis({
            state: body.state as CubeState,
            source: 'api',
            scramble: body.scramble ?? null,
            solve: result,
            params: stripUndefined(params),
          });
        }
        return send(res, 200, { id, ...result });
      }
      if (req.method === 'POST' && path === '/replay') {
        const body = await readBody(req);
        return send(res, 200, svc.replay(String(body.sequence ?? '')));
      }
      if (req.method === 'POST' && path === '/verify') {
        const body = await readBody(req);
        return send(res, 200, svc.verify(body.state as CubeState, String(body.solution ?? '')));
      }
      if (req.method === 'POST' && path === '/inverse') {
        const body = await readBody(req);
        return send(res, 200, svc.inverse(String(body.sequence ?? '')));
      }
      if (req.method === 'POST' && path === '/bfs-verify') {
        const body = await readBody(req);
        const r = svc.bfsVerify(body.state as CubeState, Number(body.maxDepth ?? 5), body.visitedLimit);
        return send(res, 200, {
          distance: r.distance,
          visited: r.visited,
          path: r.path.map((m) => m.name),
        });
      }
      if (req.method === 'GET' && path === '/analyses') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return send(res, 200, { analyses: svc.listAnalyses(limit) });
      }
      const m = path.match(/^\/analyses\/(\d+)$/);
      if (req.method === 'GET' && m) {
        const row = svc.loadAnalysis(Number(m[1]));
        if (!row) return send(res, 404, { error: '未找到该分析记录' });
        return send(res, 200, row);
      }
      return send(res, 404, { error: `未知路径 ${path}` });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

const isMain = (() => {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
})();

if (isMain) {
  const cfg = resolveConfig();
  process.stderr.write(`[init] 数据目录: ${cfg.dataDir}\n[init] 加载模式数据库……\n`);
  const pdb = getOrBuildPatternDb(cfg.dataDir);
  const db = openDatabase(cfg.dataDir);
  const svc = new AnalyzerService(db, pdb);
  const server = createApp(svc);
  server.listen(cfg.port, () => {
    process.stderr.write(`[ready] HTTP API 监听 http://127.0.0.1:${cfg.port}\n`);
  });
}
