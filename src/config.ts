import { resolve } from "node:path";

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  pdbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): AppConfig {
  const dataDir = resolve(cwd, env.POCKETCUBE_DATA_DIR ?? "data");
  return {
    port: Number(env.PORT ?? env.POCKETCUBE_PORT ?? 3000),
    dataDir,
    dbPath: resolve(dataDir, "pocketcube.sqlite"),
    pdbPath: resolve(dataDir, "pdb-cache.bin"),
  };
}
