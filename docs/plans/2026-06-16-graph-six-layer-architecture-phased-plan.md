# Graph Six-Layer Architecture Execution Plan

日期：2026-06-16

## 目标

落实 `docs/spark/2026-06-16-graph-six-layer-architecture-design.md`：把图谱从“旧 renderer 里集中处理很多事”的状态，推进到六层架构真正接管。

完成后，图谱必须成为一个边界清楚的独立交互模块：数据、布局、相机、渲染、手势、宿主协调各自有明确 owner。用户已经发现的缩放、拖拽、hover 漂移、文字被选中、节点被社区色块限制等问题，都必须作为同一类“图谱没有完全拥有自己的交互空间”的问题一起解决。

这不是 MVP 修补计划。每个阶段都必须拿走一块旧责任，不能只新增接口然后让旧逻辑继续决定行为。

## 源文档

- `docs/spark/2026-06-16-graph-six-layer-architecture-design.md`
- `docs/spark/2026-06-16-graph-interaction-geometry-design.md`
- `docs/plans/2026-06-16-graph-interaction-architecture-phased-plan.md`
- `docs/plans/2026-06-16-graph-interaction-architecture-progress.json`
- `AGENTS.md`
- `workbench/AGENTS.md`
- `workbench/PRODUCT.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/00-README.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/A-项目研究摘要.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/C-最终建议.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/D-模块边界.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/E-反模式清单.md`
- `/Users/kangjiaqi/Desktop/graph-architecture-research/F-落地路线.md`

## 规格评审

结论：可以执行。

- 阻塞决策：无。用户明确要求架构合理、长期正确、不要为了修一个 bug 引出另一个 bug。
- 路线已定：保留 DOM + SVG；不切 WebGL；使用完整六层；采用 continuous takeover；工作台与离线 HTML 同等验收。
- 分支策略已定：计划文件先留在当前分支；真正动代码前，从当前分支新开实现分支 `codex/graph-six-layer-architecture`。
- 测试策略已定：复用现有 Node 测试与 browser regression 脚本；默认不新增 npm package。若执行中证明必须引入新依赖，停止并说明原因和替代方案。
- 主要漂移风险：旧 `static-renderer.ts` 保留文件名后继续拥有交互、坐标或命中判断。本计划把旧责任清理列为硬验收。

## 任务规模

L 级 phased plan。理由：该工作跨共享图谱引擎、工作台宿主、离线 HTML、浏览器交互脚本、测试夹具和旧 renderer 清理，天然有阶段边界，预计会跨多个 `/goal` turn。

## 执行分支策略

计划写在当前分支 `codex/graph-interaction-architecture`。

实现开始前，第一项动作必须是从当前 HEAD 新开子分支：

```bash
git switch -c codex/graph-six-layer-architecture
```

如果该分支已存在，只有在它包含本计划提交、工作区干净、且没有无法分离的用户改动时才能继续；否则停止并报告。不要在 `main` 上执行本计划。不要先把当前分支合入 `main`。

第一个执行单元要做 clean-start commit：只记录“已在实现分支开始执行、基线 smoke check 通过”的 progress 更新，不写功能代码。

## 执行规则

- 执行分支：`codex/graph-six-layer-architecture`。
- 每个工作单元开始前运行基线 smoke check。
- 每完成一个已验证工作单元就提交一次，并把提交哈希记录到 `docs/plans/2026-06-16-graph-six-layer-architecture-progress.json`。
- 验证失败时不提交。
- 不自动 push、merge、amend。
- 阶段验收通过后直接进入下一阶段，不要求用户逐阶段确认。
- 执行者只能更新 progress 文件里的 status、verification、evidence、commit、decision_log、turn_log 字段；不能改写任务定义、验收标准或范围边界。
- 不新增 npm package、测试框架或配置来源；确实必须新增时停止并报告。
- 不把 graph-engine 行为复制到 workbench；共享行为必须留在 `packages/graph-engine/`。
- 不让 `static-renderer.ts` 继续成为新增图谱交互的入口。

## /goal 协议

每次继续工作时：

1. 读取 progress 文件，确认当前 phase/task。
2. 运行 `git log --oneline -15` 和基线 smoke check。
3. 只处理当前工作单元。
4. 验证通过后更新 progress、提交该工作单元、记录提交哈希。
5. 阶段验收全部通过后，记录阶段完成并进入下一阶段。

