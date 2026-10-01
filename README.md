# 二阶魔方状态校验与最短复原后端

固定朝向的二阶（2×2×2）魔方离线分析服务。用 **八个角块的排列与朝向** 表示状态，支持从标准复原态输入转动序列生成局面、校验合法性、搜索并证明最短复原路径、逐步重放、核验外部解法，并把局面/解法/参数快照持久化到项目内的 SQLite。

仅提供 **HTTP API 与 CLI**，无图形界面、摄像头或联网功能。纯 TypeScript + Node.js，SQLite 使用 Node 内置的 `node:sqlite`，零第三方运行时依赖。

## 运行环境

- Windows，Node.js **>= 22.5**（开发验证于 Node v25.5.0）
- 不需要 Docker、WSL、任何付费或在线服务

## 安装与构建

```powershell
npm install
npm run build      # 编译到 dist/
```

模式数据库（约 2×24 万个抽象状态）会在首次求解时自动在项目内构建，约 3 秒；也可手动构建：

```powershell
npm run pdb:build
```

## 测试与演示

```powershell
npm test           # node:test 单元测试（合法性、求解、预算终止、BFS 对拍、持久化）
npm run demo       # 生成局面 -> 求解 -> 逐步重放 -> 错误解法核验 -> 重启读取 -> BFS 校验
```

## 启动 HTTP 服务

```powershell
npm start
# 自定义端口与数据目录（也可用 PORT）
$env:PCUBE_PORT="9000"; $env:PCUBE_DATA_DIR="E:\GSB\0193\A\data"; npm start
```

默认端口 `8787`，数据目录为项目内 `./data`（SQLite 与模式数据库都在此处）。

## CLI

```powershell
node dist/cli/index.js scramble --length 12 --seed 1
node dist/cli/index.js solve --scramble "R U F'" --time-ms 15000
node dist/cli/index.js replay --sequence "R U"
node dist/cli/index.js verify --scramble "R U" --solution "U' R'"
node dist/cli/index.js bfs-verify --scramble "R U F" --max-depth 6
node dist/cli/index.js get --id 1
node dist/cli/index.js pdb info
```

开发态可用 `npm run cli -- <参数>`（经 tsx 直接运行 TS）。

## 角块编号与朝向约定

角位置/角块编号（固定朝向，不允许用整体旋转“抵零步”）：

| 编号 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 角 | URF | UFL | ULB | UBR | DFR | DLF | DBL | DRB |

- `cp[i]`：位于角位置 `i` 的角块编号（0..7）。
- `co[i]`：该角块扭转量，取值 `0/1/2`。
- 标准复原态：`cp = [0..7]`，`co = [0,0,0,0,0,0,0,0]`。
- 面转动方向：从该面正上方俯视，顺时针记为 `X`，逆时针 `X'`，半转 `X2`。
- 支持 `U R F D L B` 六个面，共 18 个动作；**一次面转动计一步，半转也只计一步（HTM）**。

标准复原态示例：

```json
{ "cp": [0,1,2,3,4,5,6,7], "co": [0,0,0,0,0,0,0,0] }
```

## 合法性检查

1. 角块编号都在 `0..7`；
2. 八个角块 **恰好各出现一次**（重复/缺失分别报错）；
3. 所有朝向都在 `0..2`；
4. 八个朝向之和能被 `3` 整除（角块扭转守恒；单角扭转不可能）。

**不要求角块排列为偶排列**：单次面转动本身是 4-循环（奇排列），奇排列局面完全合法可解。

自洽性质（由测试覆盖）：同一四分之一转连续 4 次、半转连续 2 次、动作接其逆动作都回到原状态；非法符号、越界朝向、重复角块都会给出具体中文错误。

## 最短性方案与剪枝

- 搜索：**IDA\***，启发式 `h = max(两个模式库距离)`。
- 模式数据库：把 8 个角块分成两个互不相交的分区
  `{URF,UFL,ULB,UBR}` 与 `{DFR,DLF,DBL,DRB}`，在各自抽象空间（约 54 万个秩、实际可达约 24 万）内从复原态做完整 BFS，得到到目标的 **真实最短距离**。
- 可采纳性：任何完整解法投影到某个分区上都是一条等长合法路径，因此完整最优长度不短于每个库距离，故 `h ≤ 真实最优`，IDA* 不会漏掉最优解。
- 剪枝一（f 界）：`g + h > bound` 的分支不展开，因 h 可采纳而安全。
- 剪枝二（同面相邻动作）：相邻两个作用于同一张面的转动总能合并成至多一步，因此最短解中不会出现，删除不丢最优解。
- 后继按 h 升序尝试，仅影响找到解的先后，不影响完备性。

结果返回：解法动作、长度、是否证明最短 `optimal`、搜索节点数、历次深度界、最终界、耗时、初始启发值、停止原因。

停止原因语义：

- `solved_proven`：该深度界内完整搜索后找到解，**长度即最短**；
- `node_budget` / `time_budget`：预算耗尽，即使已经输出一条可行路径，也 **只表示尚未证明最短**，`optimal=false`，绝非“无解”；
- `depth_limit`：到达硬深度上限仍未能证明。

另外提供 `bfs-verify`：用与求解器独立的全空间广度优先枚举（建议 `--max-depth` ≤ 6）核对精确最短步数。已对深度 1–5 共 236,551 个状态全量对拍，IDA* 解长与 BFS 全部一致。

## 确定性、缓存与版本

- 固定种子打乱使用内置 mulberry32：相同种子+长度产生完全相同的动作序列。
- 相同局面与求解参数得到相同结果（搜索确定，无并发随机）。
- 模式数据库文件 `data/pdb/patterndb.bin` 含 magic、版本字符串（`pocketcube-pdb-v1`）与 SHA-256 校验和；版本不符、文件损坏或大小异常都会报错并自动重建。
- SQLite 位于 `data/pocketcube.db`，保存局面、打乱、解法、最优性、节点数、深度界、耗时、停止原因与参数快照。

## HTTP API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/solved` | 标准复原态 |
| POST | `/state/import` | 导入 `{cp,co}` 并返回角块表 |
| POST | `/state/validate` | 仅做合法性检查 |
| POST | `/scramble` | `{length,seed}` 固定种子打乱 |
| POST | `/from-solved` | 从复原态施加序列生成局面 |
| POST | `/execute` | 对给定局面执行动作 |
| POST | `/solve` | IDA* 求解（可选 nodeBudget/timeBudgetMs/maxDepth，默认落库） |
| POST | `/replay` | 逐步重放序列 |
| POST | `/verify` | 核验外部解法，返回首个问题 |
| POST | `/inverse` | 逆动作序列 |
| POST | `/bfs-verify` | 小深度独立 BFS 精确距离 |
| GET | `/analyses?limit=` | 历史分析列表 |
| GET | `/analyses/:id` | 按 ID 读取分析结果 |

示例：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/solve `
  -ContentType 'application/json' `
  -Body '{"state":{"cp":[6,3,7,5,4,1,2,0],"co":[2,0,0,1,0,2,1,0]}}'
```

## 已知限制

- 仅建模二阶角块（二阶魔方没有棱块/中心块），不包含整套转动记号中的整体旋转（x/y/z）；如需观察旋转请显式换算为面转动。
- 全空间直径 14 步；当前双分区模式库对多数随机局面可秒级求解并证明，少数最深局面可能需要调大节点/时间预算，此时结果明确标记为“尚未证明”，不会误报。
- BFS 独立校验枚举量随深度指数增长，建议深度 ≤ 6。
