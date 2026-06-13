# 阶段四执行计划：monorepo 合并 + 图谱活地图

> 执行者：codex（`/goal` 机制）。验收人：Claude（作者的另一协作者，负责审查与验收，codex 不需要自行做最终视觉判定）。
> 日期：2026-06-12 ｜ 状态：待执行
> 进度账本：[2026-06-12-001-stage-4-monorepo-graph-atlas-progress.json](2026-06-12-001-stage-4-monorepo-graph-atlas-progress.json)

---

## 0. 目标与真理源

**目标**：把 llm-wiki-agent 仓库合并进本仓库形成 monorepo，并交付共享图谱引擎 `@llm-wiki/graph-engine` 与工作台"图谱活地图"（活模拟 + 钉扎 + 选区提问 + 生长动画），最后将 Skill 离线 HTML 切换到引擎产物。

**真理源（按优先级）**：

1. 设计文档 `stage-4-design.md`——Phase 0 完成前位于 `../llm-wiki-agent/docs/stage-4-design.md`，Phase 0 完成后位于本仓库 `workbench/docs/stage-4-design.md`（同一文件，subtree 搬入）。**所有 D1–D14 决策、§4 契约、§8 不做清单必须遵守。**
2. `workbench/PRODUCT.md` 的 ADR-20 / ADR-21（Phase 0 后可读）。
3. 本计划。本计划与设计文档冲突时以设计文档为准，并在 progress 的 `turn_log` 里记录冲突点；若冲突会改变产品方向，停下等待用户。

---

## 1. 工作环境与铁律

- 工作目录：**本仓库根**（llm-wiki-skill），分支 **`stage-4`**（已创建，本计划随分支提交）。
- 相邻仓库：agent 仓库位于本仓库同级目录 `../llm-wiki-agent`（仅 Phase 0 用到）。

**铁律（任何 turn 不得违反）**：

1. **不 push 任何远程、不开 PR、不合并到 main**——全程本地分支工作，发布由用户决定。
2. **本仓库根 package.json 禁止出现 `"type": "module"`**——`tests/js/*.test.js` 是 CommonJS，根上声明 ESM 会全炸（设计文档 R1）。ESM 声明只存在于 workbench 子包与 packages/graph-engine 自己的 package.json。
3. **不重写 `scripts/build-graph-data.sh`**——数据管线继续服役，工作台后端以子进程调用（D12）。
4. **新依赖白名单（分两层）**：
   - **运行时依赖**（严控）：仅 `d3-force`（packages/graph-engine）。条件性允许：`chokidar`（仅当 Phase 5 实测 `fs.watch` recursive 不可靠，需在 progress decision_log 记录证据）。白名单之外的运行时依赖 → 停下等待用户。
   - **工具链 devDependencies**（沿用即可）：`typescript` / `vite` / `tsx` / `concurrently` 及对应 `@types/*`——这些已在 workbench 使用，新包（graph-engine、monorepo 根）的 package.json 中声明它们**不算新增依赖**，版本与 workbench 既有版本对齐。这一层不需要停下。
5. **验证失败不 commit**。同一验证连续三次认真尝试仍失败 → 停下，在 progress 记录失败证据。
6. **隐私（每次 commit 前检查 staged 内容）**：提交内容中不得出现本地绝对路径（`/Users/...`）；统一用相对路径或 `~`。每次 commit 前跑 `git diff --cached -S "/Users/" --stat`（或等效 grep staged 内容），命中即清理后再提交。❗ 特别注意：`build-graph-data.sh` 会把**绝对 source_path 写进 graph-data.json**——演示 KB 的生成物（graph-data.json / 离线 HTML 产物）**一律不提交**，证据目录只收截图，且截图避免拍到含完整路径的画面。
7. **不动与本阶段无关的 Skill 主线文件**（SKILL.md、install.sh、ingest 相关脚本等）。本阶段允许触碰的 Skill 侧文件仅：`scripts/build-graph-html.sh`（Phase 6）、`templates/graph-styles/wash/`（Phase 6 标记 deprecated）、`tests/`（Phase 6 断言修订）。
8. 保护现场：本仓库已有未跟踪文件（`docs/solutions/...`、`test-report.md` 等）**不属于本计划**，不要提交、不要删除。

---

## 2. 每 turn 执行协议