## Progress 文件

`docs/plans/2026-06-16-graph-six-layer-architecture-progress.json`

## 基线 Smoke Check

每个工作单元开始前运行：

```bash
npm run test --workspace=@llm-wiki/graph-engine
```

如果 smoke check 在原始状态已经失败，progress 必须记录失败输出，先修复与本计划相关的破损状态，再开始新工作。

## 完整验收命令

最终交付前运行：

```bash
npm run test --workspace=@llm-wiki/graph-engine
npm run typecheck --workspace=@llm-wiki/graph-engine
npm run build --workspace=@llm-wiki/graph-engine
npm run test --workspace=@llm-wiki-agent/web
npm run typecheck --workspace=@llm-wiki-agent/web
npm run build --workspace=@llm-wiki-agent/web
bash tests/graph-community-wash-interactions.regression-1.sh
bash tests/graph-workbench-interactions.regression-1.sh
bash tests/graph-offline-phase-6.regression-1.sh
```

最终交付还必须运行旧责任清理检查：

```bash
! rg -n "root\\.addEventListener\\(\"(wheel|pointerdown|pointermove|pointerup|pointercancel|lostpointercapture|dblclick)" packages/graph-engine/src/render/static-renderer.ts
rg -n "screenPointToWorldPoint|worldPointToScreenPoint|rootClientPointToScreenPoint|classifyGraphWheelTarget|classifyGraphPointerDownTarget|SpatialIndex" packages/graph-engine/src
```

第一条命令必须退出 0，表示旧 renderer 里找不到 root 图谱事件绑定；第二条命令必须显示这些能力由专门层使用，而不是由旧 renderer 直接重新接管。

## 实现面地图

### 共享图谱引擎

- `packages/graph-engine/src/index.ts`
- `packages/graph-engine/src/types.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/index.ts`
- `packages/graph-engine/src/render/geometry.ts`
- `packages/graph-engine/src/render/viewport.ts`
- `packages/graph-engine/src/render/state.ts`
- `packages/graph-engine/src/render/gestures.ts`
- `packages/graph-engine/src/render/simulation-bridge.ts`
- `packages/graph-engine/src/render/overlays.ts`
- `packages/graph-engine/src/render/community-wash.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/toolbar.ts`
- `packages/graph-engine/src/render/search.ts`
- `packages/graph-engine/src/sim/index.ts`
- `packages/graph-engine/src/sim/pins.ts`

### 计划新增或成形的模块

具体文件名由执行者按现有结构选择，但必须能映射到这六层：

- GraphData：现有 `types.ts`、`model/`、`graph-node.ts`，不拥有屏幕、hover、drawer、DOM。
- GraphLayout：从 `render/model.ts`、`sim/`、`community-wash.ts` 中收敛布局产物，并新增 SpatialIndex。
- GraphViewport：现有 `render/viewport.ts` 与 `render/geometry.ts`，作为唯一坐标转换入口。
- GraphRenderer：拆出节点、边、社区色块、minimap、overlay、toolbar、offline reader 等绘制模块。
- GraphGestures：现有 `render/gestures.ts` 继续扩展为唯一原始输入与意图分类入口。
- GraphFacade：从 `index.ts` 与 `static-renderer.ts` 中抽出协调层，保护 `createGraphEngine` 公开 API。

### 测试

- `packages/graph-engine/test/geometry.test.ts`
- `packages/graph-engine/test/viewport.test.ts`
- `packages/graph-engine/test/state.test.ts`
- `packages/graph-engine/test/gestures.test.ts`
- `packages/graph-engine/test/simulation-bridge.test.ts`
- `packages/graph-engine/test/overlays.test.ts`
- `packages/graph-engine/test/community-wash.test.ts`
- `packages/graph-engine/test/render-model.test.ts`
- 新增建议：`packages/graph-engine/test/spatial-index.test.ts`
- 新增建议：`packages/graph-engine/test/facade.test.ts`
- 新增建议：`packages/graph-engine/test/renderer-boundary.test.ts`

### 工作台与离线 HTML

