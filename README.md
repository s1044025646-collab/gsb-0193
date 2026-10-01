# 二阶魔方状态校验与最短复原搜索后端

固定朝向的二阶魔方（2×2×2）离线分析服务：用 **八个角块的排列与朝向** 表示状态，
支持从复原态按转动序列生成局面、校验合法性、搜索**最短**复原路径、逐步重放、
核验外部解法，并把局面、解法和参数快照持久化到项目内 SQLite。

仅后端：TypeScript + Node.js（内置 `node:sqlite`，**零运行时第三方依赖**），
提供 HTTP API 与 CLI，无需 Docker、WSL、图形界面或任何在线服务。

---

## 1. 环境要求

- Node.js **>= 22.5**（开发与验证使用 v25.5；运行的是 tsc 编译产物）
- Windows PowerShell（也兼容任意平台 shell）

```powershell
node --version
npm install
```

## 2. 构建 / 测试 / 启动 / 演示

```powershell
npm run build     # TypeScript 编译到 dist/
npm test          # 编译并运行 node:test 全部测试
npm run pdb       # 预先构建模式数据库（首次求解也会自动构建，约 2 秒）
npm start         # 启动 HTTP API，默认 http://localhost:3000
npm run demo      # 端到端 CLI 演示（生成→求解→重放→核验→重启读取）
```

配置（环境变量）：

- `PORT` 或 `POCKETCUBE_PORT`：HTTP 端口，默认 `3000`
- `POCKETCUBE_DATA_DIR`：项目内数据目录，默认 `./data`（SQLite、PDB 缓存均在此）

```powershell
$env:PORT="8080"; $env:POCKETCUBE_DATA_DIR="./data"; npm start
```

## 3. 魔方约定（固定朝向）

八个角位（空间位置固定，**不随整体旋转改变**）与同名角块编号：

| 编号 | 角位/角块 | 编号 | 角位/角块 |
|---|---|---|---|
| 0 | URF（上右前） | 4 | DFR（下右前） |
| 1 | UFL（上左前） | 5 | DLF（下左前） |
| 2 | ULB（上左后） | 6 | DBL（下左后） |
| 3 | UBR（上右后） | 7 | DRB（下右后） |

状态为一对长度 8 的数组：

- `cp[i]`：当前位于角位 `i` 的角块编号（0..7）
- `co[i]`：该角块扭转量，取值 `0/1/2`
- 状态码文本：`cp 连写 / co 连写`，复原态为 `01234567/00000000`

面转动：面对该面看，**顺时针**为基本转动；后缀 `'` 为逆时针，`2` 为半转。
支持 `U R F D L B` 各 3 种共 **18 个基本动作**。一次面转动计一步，**半转也计 1 步**（HTM）。
解析器兼容小写与中文撇（`r’`）等写法。

### 合法性规则

1. 八个角块必须在 0..7 且**恰好各出现一次**（重复、缺失、越界都报具体错误）；
2. 每个朝向必须为 0/1/2（越界报具体错误）；
3. 八个扭转量之和必须满足 `sum(co) ≡ 0 (mod 3)`（例如单角扭转被拒绝）；
4. **不要求角块排列为偶排列**——二阶角块允许奇排列，强行要求偶排列是常见错误。

目标是固定朝向的标准复原态；整体旋转后的局面不会被当作零步完成。

## 4. 算法与最短性证明

- **搜索**：IDA*（迭代加深 A*）。每次迭代有明确深度界；仅当某一界完整搜索完并
  找到解，才把该长度标记为**已证明最短**（`provenOptimal=true`）。
- **启发**：自建小型**模式数据库（PDB）**，把 8 个角块分为不相交的两组
  （顶层 4 角、底层 4 角），分别从复原态做全广度优先枚举，得到每个抽象状态的
  精确步数（各 136080 条）。运行时启发取两组距离的**最大值**。
- **为何剪枝不丢最优解**：
- 每个 PDB 距离是“仅复原该子集所需步数”的精确值，任何完整解法都不可能比它短，
  因此单个 PDB 距离是完整解长度的可采纳下界，两个下界取最大仍为下界。
- IDA* 只在 `g + h > bound` 时剪枝，被剪分支不可能含界内解。
- 动作去冗余（不连续转同一面；同轴向相邻两面固定先后顺序）只删除存在
  等价/更短写法的分支，不改变最短长度。
- 半转在状态生成时按一次动作处理，与“半转计 1 步”的度量严格一致。
- **独立验证**：`bfs-check`/测试用一个不使用 PDB 的独立广度优先搜索交叉核对
  最短步数；测试还对深度 ≤3 的**全部**可达状态逐一比对 IDA* 结果。

### 预算与超时语义（不会把“没证完”说成结论）

`stopReason` 取值：`solved | node_budget | timeout | no_solution`。

- 达到 `maxNodes` 或 `timeoutMs` 时停止：`provenOptimal=false`，
  即使已返回某条路径，也**不**声称它最短；同时**不**把超时/超预算说成无解。
  响应附带中文说明提示需提高预算重试。