```text
1. 读 progress.json：确认当前 phase / work unit / next_allowed_action。
2. 读本计划对应 Phase 小节 + 设计文档对应章节（每 Phase 开头列出）。
3. git status 检查现场，确认无计划外改动混入。
4. 只做当前 work unit。完成 → 跑该 WU 的验证命令 → 全过才 commit（用建议的 commit message）。
5. 更新 progress.json：WU 状态、真实 commit hash、验证结果、notes；追加 turn_log。
6. WU 全部完成且 Phase 验收全过 → 在 progress 标记 phase done，自动进入下一 Phase。
   Phase 边界不需要用户确认，总结一句继续即可。
```

---

## 3. 验证命令表（已核实可用）

| 面 | 命令 | 说明 |
|---|---|---|
| 主仓库 JS 单测 | `node --test tests/js/*.test.js` | CommonJS，必须始终全绿 |
| 主仓库回归 | `bash tests/regression.sh` | bash 断言集；Phase 0 与 Phase 6 必跑 |
| install 冒烟 | `bash install.sh --dry-run --platform codex` | Phase 0 必跑 |
| workbench 类型 | `npm run typecheck`（根） | 覆盖 server + web（workspace） |
| workbench 运行 | `npm run dev`（根，后台起）→ `curl -sf http://localhost:8787/api/knowledge-bases` + `curl -sf http://localhost:5180` → 杀进程 | dev 是长驻进程，验证用 curl 后必须清理进程 |
| 引擎单测 | `npm test -w @llm-wiki/graph-engine`（内部为 `node --import tsx --test test/*.test.ts`） | Phase 1 起存在 |
| 引擎构建 | `npm run build -w @llm-wiki/graph-engine` | 产出 `dist/engine.esm.js` + `dist/engine.iife.js` |
| 浏览器证据 | Playwright **不假设已存在**：Phase 2 首次需要时探测 `npx playwright --version`；可用则截图存 `docs/plans/stage-4-artifacts/`。凡计划要求 `file://` 自动浏览器验收时，允许改用只服务待验收产物所在目录的本地临时 HTTP 地址；这只是自动化访问方式，不改变"双击 HTML 可离线打开"的产品验收目标 | ❗ 探测失败时**不要自动下载浏览器**（体积超百 MB，须用户同意）：直接降级为 DOM/HTTP 断言，并在 progress 把该项标 `manual-acceptance`，留给验收人 |

**演示知识库**（Phase 2 起需要）：在 `~/llm-wiki/stage4-demo-kb/` 手工铺设最小结构——`.wiki-schema.md`、`index.md`、`purpose.md`、`log.md`、`wiki/` 下 8–12 个互相 `[[wikilink]]` 的 md（至少 2 个明显聚类 + 1 个孤岛页）。不进 git。Phase 7 后保留，供人工验收。

---

## 4. 实施面地图

```text
已有（搬运/调用，不重写）                     新建
─────────────────────────                ─────────────────────────
templates/graph-styles/wash/             packages/graph-engine/
  graph-wash-helpers.js (~1325行纯函数)     src/{model,render,sim,select,anim,themes}
  graph-wash.js (~1008行,取画法)            src/{types.ts,diff.ts,index.ts}
  header.html (~2001行,抽样式token)         test/（迁移自 tests/js）
scripts/build-graph-data.sh (子进程调用)
scripts/build-graph-html.sh (Phase 6改造)  workbench/web: 图谱视图壳+React薄壳+选区面板
tests/fixtures/graph-interactive-*        workbench/server: /api/graph* 4个端点
  （basic/dense/multicomm/empty 现成）                       + fs监听 + 重算队列 + SSE扩展
tests/js/*.test.js（迁移源,原件Phase 6前不删）
workbench(原agent): SSE通道 /api/events、  本仓库根: package.json (workspace根)
  @机制、/api/prompt、批量消化事件
```

数据流（Phase 5 形态）：

```text
KB文件变化(消化/结晶/agent补链/Obsidian手改)
  -> server fs监听(排除.wiki-tmp等, 防抖5s, 批量挂起)
  -> 单飞行重算队列 -> 子进程 build-graph-data.sh
  -> diff.ts(社区Jaccard对齐) -> SSE graph_updated{diff}
  -> web: 图谱可见?播生长动画 : 徽标+挂起队列(打开补播)
```

---

## 5. Phase 详细设计

### Phase 0：monorepo 搬家