- `workbench/web/src/components/GraphPanel.tsx`
- `workbench/web/src/components/RightDrawer.tsx`
- `scripts/build-graph-html.sh`
- `tests/browser/graph-workbench-interactions.mjs`
- `tests/browser/graph-offline-phase-6.mjs`
- `tests/browser/graph-community-wash-interactions.mjs`
- `tests/graph-workbench-interactions.regression-1.sh`
- `tests/graph-offline-phase-6.regression-1.sh`
- `tests/graph-community-wash-interactions.regression-1.sh`
- `tests/fixtures/graph-interactive-basic/`
- `tests/fixtures/graph-interactive-dense/`
- `tests/fixtures/graph-interactive-multicomm/`

## 架构流向

```text
GraphData
  -> GraphLayout
     -> world positions
     -> community wash geometry
     -> edge routes
     -> SpatialIndex
  -> GraphFacade
     -> GraphViewport camera
     -> GraphState runtime state
     -> GraphGestures intents
     -> GraphRenderer draw calls
     -> host callbacks
```

```text
Browser event
  -> GraphGestures
  -> SpatialIndex hit target when graph-owned
  -> graph intent
  -> GraphFacade
  -> GraphState / GraphViewport / GraphLayout update
  -> GraphRenderer paint
  -> host callback only for semantic actions
```

## 已有基础

- `render/geometry.ts` 已有显式坐标空间 helper。
- `render/viewport.ts` 已有相机、fit、pan、wheel zoom、resize、minimap viewport helper。
- `render/state.ts` 已有 runtime state 基础。
- `render/gestures.ts` 已有 target classifier 与 click/drag state machine。
- `render/simulation-bridge.ts` 已有 screen-to-world drag bridge。
- `render/community-wash.ts` 已有 capped wash 逻辑。
- `tests/browser/` 下已有 workbench、offline、community wash 的 browser regression。
- `static-renderer.ts` 仍有约 3000 行，并且仍直接绑定 wheel、pointer、dblclick、keydown、hover、click 等事件。这是本计划要继续接管和清理的核心。

## 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 实现分支何时开 | 计划提交后、实现第一步开 `codex/graph-six-layer-architecture` | 计划是文档，可留在当前分支；代码实现需要专用子分支，避免污染上一轮成果 |
| 渲染技术 | 继续 DOM + SVG | 当前问题是交互所有权，不是渲染吞吐瓶颈 |
| 测试依赖 | 默认不新增 npm package | 现有 Node tests 与 npx Playwright browser scripts 已覆盖主要验证面 |
| SpatialIndex 网格 | 初始 uniform grid cell = 96 world units | 当前世界尺寸 1000 x 680，96 可以让常见 30-90px 节点与边查询落在少量 cell 内，便于调试 |
| Edge 命中距离 | 初始 edge hit tolerance = 10 world units | 足够覆盖细边点击，同时不大到抢走节点与社区点击 |
| Node 命中 | 优先使用渲染模型中的节点交互 bounds；缺失时用 32 world units 半径兜底 | 命中逻辑应贴近用户看到的卡片，而不是只看中心点 |
| Community 命中 | 使用社区 wash 椭圆方程命中，节点命中优先于社区命中 | 社区色块可点选，但不能抢走节点拖拽与点击 |
| Community wash cap | 沿用现有默认上限：rx 不超过世界宽度 19%，ry 不超过世界高度 21% | 已有 capped wash 基础，先把它纳入架构测试与浏览器验收 |
| `static-renderer.ts` 终态 | 文件名可以保留为兼容 shell，但不能拥有原始图谱交互、坐标转换、命中判断或隐藏状态 | 用户要的是删除旧 renderer 责任；强删文件名不是目标，清掉旧所有权才是目标 |

## 失败模式与恢复

- 失败模式：trackpad pinch 仍触发浏览器页面缩放。恢复要求：GraphGestures 与 graph root 必须在 graph-owned surface 阻止默认浏览器行为，并通过 browser regression 证明 `window.devicePixelRatio` 和页面 zoom 未改变。
- 失败模式：快速松开拖拽后节点回弹。恢复要求：drag end 使用 intent 内最终 screen point 计算最终 world position，并在释放当帧提交 pin。
- 失败模式：空白拖动画布时选中工具栏文字。恢复要求：graph-owned surface 在 active pan/drag 期间禁止 native selection，toolbar 作为图谱控制不能泄漏浏览器选区。
- 失败模式：SpatialIndex 只是存在，但 DOM target 仍决定节点、边、社区、空白命中。恢复要求：删除或隔离旧 DOM hit classification，并用测试证明不同 DOM stacking 下命中一致。
- 失败模式：工作台通过了但离线 HTML 退化。恢复要求：任何 graph-engine 行为变更都跑 workbench 与 offline 两组 browser regression。