- 相同局面与相同配置（预算、超时、PDB 指纹）返回稳定结果；结果含
  搜索节点数、各轮深度界、根启发值、耗时与停止原因。

### 缓存与版本

- PDB 序列化为 `data/pdb-cache.bin`；文件头含算法版本与 **SHA-256 指纹**，
  指纹由转动表（排列/扭转表）内容派生。转动约定一旦改动，指纹不匹配即自动重建。
- 求解结果缓存于 SQLite，键为 `(状态, 参数 JSON, PDB 指纹)`；
  参数或 PDB 版本变化不会命中旧缓存。

## 5. HTTP API

所有请求/响应均为 JSON。错误统一为 HTTP 400/404/500 + `{error,message,detail}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health` | 健康检查、PDB 来源与指纹 |
| GET  | `/api/solved` | 复原态与角块表 |
| POST | `/api/states` | 导入局面 `{cp:[8],co:[8],label?}`（含合法性校验） |
| GET  | `/api/states` | 列出已保存局面 |
| POST | `/api/scramble` | `{seed,length}` 固定种子打乱 |
| POST | `/api/decode` | `{code}` 状态码转角块表 |
| POST | `/api/execute` | `{code,moves}` 对局面执行动作序列 |
| POST | `/api/solve` | `{code,maxNodes?,timeoutMs?,useCache?}` IDA* 求解 |
| POST | `/api/replay` | `{code,moves}` 逐步重放 |
| POST | `/api/verify` | `{code,moves}` 外部解法核验（含非法记号/未复原的首个问题） |
| POST | `/api/bfs-check` | `{code,maxDepth?}` 独立 BFS 验证最短步数 |
| GET  | `/api/solutions` / `/api/solutions/:id` | 查询解法记录 |

示例：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/scramble -ContentType 'application/json' -Body '{"seed":7,"length":6}'
Invoke-RestMethod -Method Post http://localhost:3000/api/solve    -ContentType 'application/json' -Body '{"code":"42760531/02000121"}'
```

## 6. CLI

```powershell
node dist/src/cli/index.js solved
node dist/src/cli/index.js scramble --seed 1 --length 12
node dist/src/cli/index.js import --cp 0,1,2,3,4,5,6,7 --co 0,0,0,0,0,0,0,0
node dist/src/cli/index.js execute --code 01234567/00000000 --moves "R U R'"
node dist/src/cli/index.js solve   --code 27645301/11111112
node dist/src/cli/index.js solve   --code 27645301/11111112 --max-nodes 1000000 --timeout-ms 5000
node dist/src/cli/index.js replay  --code 27645301/11111112 --moves "D' R F' D' B"
node dist/src/cli/index.js verify  --code 27645301/11111112 --moves "D' R F' D' B R"
node dist/src/cli/index.js bfs-check --code 27645301/11111112 --max-depth 8
node dist/src/cli/index.js states
node dist/src/cli/index.js solutions --id 1
node dist/src/cli/index.js demo
```

## 7. 数据与 SQLite 表

数据库文件：`data/pocketcube.sqlite`（可用任意 SQLite 工具打开）。

- `states`：局面（状态码唯一、cp/co、来源、标签、时间）
- `solutions`：解法记号、长度、是否证明最优、停止原因、节点数、深度界、
  根启发、耗时、逐轮迭代 JSON、**参数快照 JSON**、PDB 指纹、时间
- `action_logs`：打乱/导入/执行/求解审计日志
- `meta`：预留键值元数据

## 8. 目录结构

```
src/
  cube/      约定常量、状态变换、动作解析/逆序列、合法性、固定种子打乱
  search/    PDB 构建/序列化/指纹、IDA*、重放、外部核验、独立 BFS
  db/        SQLite 存储
  api/       零依赖 HTTP 服务
  cli/       命令行与 demo
test/        node:test 测试
scripts/     API 冒烟脚本
data/        SQLite 与 PDB 缓存（项目内，自动生成）
```

## 9. 验证结果与已知限制

- `npm run build`：TypeScript 严格模式编译通过。
- `npm test`：29/29 通过，覆盖复原态、单步、浅层多组打乱、深度 ≤3 全枚举的
  IDA*↔BFS 最短性一致、合法奇排列、单角非法扭转、重复/越界报错、
  节点预算与超时终止、外部错误解法首个问题、重启后读取同一结果、确定性。
- 二阶角块在固定整魔方朝向下约 3.67×10^6 个可达状态，上帝数为 11（HTM）。
  双 4 角 PDB 启发对常见局面毫秒级返回并证明最优；接近最深局面可能扩展较多节点，
  可用 `maxNodes`/`timeoutMs` 控制，此时按“尚未证明”如实报告。
- PDB 首次构建约 2 秒并缓存；删除 `data/pdb-cache.bin` 可强制重建
  （或 `node dist/src/cli/index.js pdb-build --force`）。
- 未实现：图形界面、颜色/贴纸识别、联网对战、WCA 随机态生成等（按需求刻意不做）。