> 读设计文档 §5 Step 0。本 Phase 完成前设计文档读 `../llm-wiki-agent/docs/stage-4-design.md`。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 0.1 | 在 `../llm-wiki-agent` 把 `stage-4-design` 分支合入本地 `main`（fast-forward 即可；**不 push**）。❗ 若沙箱限制无法操作邻仓库：停下，输出待执行的合并命令让用户手动跑，用户确认后验证结果再继续 | `git -C ../llm-wiki-agent log main --oneline -3` 包含 stage-4 设计 commit（`a69fa9b` 及其前驱） | 无（操作在邻仓库，账本记 notes） |
| 0.2 | 本仓库执行 `git subtree add --prefix=workbench ../llm-wiki-agent main`；随后隐私清理：`grep -rn "/Users/" workbench --include="*.md" --include="*.ts" --include="*.tsx" --include="*.json"`，命中项改相对路径或 `~`（node_modules 不会进来，已被 gitignore） | `workbench/docs/stage-4-design.md` 存在；`git log --oneline workbench/ \| head` 显示原 agent 历史；隐私 grep 清零 | subtree 自带 merge commit；清理另提交 `chore: scrub absolute paths from workbench` |
| 0.3 | 本仓库根建 `package.json`：`workspaces: ["workbench/server","workbench/web","packages/*"]`，scripts `dev`/`dev:server`/`dev:web`/`typecheck`（从原 agent 根上移，workspace 引用改用包名 `@llm-wiki-agent/server`、`@llm-wiki-agent/web`），devDependencies `concurrently`，**无 `type` 字段**；删 `workbench/package.json` 与 `workbench/package-lock.json`（已核实 server/web 子包各自带 `"type": "module"`，删除安全）；`.mise.toml`/`.nvmrc` 上移到根；合并 `.gitignore`；`npm install` 生成根 lockfile | ① `npm run dev` 起 → 两条 curl 通过 → 杀进程；② `node --test tests/js/*.test.js` 全绿；③ `bash install.sh --dry-run --platform codex` 通过；④ `npm run typecheck` 绿；⑤ 环境自检：`which jq && node --version`（jq 存在、node ≥22.19.0，缺失立即停下报告而非继续） | `chore: set up monorepo workspace root` |

**Phase 验收**：上表 4 条全过 + `bash tests/regression.sh` 全绿（确认 Skill 主线零破坏）。

### Phase 1：引擎包骨架 + helpers TS 化

> 读设计文档 §5 Step 1、§4.6、D14。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 1.1 | 建 `packages/graph-engine`：package.json（name `@llm-wiki/graph-engine`、`"type": "module"`、scripts test/build/typecheck）、tsconfig、vite lib 配置（ESM + IIFE 双 format，IIFE 全局名 `LlmWikiGraphEngine`）、`src/index.ts` 门面占位、`src/types.ts`（对照 `tests/fixtures/graph-interactive-basic/wiki/graph-data.json` 实际字段 + `build-graph-data.sh` 产出逻辑定义 GraphData/Node/Edge/Community/PinMap 类型） | `npm run build -w @llm-wiki/graph-engine` 产出两份 dist；typecheck 绿 | `feat(graph-engine): scaffold shared engine package` |
| 1.2 | `templates/graph-styles/wash/graph-wash-helpers.js` → `src/model/` 按职责拆模块（atlas 模型/视口数学/小地图映射/密度策略/标签文案），**1:1 翻译，逻辑零改动**；`tests/js/` 中针对 helpers 纯函数的测试迁移到 `packages/graph-engine/test/`（断言不改语义）；原 `tests/js/` 文件**不删**（旧模板 Phase 6 前仍服役） | `npm test -w @llm-wiki/graph-engine` 全绿；迁移的 **test case 数** ≥ 原对应文件 test case 数（`node --test` 输出的 tests/pass 计数；assertion 数不可直接测量，不作要求），原文件 → 新文件的映射清单记 progress notes | `feat(graph-engine): port atlas helpers to TS with tests` |

**Phase 验收**：引擎测试全绿 + 构建双产物存在 + 主仓库 `node --test tests/js/*.test.js` 仍全绿（原件未动）。

### Phase 2：工作台图谱视图——静态复现（安全网基线）

