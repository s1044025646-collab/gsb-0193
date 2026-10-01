import { spawn } from "node:child_process";

const port = process.env.TEST_PORT ?? "3219";
process.env.PORT = port;
const child = spawn(process.execPath, ["dist/src/api/server.js"], { env: process.env, stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

try {
  await sleep(2500);
  const health = await call("GET", "/api/health");
  console.log("health:", health.status, health.json.fingerprint);
  const scr = await call("POST", "/api/scramble", { seed: 7, length: 6 });
  console.log("scramble:", scr.json.notation, "->", scr.json.state.code);
  const sol = await call("POST", "/api/solve", { code: scr.json.state.code });
  console.log("solve:", sol.json.notation, "optimal=", sol.json.provenOptimal, "nodes=", sol.json.nodesExpanded, sol.json.stopReason);
  const cached = await call("POST", "/api/solve", { code: scr.json.state.code });
  console.log("cached:", cached.json.fromCache);
  const wrong = await call("POST", "/api/verify", { code: scr.json.state.code, moves: `${sol.json.notation} U` });
  console.log("verify-wrong:", wrong.json.valid, "|", wrong.json.firstError);
  const illegal = await call("POST", "/api/states", { cp: [0, 0, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] });
  console.log("import-duplicate HTTP", illegal.status, illegal.json.error, "-", illegal.json.message.slice(0, 40));
  const budget = await call("POST", "/api/solve", { code: scr.json.state.code, maxNodes: 1, useCache: false });
  console.log("budget:", budget.json.stopReason, "provenOptimal=", budget.json.provenOptimal, "note?", !!budget.json.note);
} finally {
  child.kill();
}