## 阶段计划

### Phase 0: 开实现分支与交互风险审计

目标：在专用实现分支上记录真实风险、现有覆盖、缺口和验证路径。此阶段不做功能修复。

实现面：

- `docs/plans/2026-06-16-graph-six-layer-architecture-progress.json`
- 新增建议：`docs/graph/2026-06-16-interaction-risk-audit.md`
- `packages/graph-engine/src/render/static-renderer.ts`
- `tests/browser/*.mjs`
- `tests/*.regression-1.sh`

任务：

1. `0.1` 创建 `codex/graph-six-layer-architecture` 子分支，运行基线 smoke check，提交 clean-start progress。
2. `0.2` 写交互风险审计，逐项记录 trackpad zoom、browser zoom、native selection、fast release、pointer cancel、toolbar/search/drawer/minimap 边界、hover anchor、data refresh、键盘和 touch 行为。
3. `0.3` 对照现有 Node tests 与 browser scripts，列出已覆盖和缺失覆盖，并给每个缺口分配目标 phase。

验收：

- `git status --short --branch` 显示当前分支是 `codex/graph-six-layer-architecture` 且无未分离用户改动。
- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- 风险审计文档存在，并且每一项都有 expected behavior、owner layer、verification method、target phase。
- progress 记录 clean-start commit hash。

自动前进：验收通过并记录后进入 Phase 1。

### Phase 1: GraphFacade 与六层边界成形

目标：公开 API 仍稳定，但 `createGraphEngine` 不再直接把所有协调责任压给旧 renderer。

实现面：

- `packages/graph-engine/src/index.ts`
- `packages/graph-engine/src/types.ts`
- `packages/graph-engine/src/render/index.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- 新增建议：`packages/graph-engine/src/facade/graph-facade.ts`
- 新增建议：`packages/graph-engine/test/facade.test.ts`
- 新增建议：`packages/graph-engine/test/renderer-boundary.test.ts`

任务：

1. `1.1` 抽出 GraphFacade，保护 `createGraphEngine(root, options)`、GraphEngine methods、capabilities 回调、workbench 与 offline 调用方式。
2. `1.2` 建立六层 owner map，在代码导出和测试中固定“谁拥有数据、布局、相机、渲染、手势、宿主协调”。
3. `1.3` 加边界测试，证明 host callbacks 不进入 GraphLayout/GraphRenderer，Renderer 不调用 gesture classifier，GraphFacade 是唯一知道 host callbacks 的层。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run build --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki-agent/web` exits 0。
- `packages/graph-engine/src/index.ts` 仍导出兼容的 `createGraphEngine`。
- `static-renderer.ts` 不能新增 host callback 协调责任。

自动前进：验收通过并记录后进入 Phase 2。

### Phase 2: GraphGestures 完全接管原始输入与浏览器默认行为

目标：wheel、trackpad、pointer、keyboard 的原始事件意义由 GraphGestures 决定，浏览器默认行为不能干扰 graph-owned surface。

实现面：

- `packages/graph-engine/src/render/gestures.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/state.ts`
- `packages/graph-engine/src/render/simulation-bridge.ts`
- `packages/graph-engine/test/gestures.test.ts`
- `packages/graph-engine/test/node-drag-lifecycle.test.ts`
- `tests/browser/graph-workbench-interactions.mjs`
- `tests/browser/graph-offline-phase-6.mjs`

任务：

1. `2.1` 把 root wheel/pointer/keyboard 绑定迁出旧 renderer，形成 GraphGestures controller；旧 renderer 只接收 intent 或状态。
2. `2.2` 实现 graph-owned surface default policy：节点、边、社区色块、空白、图谱工具栏都阻止冲突的 page zoom、text selection、native drag selection。
3. `2.3` 修正 fast release：drag end 使用 intent 的最终 screen point，经过 GraphViewport/Simulation bridge 提交最终位置和 pin。
4. `2.4` 补齐 pointercancel、lostpointercapture、Escape、click-vs-drag threshold、toolbar/search/drawer/minimap 边界测试。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- Browser evidence 证明 graph 内 trackpad-like wheel 不触发页面缩放，空白 pan 不产生 native text selection，快速释放拖拽能固定节点。
- `static-renderer.ts` 不再直接拥有 wheel/pointer 原始语义判断。