> 读设计文档 §5 Step 2、D2/D3/D4/D11（冷启动部分）、§4.4/§4.5。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 2.1 | `src/render/`：从 graph-wash.js 搬运画法（节点视觉分层/团块晕染），重组为可实例化结构（`createGraphEngine(container, opts)` 真实现：挂载/静态布局渲染/destroy）；`src/themes/`：从 header.html 抽 CSS token，山水主题完整 + 墨夜第一版；**顺手核查 header.html 内联脚本是否使用 d3/rough，结论写进 progress.decision_log**（决定 Phase 6 打包清单） | typecheck 绿 + 纯逻辑单测（token 解析、模型→可绘制结构的映射）全绿；DOM 级验证留 2.2 真浏览器 | `feat(graph-engine): static renderer and theme tokens` |
| 2.2 | workbench/web：侧栏"图谱"入口 + 主区域"对话 ⇄ 图谱"切换 + React 薄壳（useRef+useEffect 挂引擎，ESM 引入 workspace 包）；workbench/server：`GET /api/graph`（只读，无数据返回 `{needsBuild:true}`）+ `POST /api/graph/rebuild`（异步子进程跑 `scripts/build-graph-data.sh`，完成后经现有 `/api/events` 通道发 `graph_updated`（`diff:null` 最简版））。❗ server 定位仓库根（向上查找 `.git`）再调用 `scripts/build-graph-data.sh`，**不假设进程 cwd**（npm workspace 下 cwd 是包目录）；准备演示 KB（见 §3） | ① curl 剧本：GET 得 needsBuild → POST rebuild → 等待 → GET 返回节点数 >0；② dev 起，Playwright 打开工作台图谱视图截图存 `docs/plans/stage-4-artifacts/p2-workbench-graph.png`，同时对演示 KB 跑 `bash scripts/build-graph-html.sh`（旧管线）产出旧版 HTML 截图存 `p2-legacy-html.png`（两图供验收人对照）；③ 切换 KB 图谱跟随、构建中状态可见（DOM 断言）；无浏览器则降级（§3 规则） | `feat(workbench): graph view with static atlas rendering` |

**Phase 验收**：curl 剧本通过 + 两张对照截图存档（或降级标记）+ 浅/深切换图谱主题跟随（DOM class 断言）。**视觉一致性的最终判定属于验收人，codex 交付证据即可。**

### Phase 3：活模拟 + 钉扎 + 持久化

> 读设计文档 §5 Step 3、D8/D9/D10/D11、§4.1。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 3.1 | `src/sim/`：引入 `d3-force`（白名单依赖）；混合布局（预计算起点 + 低温入睡）；拖动低温让位（初值 alphaTarget=0.15，定稿值实测后回填 progress）；❗ 手绘/纹理路径一次生成缓存，帧只改 transform（D14 沸腾对策） | 引擎单测：布局状态机（冷启动坐标采用、入睡后 alpha=0、拖动中邻居坐标变化、远节点不变——用确定性种子断言）全绿 | `feat(graph-engine): live force simulation with low-heat drag` |
| 3.2 | 钉扎：松手即钉（fx/fy）+ 朱砂图钉标记 + 双击解钉 + 重置布局（toast 撤销，内存暂存旧 pins）；server：`GET/PUT /api/graph/layout`（整文件覆写 `.wiki-graph-layout.json`，§4.1 格式）；前端松手防抖写入；损坏容错（读不出当空） | 引擎单测：钉/解钉/重置撤销状态机；server 单测（`node --import tsx --test`）：layout 读写往返、损坏文件容错、路径 key 规范；curl：PUT→GET 往返一致；dev 实测刷新后钉位还原（Playwright 或标记 manual） | `feat(graph): node pinning with kb-local layout persistence` |
| 3.3 | 团块行为：拖动中淡化、定格后重晕染、不追离群钉点；顺手查证 `scripts/init-wiki.sh` 生成的 `.gitignore` 对 `.wiki-cache.json` 的处理，`.wiki-graph-layout.json` 对齐之（结论记 progress notes，倾向不排除） | 引擎单测：团块包络计算排除离群成员；typecheck 绿 | `feat(graph-engine): community wash behavior during drag` |

**Phase 验收**：拖动让位流畅（录屏或 manual 标记）+ 钉位重启还原 + 拖 A 进异色团块 A 颜色不变（DOM 断言）+ 损坏 layout 文件不崩。

### Phase 4：选区系统 + 对话联动