自动前进：验收通过并记录后进入 Phase 3。

### Phase 3: GraphViewport 与 GraphState 关闭坐标和状态回路

目标：坐标转换只走 GraphViewport/Geometry，hover、selection、focus、drag、pins、viewport 只走 GraphState。

实现面：

- `packages/graph-engine/src/render/geometry.ts`
- `packages/graph-engine/src/render/viewport.ts`
- `packages/graph-engine/src/render/state.ts`
- `packages/graph-engine/src/render/overlays.ts`
- `packages/graph-engine/src/render/simulation-bridge.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/test/geometry.test.ts`
- `packages/graph-engine/test/viewport.test.ts`
- `packages/graph-engine/test/state.test.ts`
- `packages/graph-engine/test/overlays.test.ts`

任务：

1. `3.1` 清除旧 renderer 中绕过 GraphViewport 的节点、边、hover、minimap、drawer resize 坐标计算。
2. `3.2` 让 active drag、hover target、selected item、focused community、pin snapshot、viewport 都由 GraphState snapshot 驱动。
3. `3.3` 处理 data refresh while dragging：结束 active gesture，关闭 hover，清理 stale selection/focus，保留可解析 pins。
4. `3.4` 补 browser checks：zoom、pan、drag、drawer resize 后 hover/edge preview 仍贴住目标。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- `rg -n "rootRect\\.width \\*|rootRect\\.height \\*|eventToGraphPoint|clientX.*WORLD|clientY.*WORLD" packages/graph-engine/src/render/static-renderer.ts` 无旧坐标计算命中。
- hover 卡片和边预览在缩放、平移、拖拽、抽屉 resize 后仍跟随目标。

自动前进：验收通过并记录后进入 Phase 4。

### Phase 4: GraphRenderer 拆分与 `static-renderer.ts` 瘦身

目标：renderer 只负责绘制，不再决定手势意义、坐标转换、状态所有权或 host 协调。

实现面：

- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/toolbar.ts`
- `packages/graph-engine/src/render/search.ts`
- `packages/graph-engine/src/render/legend.ts`
- `packages/graph-engine/src/render/preview.ts`
- 新增建议：node renderer、edge renderer、community renderer、minimap renderer、overlay renderer、offline reader renderer
- `packages/graph-engine/test/renderer-boundary.test.ts`

任务：

1. `4.1` 拆出 node、edge、community wash、minimap、overlay 绘制模块，并让它们只接收 snapshot 或 render model。
2. `4.2` 拆出 toolbar、search、legend、offline reader 绘制模块，明确哪些 control 是 graph control，哪些是 blocker。
3. `4.3` 把旧 renderer 缩成 composition shell；新增图谱交互不得再写入 `static-renderer.ts`。
4. `4.4` 增加 renderer boundary 检查，阻止 renderer 模块调用 gesture classifier、viewport conversion、host callbacks。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run build --workspace=@llm-wiki/graph-engine` exits 0。
- `static-renderer.ts` 不再包含 root wheel/pointer/dblclick listener 绑定。
- `static-renderer.ts` 不再包含 GraphGestures target classifier 调用。
- renderer boundary test exits 0，并证明绘制模块不会接管交互意义。

自动前进：验收通过并记录后进入 Phase 5。

### Phase 5: SpatialIndex 接管命中判断

目标：节点、边、社区色块、空白命中不再依赖 DOM stacking order。

实现面：

- 新增建议：`packages/graph-engine/src/layout/spatial-index.ts`
- 新增建议：`packages/graph-engine/test/spatial-index.test.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/gestures.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/test/gestures.test.ts`
- `tests/browser/graph-workbench-interactions.mjs`
- `tests/browser/graph-offline-phase-6.mjs`

任务：

1. `5.1` 实现 SpatialIndex 数据结构：uniform grid cell 96 world units，支持 node、edge、community wash、blank 查询。
2. `5.2` 把 SpatialIndex 作为 audit/check path 与旧 DOM target 对照，记录不一致场景并修正 index 数据。
3. `5.3` 切换 GraphGestures graph-owned hit testing 到 SpatialIndex；DOM target 只判断 text input、drawer、toolbar blocker 这类非图谱内容边界。
4. `5.4` 删除或隔离旧 DOM-order graph hit classification，并加测试证明 DOM stacking 改变不影响命中结果。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- `spatial-index.test.ts` 覆盖 node、edge、community wash、blank、overlap priority、out-of-world drag target。
- DOM stacking order 不再决定图谱对象命中。
- SpatialIndex 不是 audit-only；它是实际 graph hit-testing source。