> 读设计文档 §5 Step 4、D5/D6、§4.5 capabilities。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 4.1 | `src/select/`：四式选择（点节点/点社区/+邻居一跳/Shift 多选）+ 选区结构事实计算（页数/内部链接数/社区数/孤立数）+ 性质→动作集映射（单社区/双社区/无链接多选/孤岛 四种剧本） | 引擎单测：用 multicomm fixture 断言四种选区的结构事实与动作集（无链接多选**不得**含"总结这一簇"） | `feat(graph-engine): structured selection with fact-aware actions` |
| 4.2 | 选区面板 UI（结构事实 + 动作按钮 + 自由输入 + 发送/新对话）；输入框选区胶囊 chip；展开模板定稿（TBD-4.2：对话历史保留胶囊态、悬停查看展开；展开文本=页面清单+链接关系+社区归属，正文由 agent 按需 read）；走现有 `/api/prompt` 文本通道 | **主验收（确定性）**：点社区→"总结这一簇"→server 侧断言发出的 prompt payload 包含选区页面清单与链接关系；"在新对话中打开"开新线程（API 断言）。**尽力项**：agent 真实回复非空——失败时（凭证/网络原因）不阻塞，标 `manual-acceptance` | `feat(workbench): selection panel and capsule prompt flow` |
| 4.3 | 反向联动：对话中出现 wiki 链接（复用阶段二既有识别逻辑）且图谱视图打开 → `focusNode` 高亮；capabilities 验证：不传 `onAsk` 时选区面板无提问动作（为 Phase 6 离线宿主铺路） | 引擎单测：缺 onAsk 时动作集不含提问项；dev 实测 focusNode 高亮（DOM 断言或 manual 标记） | `feat(workbench): chat-graph cross highlighting` |

**Phase 验收**：4.1 单测全绿 + 4.2 dev 剧本通过 + capabilities 裁剪生效。

### Phase 5：文件监听 + 重算链 + 生长动画

> 读设计文档 §5 Step 5、D12/D13、§4.3。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 5.1 | server：KB 目录监听（先用 Node 原生 `fs.watch` recursive 封装适配器；**起手先写 ~20 行脚本实测**嵌套目录创建/修改/删除事件，结论记 progress.decision_log——不可靠则引入 chokidar 白名单依赖并记录证据）；排除清单两类——**外部目录**：`.wiki-tmp/`/`.git/`/`.obsidian/`/`node_modules/`/`.DS_Store`；❗ **自家生成物（防自激循环）**：`wiki/graph-data.json`、`wiki/knowledge-graph*.html`、`.wiki-graph-layout.json`——重算写 graph-data、钉扎写 layout，不排除它们 = 监听器听到自己说话again触发重算，死循环；防抖 5s；批量消化 start 挂起 / done 立即触发；切库时停旧起新；单飞行重算队列（进行中合并 pending，最多一个） | server 单测（注入 fake watcher）：防抖合并、排除清单（**含生成物路径不触发**断言）、挂起/恢复、单飞行+pending 合并 全绿 | `feat(workbench): kb file watcher with rebuild queue` |
| 5.2 | 引擎包 `src/diff.ts`：新旧 GraphData 对比；❗ 社区 Jaccard 贪心配对后才判 recolored，配不上的进 `newCommunities`（设计文档 §4.3/R8）；server 重算完成后算 diff，`graph_updated` 升级携带真实 diff | 引擎单测：**社区编号洗牌 fixture 必测**（同一聚类换编号 → recolored 为空、newCommunities 为空）+ 新增/删除/真实变色/新社区四类各一例 + **分裂 fixture**（一社区裂二：重叠大的半边继承旧编号不变色，另半边进 newCommunities 走团块浮现）——共六类,到此为止不再扩 | `feat(graph-engine): graph diff with community alignment` |
| 5.3 | `src/anim/`：生长动画（新节点从邻居锚点发芽并由活模拟安置【呼应 D11 活会话策略：既有未钉节点不动】、孤岛淡入、新边墨线、变色渐变、删除淡出、新社区团块浮现；错峰，总时长 ≤3s，点击画布定格，`prefers-reduced-motion` 直接定格）；❗ diff 队列**状态机住引擎包**（anim/ 或独立模块，纯逻辑），web 层只订阅事件和调用——写进 React 组件则不可测；❗ 挂起队列只保留**净 diff**：新 diff 入队时与已挂起的合并（增后删的节点抵消、多次变色取首尾），补播永远只播一段 | 引擎单测：队列状态机四场景（可见消费/不可见挂起/拖动中挂起松手播/多 diff 折叠合并）；dev 总剧本：图谱关着 → 往演示 KB 的 wiki/ 新增 2 个带 [[链接]] 的 md（模拟 Obsidian 手改）→ ~5–10s 内徽标亮 → 打开图谱补播动画 → 3s 内定格（Playwright 录屏/截图序列，或 manual 标记）；reduced-motion 模拟下直接定格（断言无动画类） | `feat(graph): living atlas growth animation` |