自动前进：验收通过并记录后进入 Phase 6。

### Phase 6: Community wash 软边界完成

目标：社区色块是可点击、可被拖拽影响的视觉区域，不是节点拖拽围栏，也不能无限膨胀。

实现面：

- `packages/graph-engine/src/render/community-wash.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/state.ts`
- `packages/graph-engine/test/community-wash.test.ts`
- `packages/graph-engine/test/render-model.test.ts`
- `tests/browser/graph-community-wash-interactions.mjs`
- `tests/browser/graph-offline-phase-6.mjs`

任务：

1. `6.1` 固定 community wash caps：默认 rx 不超过世界宽度 19%，ry 不超过世界高度 21%，并用 fixture 证明单个远离节点不会拉爆画布。
2. `6.2` 让 dragged/pinned outlier 在 caps 内影响 wash，但不改变 community membership。
3. `6.3` 用 SpatialIndex 保持节点优先、社区色块次之、空白最后的命中优先级。
4. `6.4` 更新 workbench/offline browser checks：节点可被拖出 wash，wash 可有限变形，社区点击仍进入社区焦点。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-community-wash-interactions.regression-1.sh` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- 节点拖出社区色块后不会被自动锁回。
- 社区 membership 不因拖拽改变。
- Dense community 加一个 dragged outlier 仍可读。

自动前进：验收通过并记录后进入 Phase 7。

### Phase 7: 旧路径删除与双端最终验收

目标：清理旧 renderer 所有权，完成工作台与离线 HTML 双端验收。

实现面：

- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/`
- `packages/graph-engine/src/facade/`
- `packages/graph-engine/src/layout/`
- `tests/browser/`
- `tests/*.regression-1.sh`
- `docs/plans/2026-06-16-graph-six-layer-architecture-progress.json`

任务：

1. `7.1` 删除旧 renderer-owned pointer/wheel/keyboard/dblclick classification、手写坐标、DOM graph hit classification、隐藏 hover/drag/selection/focus state。
2. `7.2` 更新 browser regression evidence，覆盖桌面 1440x960、窄屏 390x844、离线 basic/dense/multicomm。
3. `7.3` 运行完整验收命令，记录输出摘要、artifact 路径、残余风险。
4. `7.4` 最终 progress 标记完成，记录最后一个提交哈希；不 push、不 merge、不 amend。

验收：

- 完整验收命令全部 exits 0。
- 旧责任清理检查通过：`static-renderer.ts` 不再拥有原始图谱交互、坐标转换或 graph hit testing。
- 工作台 browser regression 通过并记录 evidence artifact。
- 离线 HTML browser regression 通过并记录 evidence artifact。
- progress 文件 overall status 为 completed，residual risk 明确记录。

自动前进：此阶段完成后计划结束。

## 不在范围内

- 不迁移 WebGL、Pixi.js、Three.js、Canvas。
- 不引入图数据库、CRDT、事件溯源、LLM 自动重建图谱。
- 不新增 lasso selection、右键菜单、复杂多指编辑。
- 不让拖拽改变社区 membership。
- 不改知识库 markdown 数据结构。
- 不改 pi-agent 或 `node_modules/`。
- 不 push、merge、amend。

## /goal starter

```text
/goal Implement docs/plans/2026-06-16-graph-six-layer-architecture-phased-plan.md by following its execution ledger.

Each turn:
1. Read docs/plans/2026-06-16-graph-six-layer-architecture-progress.json, then the current task in the plan.
2. Run `git log --oneline -15` and `npm run test --workspace=@llm-wiki/graph-engine`; repair a broken state before starting new work.
3. Work only on the current work unit.
4. After verification passes: update the progress file status, evidence, and log fields only; commit that unit; record the commit hash. Never commit on failed verification. Never push, merge, or amend.
5. When a phase's acceptance checks all pass, record it and continue to the next phase without asking for approval.

Done when every item in the plan is complete, every acceptance check is proven, and the progress file records final status and residual risk.

Stop and report if a product decision is missing, the plan conflicts with the latest direction, or the worktree holds unrelated changes that cannot be safely separated.
```