**Phase 验收**：5.1/5.2 单测全绿 + 5.3 总剧本通过 + 批量消化期间无逐篇重算（server 日志断言挂起生效）。

### Phase 6：Skill 离线 HTML 切换引擎产物

> 读设计文档 §5 Step 6。本 Phase 是唯一触碰 Skill 主线脚本的 Phase，谨慎。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 6.1 | 改造 `scripts/build-graph-html.sh`：拼装 `packages/graph-engine/dist/engine.iife.js` + 主题 CSS + graph-data + 启动脚本（capabilities：persistPins→localStorage 适配器【沿用现有 per-wiki 命名空间】、不传 onAsk、onOpenPage 不传→引擎内置阅读态）；生成时读 `.wiki-graph-layout.json` 烤入钉位；打包清单调整：移除旧 `graph-wash*.js`，`d3.min.js`/`rough.min.js` 是否移除**以 Phase 2.1 核查结论为准**，marked/purify 保留 | 对演示 KB 构建 → 产物单文件 HTML 以 `file://` 或只服务生成目录的本地临时 HTTP 地址打开（Playwright/Browser）：图渲染、可拖动、刷新钉位仍在（localStorage）、**无**提问按钮；截图存 `docs/plans/stage-4-artifacts/p6-offline-html.png` | `feat(graph): offline html powered by shared engine` |
| 6.2 | `tests/` 回归断言**按新产物结构重写**——现有断言绑死旧产物（graph-wash 文件名、脚本拼接顺序、内部函数名），工作量按"重写文件级断言"预估而非"小修选择器"；❗ 东方设计合同的语义级断言——节点分层/索引签条/朱砂批注存在性——保留意图、按新 DOM 重写选择器，**不许删**；`templates/graph-styles/wash/` 加 DEPRECATED 注释头（不删，留一个版本周期）；`tests/js/` 中仅覆盖旧 helpers 的测试同批标注"随模板退役同周期删除"，保留的回归测试清单写 progress notes | `bash tests/regression.sh` 全绿；`node --test tests/js/*.test.js` 全绿 | `test(graph): migrate regression suite to engine output` |

**Phase 验收**：regression 全绿 + 离线产物四项断言通过 + 工作台侧 `npm run typecheck` 与引擎测试仍全绿（确认无回带破坏）。

### Phase 7：总验收 + 墨夜打磨 + 回填

> 读设计文档 §6 总验收 7 条、§7 TBD。

| WU | 内容 | 验证 | Commit |
|---|---|---|---|
| 7.1 | 墨夜主题精修（黑底/白墨/朱砂完整走查，深色工作台下无违和）；拖动手感参数定稿（TBD-4.1 数值回填 progress.decision_log） | 深色模式截图存 `p7-moye-theme.png`；typecheck + 引擎测试绿 | `feat(graph-engine): polish mo-ye dark theme` |
| 7.2 | 设计文档 §6 总验收 7 条逐条执行，每条证据（命令输出摘要/截图路径/commit hash）写入 progress `final_acceptance`；回填文档：`workbench/PRODUCT.md` §10 阶段四表打勾、`workbench/docs/stage-4-design.md` changelog 追加 v3（实施定稿：手感参数、header 核查结论、fs.watch 结论、gitignore 结论、TBD-4.2 模板定稿、**D12 监听排除清单补"自家生成物"三项**——本计划 5.1 已先行修正，设计文档同步）；不可自动验证项标 `manual-acceptance` 清单留验收人 | 7 条验收每条在 progress 有证据或 manual 标记；文档回填后 grep 自查无 TBD 悬空 | `docs: stage 4 acceptance evidence and design backfill` |

**Phase 验收**：progress.final_acceptance 完整 + 全部自动化检查（主仓库 JS 测试/regression/typecheck/引擎测试/构建）最后跑一轮全绿。

---

## 6. 已存在的能力（复用，不要重建）

- `tests/fixtures/graph-interactive-{basic,dense,multicomm,empty}/wiki/graph-data.json`——引擎单测与 diff 测试的现成数据
- workbench 既有：SSE `/api/events` 通道、`@` 引用机制、`/api/prompt`、批量消化的 start/done 事件（5.1 挂起信号源）、设置面板浅/深主题状态
- `node --import tsx --test` 测试模式（workbench/server 惯例，引擎包沿用）
- Playwright **不在仓库依赖中**（曾用于 PR #44 的临时验证，repo 内无配置）：按 §3 探测制使用，缺失不下载、走降级

## 7. Not in scope（出界即停）

设计文档 §8 全部清单，外加：SKILL.md 文案更新（工作流 8 描述，留品牌阶段）、push/PR/发布、旧 agent 仓库 archive、Tauri、跨库图谱、性能优化（Worker/canvas，按 R6 留触发条件）。

## 8. 失败模式与残余风险

| 失败模式 | 计划内的接法 |
|---|---|
| subtree 后 workspace 解析失败 | Phase 0.3 四条验证兜住；lockfile 统一到根（删 workbench/package-lock.json） |
| 根 package.json 意外带 type:module | 铁律 2 + Phase 0 验收里 CommonJS 测试全绿 |
| codex 环境无浏览器 | §3 降级规则：DOM/HTTP 断言 + manual-acceptance 标记，不阻塞推进 |
| fs.watch 不可靠 | 5.1 起手实测脚本 + chokidar 条件白名单 |
| 社区编号洗牌污染动画 | 5.2 洗牌 fixture 强制单测 |
| 手绘路径沸腾/掉帧 | 3.1 路径缓存写死；帧率问题记录留验收人（R6 不在本阶段修） |
| **残余风险** | 拖动手感与视觉一致性是主观项，codex 只交证据，定稿权在验收人；500+ 节点性能未实测（R6） |

## 9. 决策日志（plan 级，设计文档之外的新决策）

| 决策 | 理由 | 拒绝项 | 来源 |
|---|---|---|---|
| 引擎测试用 `node --import tsx --test` | 复用 workbench/server 既有模式，零新依赖 | vitest（新依赖） | 代码核实 |
| subtree 用本地路径 `../llm-wiki-agent` | 不依赖远程 push 状态 | GitHub URL | 用户 git 规则（不擅自 push） |
| 全程不 push 远程 | 用户全局规则 | — | 用户规则 |
| 删 workbench/package-lock.json，根统一 lockfile | npm workspace 只认根 lockfile | 保留双 lockfile | npm 机制 |
| 证据目录 `docs/plans/stage-4-artifacts/` | 截图/录屏可提交可审 | 散落 /tmp | 验收流程 |
| 视觉一致性判定权在验收人 | codex 不做主观判定，交对照证据 | codex 自评"看起来一致" | 分工 |
| 演示 KB 放 `~/llm-wiki/stage4-demo-kb` | 真实环境路径，验收人可直接复用 | /tmp（重启丢失） | 验收流程 |
| 监听排除自家生成物（graph-data/HTML/layout） | 重算与钉扎的写盘会自激触发重算，死循环 | 仅排除外部目录 | codex 外部声音 #1（2026-06-12 工程审查采纳） |
| 依赖白名单分"运行时/工具链"两层 | 单层白名单与建包必装构建工具矛盾，无人值守死锁 | 单一白名单 | codex 外部声音 #2（同上） |
| 隐私检查改为每 commit staged 内容 | graph-data 含绝对 source_path,一次性 grep 漏生成物 | 仅 Phase 0 一次性 grep | codex 外部声音 #8（同上） |

## 10. 漂移护栏（每 turn 自查）

1. 我在改的东西，属于当前 work unit 吗？
2. 本 turn 引入了白名单外的依赖吗？
3. 根 package.json 还干净吗（无 type:module）？
4. 我有没有把"实施时核实"项直接当成事实跳过了（header 核查 / fs.watch 实测 / gitignore 查证）？
5. progress.json 与真实 git log 一致吗（commit hash 真实存在）？

## 11. 完成定义

- progress.json 八个 Phase 全部 done，20 个 work unit 各有真实 commit hash（0.1 除外）或 manual 标记
- 设计文档 §6 七条总验收在 `final_acceptance` 有证据
- 全套自动化检查最后一轮全绿
- `manual-acceptance` 清单整理完毕，移交验收人
