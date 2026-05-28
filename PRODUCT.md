# llm-wiki-agent 产品文档

> 本文档是项目的**思路锚点**。当你（作者）或任何 AI 协作者思路断裂时，先读这份文档恢复上下文，再继续动手。
>
> **维护原则**：决策或功能定义变化时，**先改文档，再改代码**。文档与实现冲突时以文档为准。

---

## 0. 这份文档怎么用

- 作者是 0 代码基础的产品设计者。开发由 AI 协作完成。
- 文档不写代码细节，只写**意图、约定、决策理由**。
- 每个章节相对独立，可以单独读。
- 章节末尾若有 ❗ 标记，表示"动手前一定要看这里"。

---

## 1. 产品定位

### 1.1 一句话定位

**本地运行的知识库工作台。以对话为中心，通过 `@` 引用知识库内容、`/` 调用工具能力，把对话沉淀为可读可分享的产物（笔记、HTML、PPT、Word 等）。**

### 1.2 核心场景

用户打开 llm-wiki-agent，看到自己的若干知识库列表，选一个进入。在对话框里和 agent 对话：

- agent 知道当前在哪个知识库里，可以基于该库内容回答问题
- 输入 `@` 弹出页面列表，引用具体 wiki 页面进 prompt
- 输入 `/` 弹出命令列表，调用工具（搜索、消化新素材、生成 HTML/PPT/Doc）
- 对话结束后一键"结晶"为新的 wiki 页面，写回知识库
- 产出物（HTML/PPT/Doc）在右抽屉直接预览，一键下载或分享

整个工具运行在本地，所有知识库数据是本地 markdown 文件，零云依赖。

### 1.3 与 llm-wiki-skill 的关系

| 维度 | llm-wiki-skill（旧） | llm-wiki-agent（新） |
|---|---|---|
| 形态 | Anthropic Skill | 独立 agent + web UI（未来 Tauri 桌面应用）|
| 宿主 | Claude Code / Codex / OpenClaw / Hermes | 自有 runtime（基于 pi-agent）|
| 数据 | 用户的 wiki 目录 | **完全沿用，结构不变** |
| 能力 | Skill 内的脚本 + 模板 | **全部复用**，agent 通过 pi-agent 原生 Skill 加载机制调用 |

**关键事实**：pi-agent 原生实现 Anthropic Skill 标准。llm-wiki-skill 一行不改就能被 agent 项目加载使用。

**长期愿景**：当前 `llm-wiki-agent` 是**临时仓库**；agent 形态成熟后**并入 `llm-wiki` 仓库**作为 Skill 的升级版同时存在（保留 Skill 给纯 CLI 用户）。今天"agent 调 Skill"的边界 = 未来合并的过渡线。详见 ADR-16。

### 1.4 这个项目"不是什么"

为防止范围漂移，明确以下边界：

- ❌ 不是云端 SaaS（不部署线上、不替用户付 API 费用、不做多用户）
- ❌ 不是 Obsidian/Logseq 替代品（不做手写笔记编辑器，wiki 由 AI 维护）
- ❌ 不是通用 ChatGPT（必须基于知识库语境）
- ❌ 不是 Skill 的"加壳版"（是独立 agent 产品，Skill 只是能力来源之一）

---

## 2. 核心理念

### 2.1 Code is cheap，未来人视角

不为了"省事"做妥协的选型。技术栈按 5 年后仍说得通的标准来选。

### 2.2 桌面应用而非托管

托管 = 替用户烧 API 额度 = 必须先想清楚商业模式。本项目不走这条路。最终形态是 Tauri 打包的桌面应用。

### 2.3 Skill 即插即用

不重造轮子。任何符合 Anthropic Skill 标准的能力，丢到 skills 目录就生效：

- llm-wiki-skill（自家，知识库主线）
- [anthropics/skills](https://github.com/anthropics/skills)（17+ 个官方 Skill：docx / pdf / pptx / xlsx / doc-coauthoring / web-artifacts-builder / frontend-design / canvas-design / brand-guidelines / theme-factory / mcp-builder / claude-api / algorithmic-art / webapp-testing / skill-creator / internal-comms / slack-gif-creator）
- [pi-skills](https://github.com/badlogic/pi-skills)（web search、browser automation、transcription 等）
- 未来任何社区 Skill

### 2.4 对话中心

主屏永远是对话框。其他功能（图谱、库管理、产出预览）作为辅助面板，从对话发起或呼出。心智参考 Codex / Claude Desktop。

---

## 3. 架构总览

### 3.1 系统层次

```
┌─────────────────────────────────────────────┐
│ 前端 (Vite + React)                          │
│  浏览器 / 未来 Tauri webview                  │
│   ├─ 对话主区                                 │
│   ├─ 侧栏（知识库列表 / 历史 / 图谱入口）       │
│   ├─ 顶部状态条（当前知识库 / 模型 / 设置）     │
│   ├─ 右抽屉（产出预览 / 引用查看）             │
│   └─ @ / 自动补全                             │
└────────────────────┬────────────────────────┘
                     │ SSE (事件流) + HTTP POST (命令)
┌────────────────────▼────────────────────────┐
│ 后端 (Node + Hono)                           │
│  └─ pi-coding-agent SDK                     │
│      ├─ AgentSession  (对话/事件/会话管理)    │
│      ├─ Extension     (注入当前知识库等状态)   │
│      └─ Skills 加载                           │
│         ├─ llm-wiki-skill                   │
│         ├─ anthropics/skills                │
│         └─ pi-skills                        │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│ 本地文件系统                                  │
│   ├─ ~/llm-wiki/<name>/  (知识库默认根，沿用 Skill 结构)│
│   ├─ 外部知识库路径       (用户登记的任意路径) │
│   ├─ ~/.llm-wiki-agent/                     │
│   │   ├─ config.json     (UI 偏好/外部库登记) │
│   │   ├─ sessions/                          │
│   │   ├─ skills/                            │
│   │   └─ logs/                              │
│   └─ ~/.pi/agent/auth.json (模型凭证，pi 管理)│
└─────────────────────────────────────────────┘
```

### 3.2 技术栈

| 层 | 选型 | 简要理由 |
|---|---|---|
| 前端框架 | **React + Vite** | AI 协作样本量最大；新手坑最少；Tauri 零迁移 |
| UI 组件库 | 暂定 [shadcn/ui](https://ui.shadcn.com/) | 不是黑盒、可读、复制粘贴风格、深色主题原生 |
| 后端框架 | **Hono** | 轻量、TS 友好、文档清晰 |
| Agent runtime | **@earendil-works/pi-coding-agent** SDK | 原生 Skill 支持；事件流；多 provider |
| 通信 | **SSE + HTTP POST** | agent→UI 单向流，SSE 足够；WebSocket 过度 |
| 数据 | 本地 markdown + JSON | 无服务器；Obsidian 兼容 |
| 桌面打包（未来） | **Tauri** | 用系统 webview + Rust 后端；二进制和内存占用通常显著低于 Electron（5-30 MB vs 100+ MB） |
| 包管理 | npm（统一）| 不混用 pnpm/bun，避免新手版本混乱 |
| Node 版本管理 | **mise** 或 nvm | mise 是多语言版本管理（含 Node）；锁版本至少 `>=22.19.0`（pi-coding-agent 0.75.x 的最低要求） |
| Markdown 渲染（阶段二+）| **react-markdown** ^9 + **remark-gfm** ^4 | 生态最稳、类型完备、GFM 表格/任务列表/自动链接；shadcn 生态常用 |
| 命令/补全菜单（阶段二+）| **cmdk** ^1 | shadcn `<Command>` 底层；键盘导航与 a11y 完备；同时承载 `/` 命令菜单和 `@` 引用菜单 |

### 3.3 关键流程：一次对话发生了什么

> 下列路径（`/api/refs` 等）为**建议命名**，最终以实现为准。

```
1. 用户在对话框输入文本（可能含 @页面 或 /命令）
2. 前端检测到 @ → 调 /api/refs 拿当前库页面列表 → 弹出菜单 → 用户选中
3. 前端检测到 / → 调 /api/commands 拿已加载命令 → 弹出菜单 → 用户选中
4. 前端 POST /api/prompt，body 是展开后的完整文本
5. 后端调用 session.prompt(text)
6. session 通过 subscribe 推 agent 事件
7. 后端把事件 SSE 推给前端 /api/events
8. 前端按事件类型渲染（文本流、工具调用、引用预览…）
9. 用户可选触发 /sediment 把本次对话沉淀为 wiki 页面
```

❗ **关键点**：当前知识库的"上下文"不是通过 prompt 字符串拼接传递，而是通过 pi-agent 的 **Extension** 注入到 session state 里。这是干净做法。具体见 ADR-7。

### 3.4 pi-agent 的使用方式

**结论：pi-agent 作为 npm 依赖引入，不 clone 源码，不做 fork**。

具体含义：

```
llm-wiki-agent/                       ← 你的仓库
├── package.json                      ← 这里声明 "@earendil-works/pi-coding-agent": "^x.y.z"
├── node_modules/
│   └── @earendil-works/
│       └── pi-coding-agent/          ← pi 源码自动安装在这里，只读，不改
├── server/                           ← 你写的后端
│   ├── index.ts                      ← Hono 起服务
│   ├── agent.ts                      ← import { createAgentSession } from '@earendil-works/pi-coding-agent'
│   └── extensions/                   ← 你写的 Extension
└── web/                              ← 你写的前端
```

你"写"的代码：

1. 后端把 pi SDK 包装成 HTTP/SSE 接口
2. 一个或多个 Extension（注入"当前知识库"等应用状态）
3. 前端 UI

你"用"但不写的代码（全在 npm 包里）：

- agent runtime、Skill 加载、事件流、模型管理、会话持久化

升级 pi：改 `package.json` 里的版本号，`npm install` 重跑。

**Extension 注入方式**：pi-coding-agent CLI 会自动发现 `~/.pi/agent/extensions/*.ts` 下的全局 extension。**我们是 SDK 用户，不依赖那个机制**——而是把 extension 代码放在自己仓库的 `server/extensions/` 下，通过 SDK 暴露的 `bindExtensions()` 或自定义 `ResourceLoader` 显式注入 session。这样 extension 跟着我们项目走，不污染用户的 `~/.pi/`。

❗ 永远**不要**直接修改 `node_modules/` 里的 pi 源码。万一极端情况需要 patch（99% 用不到），用 `patch-package` 做局部补丁，保持升级路径干净。

❗ pi-coding-agent 0.75.x 要求 **Node `>=22.19.0`**。用 mise/nvm 锁定到合适版本，避免系统 Node 太旧。

---

## 4. 功能阶段路线

每个阶段：**目标 → 范围 → 不包含 → 验收**。验收不过不进下一阶段。

### 阶段一：主干打通（最小可用） ✅ 已完成 2026-05-26

**目标**：验证"前端 ↔ 后端 ↔ pi-agent ↔ Skill ↔ 文件系统"全链路。

**范围**：
- 一行命令拉起本地服务（`npm run dev` 启动后端 + 前端）
- 浏览器打开 `localhost:xxxx`，看到知识库列表
  - 自动扫描 `~/llm-wiki/` 下含 `.wiki-schema.md` 的子目录
  - 支持手动"添加现有库"指向任意路径（如 `~/Documents/AI学习知识库`）
  - 注册过的库存在 `~/.llm-wiki-agent/config.json`
- 点击一个知识库进入对话界面
- 顶部状态条显示当前知识库名
- 同库内支持多个并行对话，侧栏列出，"+ 新对话"按钮在顶部
- 切库自动保存当前对话，打开目标库最近活跃的对话
- 对话框可输入，流式接收 agent 回复
- agent 通过 Extension 知道当前知识库路径
- 对话历史持久化（pi-agent SDK 原生功能）

**不包含**：`@` 补全、`/` 命令、图谱、产出能力、消化新素材、新建知识库 UI。

**验收标准**：
1. 在 "AI学习知识库" 里问"这个库里有哪些主题"，agent 调用 `read` 工具读 `index.md`，给出准确回答
2. 切到另一个库再问，对话上下文完全切换
3. 同一库内开两个对话，互不污染
4. 关闭浏览器再打开，自动选中最近对话，历史完整

**完成情况** ✅ 2026-05-26（最终 commit `dd021bc`）

- 8 个 step commit + 2 个 review 修补 commit，详见 §10 进度追踪
- 范围全部交付；4 项验收标准实测全通（验收 1 实测中 agent 用 `list_knowledge_base_pages` Extension 工具回答，效果等价于读 `index.md`，更精准）
- **接受的妥协（不阻塞阶段二）**：
  - §5.2 顶部 "⚙ 设置" 按钮仅占位（disabled + tooltip）—— 完整设置面板在阶段二
  - §5.1 侧栏底部"图谱入口"未实现 —— 作者要重新构思图谱设计，推迟到阶段四
  - 默认模型不强制 Sonnet，沿用 pi-agent 用户设置（见 TBD-2）
- **启动 & 运行速查**（compact 后从这里恢复上下文）：

| 维度 | 值 |
|---|---|
| 一行启动 | `npm run dev`（从仓库根；用 `concurrently` 同时起前后端）|
| 后端端口 | `8787`（`server/src/index.ts`，Hono）|
| 前端端口 | `5180`（`web/vite.config.ts`，`strictPort: true`，冲突直接报错而非漂移）|
| 启动耗时 | ~2-5s（pi ResourceLoader + `bootstrapFromConfig` 自动恢复）|
| 默认模型 | 由 `~/.pi/agent/settings.json` 决定（不由本项目强制；作者当前为 `zai/glm-5.1`）|
| 自动恢复 | `selectKb` 写 `~/.llm-wiki-agent/config.json` 的 `lastUsedKbPath`，server 启动 `await bootstrapFromConfig()` |
| 知识库 | 默认根 `~/llm-wiki/` + 外部登记（`config.externalKnowledgeBases[]`）|
| 会话目录 | `~/.llm-wiki-agent/sessions/<sha256-of-kb-path>/*.jsonl`（pi `SessionManager` 管理）|
| Extension 工具 | `current_knowledge_base()` / `list_knowledge_base_pages()`（仅这俩，阶段二补 `@`/`/`/`/sediment` 等）|
| 已知 endpoints | 13 个，列表见 `server/src/index.ts` 顶部注释 |
| Node 版本要求 | `>=22.19.0`（pi-coding-agent 0.75.x 硬要求，仓库根 `.mise.toml` / `.nvmrc` 锁定）|

### 阶段二：核心循环（@、/、结晶、消化）✅ 已完成 2026-05-27

**目标**：让"对话 → 沉淀"形成闭环。

**范围**：
- `@` 补全菜单：弹出当前库的页面/实体/主题列表，选中后插入 wiki 链接
- `/` 命令菜单：列出所有已加载 Skill 命令 + 内置命令
- 内置命令 `/sediment`：把当前对话或选中片段沉淀为 `wiki/synthesis/sessions/` 下的页面
- 内置命令 `/new-wiki`：app 内新建知识库（输入名字 + 研究方向 → 调用 llm-wiki-skill 的 init 流程 → 在 `~/llm-wiki/` 下生成完整目录）
- 引用预览：对话里出现的 wiki 链接可点击，右抽屉打开该页面
- 消化新素材：把链接或文件路径丢给 agent → 触发 llm-wiki-skill 的消化流程
- 设置面板 UI（三层认证 + 偏好）：
  - 登录方式区：检测 pi CLI auth.json 状态 / 填 API key（写入 pi 的 auth.json）/ 显示环境变量状态
  - 默认模型、UI 偏好、知识库根目录、外部库管理（添加/移除）

**验收标准**：完整跑通——
1. 在 app 内点"+ 新建知识库"，输入名字和方向 → 自动创建 → 出现在列表里
2. 丢一篇文章链接 → agent 消化进库 → 在对话里基于这篇讨论 → 一键结晶为新页面 → 在 `wiki/synthesis/sessions/` 目录里能看到新文件
3. 在 UI 里填一个 Anthropic API key → 测试连接成功 → key 出现在 `~/.pi/agent/auth.json`，未泄露到 `~/.llm-wiki-agent/`

### 阶段三：产出能力（产品亮点）✅ 已完成 2026-05-27

**目标**：把"内容产出"做成视觉冲击力强的功能，作为产品宣传点和小白吸引力来源。

**范围**：
- 挂载 anthropics/skills 中的产出类 Skill（docx / pdf / pptx / xlsx / web-artifacts-builder 等）
- 挂载或自建 HTML 产出 Skill（生成单文件分享 HTML）
- 对话中可要求 "把这次讨论做成 PPT" / "导出为 docx" / "生成分享 HTML"
- 右抽屉支持预览：
  - HTML 直接 iframe 展示
  - PPT 用浏览器内 PPTX 渲染库（如 PPTXjs 或类似方案，**具体库阶段三选型时再定**）
  - docx 显示元数据 + 下载按钮（不强求浏览器内渲染）
- 一键导出到本地下载目录

**验收标准**：一次对话能产出 HTML、PPT、docx 三种格式，且 UI 内可直接预览或下载。

### 阶段 3.5：导航 UX 重构 + 多模型子代理批量消化 ✅ 已完成 2026-05-27

**背景**：阶段 1-3 完成后作者实际使用 app 发现两类痛点——
1. **导航 UX 反直觉**：侧栏强行把 KB 分成默认/外部两类（与"KB = 项目"心智冲突）、对话挂在侧栏中间看不出从属、"添加现有库"靠手输绝对路径常常失败、拖入非 wiki 目录直接报错
2. **批量消化效率低**：阶段二的消化是"一次喂一篇"；TBD-2"多模型路由"也一直挂着没有承载场景——批量消化正好是

**目标**：
1. **导航统一**：侧栏一栏到底、KB 可展开对话子树、拖拽优先添加路径、非 wiki 目录提供"一键初始化 + 批量消化"路径
2. **子代理批量消化**：基于 pi SDK 的 `createAgentSession` + 多模型注册落地"消化角色 → cheap / 聊天角色 → main"双角色路由；用一个 30 行的并发控制函数调度 N 个子代理并行处理 N 个文件，通过 SSE 推送进度

**范围**（7 step）：
- 侧栏重构：统一 KB 列表 + 折叠对话子树（去 default/external 分隔）
- 拖拽 + 输入框双通道：HTML5 drag 先探测能否拿到真实路径，输入框兜底 + inspect 端点判定是不是 wiki
- 非 wiki 目录初始化引导：弹窗提示 + 就地初始化 `.wiki-schema.md` + `index.md`
- 多模型双角色：`config.json` 新增 `modelRoles: { main, digest }` + 设置面板选择
- 后端子代理批量消化框架：30 行 `mapWithConcurrencyLimit` + `SessionManager.inMemory()` + 共享 `authStorage`/`modelRegistry`
- 批量消化 UI + SSE 进度推送：浮窗实时显示每个子代理的"排队/进行中/完成/失败"
- 总验收 + UX 体感打磨

**不包含**：图谱（阶段四）、Tauri 打包（阶段五）、媒体创作 / 浏览器扩展（阶段后规划）、子代理嵌套 / 工作树隔离（omp 那一套）

**验收标准**（5 条）：
1. **侧栏统一**：KB 列表一栏到底无 default/external 分隔；点当前 KB 名可展开/收起对话子树，点未选中 KB 会切换并展开；外部 KB 用文字 badge 而非分区
2. **拖拽添加**：从 Finder 拖文件夹到 dialog 拖拽区；若浏览器暴露真实 `file://`，路径自动填入输入框；若不暴露，UI 明确提示用户粘贴路径（不立即提交，给用户最后修改机会）
3. **非 wiki 兜底**：拖入无 `.wiki-schema.md` 的目录，弹"是否初始化并批量消化"对话框；选"是"→ 后台跑 init + 子代理并行消化
4. **多模型双角色**：设置面板新增"模型分配"区，main / digest 两个角色各自的 provider+model；digest 写入 `config.json` 后对新批量消化立即生效，main 写入后当前主对话立即重载并使用该模型
5. **并发消化**：批量消化 10 个 `.md` 文件能看到 ≥3 个子代理同时跑（默认并发=3），SSE 实时推送状态，全部完成后右抽屉刷新出新增的 wiki 页面

**完整设计**：[docs/stage-3.5-design.md](docs/stage-3.5-design.md)（含 7 step 细则、13 项关键决策、5 个 TBD、API 契约、验收剧本）

**完成情况**：
- 侧栏已统一为一栏 KB 列表，当前 KB 可点击展开/收起对话子树，外部库用 badge 标记
- 添加现有库支持拖拽探测、路径输入、目录检查；非 wiki 目录可就地初始化并可接着批量消化
- 设置面板新增 main / digest 角色选择；digest 角色用于批量消化，main 角色用于主对话并在切换后立即刷新生效
- 批量消化使用 pi SDK 原生 in-memory 子会话，并发档位为 1 / 3 / 5，通过 SSE 推送进度
- **新增依赖**：无

### 阶段四：图谱集成

**目标**：把 llm-wiki-skill 现有的知识图谱集成进工作台。

**范围**：
- 侧栏"图谱"按钮 → 主区域切换为图谱视图（对话区暂时收起或并排）
- 图谱节点点击 → 切换回对话视图，自动在输入框 @ 该页面
- 图谱保持 Skill 当前的视觉风格（数字山水图谱）
- 进阶（可推后）：agent 提到 A 概念时，图谱视图自动高亮 A 节点

**验收标准**：图谱不再是孤立 HTML，而是工作台的有机部分；从图谱发起对话流畅自然。

### 阶段五：桌面应用打包（Tauri）

**目标**：跨平台桌面应用安装包。

**范围**：
- Tauri 项目初始化
- 后端嵌入 Tauri sidecar 进程
- macOS / Windows / Linux 三平台构建
- 安装包自动化产出（CI 可选）
- 安装后开箱即用，无需用户配 Node 环境（API key 仍由用户填）

**验收标准**：双击 .dmg / .msi / .AppImage 安装即可使用。

### 阶段后规划（暂不锁定，记录想法）

- 浏览器扩展：当前页面一键消化进库
- 多模型路由：按任务类型自动切（消化用便宜模型、深度对话用强模型），与 pi-agent provider 体系打通
- 全局快捷键 / 系统托盘
- 主题与自定义样式
- 多端同步（如果未来真有需求）

---

## 5. UI 设计原则

### 5.1 三栏布局

```
[ 侧栏 270px / 52px 窄栏 ] [ 主区域 自适应 ] [ 右抽屉 0 / 可拖动宽度 / 全屏 ]
```

- **侧栏**默认显示：
  - 知识库列表（顶部，含"+ 新建知识库"按钮）
  - 当前库的对话列表（中部，含"+ 新对话"按钮，按最近活跃排序）
  - 图谱入口、设置入口（底部）
- **侧栏可折叠为窄图标栏**：保留展开、当前知识库、刷新、新建、添加、设置入口；图标悬停显示文字提示。该状态保存在本机。
- **主区域**永远是对话（除非用户主动切换到图谱）
- **右抽屉**默认隐藏，呼出场景：产物预览、引用页面查看、设置面板。右抽屉宽度可拖动调整，双击拖动边缘恢复默认宽度；宽度保存在本机。小屏幕下不启用拖动，继续占满屏幕。

### 5.1.1 会话与切换行为

- 会话**绑定到知识库**：每个库有独立对话列表，不允许跨库会话
- 同库内**多个并行对话**：用户随时"+ 新对话"开新线程
- 切换知识库：当前对话自动保存 → 切到目标库 → 自动选中目标库最近活跃的对话
- App 启动：自动选中"最后一次使用的库 + 该库内最近活跃的对话"
- 全程自动保存，无"是否保存"弹窗

### 5.2 顶部状态条

```
[📚 当前知识库 ▼]   [🤖 模型 ▼]   [⚙ 设置]
```

永远可见，回答"我在哪里"。

### 5.3 `@` 与 `/` 的设计契约

| 符号 | 语义 | 弹出内容 | 选中后 |
|---|---|---|---|
| `@` | **引用** | 当前知识库的页面 / 实体 / 主题 | 在输入框插入 wiki 链接，agent 看到时会读这页 |
| `/` | **执行** | 所有已加载 Skill 命令 + 内置命令 | 在输入框插入命令调用，agent 收到时执行 |

两者必须有清晰区分。**`@` 是"找内容"，`/` 是"做事情"**，永远不要混用。

### 5.4 视觉风格

- 默认深色模式，支持浅色 / 深色切换，用户选择只保存在本机
- 等宽字体：JetBrains Mono / SF Mono
- 中文 UI 字体：系统字体（San Francisco / Microsoft YaHei / PingFang）
- 工具感优先，不追求"产品级精致"。参考 Codex / Claude Desktop / Linear
- 阶段 3.5 收尾吸收本地 UI 原型：统一侧栏、状态条、对话区、输入区、菜单、抽屉和设置面板的工作台视觉，不改变既有三栏心智和功能范围

### 5.5 严禁项

- 不做 onboarding 引导浮层
- 不做 emoji 滥用
- 不做"AI 正在思考..." 这种空白等待动画（用真实事件流：tool 调用状态、流式文本）
- 不强制注册 / 登录（本地工具不需要账号）

---

## 6. 数据与目录约定

### 6.1 知识库存储策略（混合模式）

用户需要管理多个领域的知识库（AI 学习、工作材料、设计灵感等），不该被强制塞到一个固定位置。采用**默认根目录 + 外部目录登记**的混合模式：

| 类型 | 位置 | 说明 |
|---|---|---|
| **默认知识库根** | `~/llm-wiki/` | App 首次启动自动创建；app 内"+ 新建知识库"在此建子文件夹 |
| **外部知识库** | 用户任意路径 | 用户手动"添加现有库"指向某路径，登记在 `config.json` |
| **应用数据** | `~/.llm-wiki-agent/` | 配置、会话、日志、Skill，用户通常不直接碰 |

**为什么默认是 `~/llm-wiki/` 而不是 `~/Documents/...`**：

- macOS 的 `~/Documents/` 会被 iCloud Drive 自动同步，会撕坏 `.wiki-cache.json` 的文件锁和"写入即更新"逻辑
- 知识库是顶级资产，值得一个顶级目录，不该埋在 Documents 深处
- 短路径友好：终端 `cd ~/llm-wiki` 一秒到达

**发现机制**：
- 启动时扫描 `~/llm-wiki/` 下所有含 `.wiki-schema.md` 的子目录 → 自动注册
- 再读 `config.json` 里登记的外部库路径 → 加入列表
- 失效路径（外部库被删/移走）：UI 标记为灰色，提示用户移除登记

### 6.2 知识库目录结构（沿用 llm-wiki-skill）

每个知识库内部结构与 Skill 完全一致：

```
<某知识库>/
├── raw/                # 原始素材（子目录如 articles/tweets/wechat/xiaohongshu/zhihu/pdfs/notes/assets
│                       # 由 Skill init 时创建，agent 不强求子目录约定，沿用现有结构）
├── wiki/               # AI 生成内容
│   ├── overview.md     # 知识库总览（init 时生成）
│   ├── entities/       # 实体页
│   ├── topics/         # 主题页
│   ├── sources/        # 素材摘要
│   ├── comparisons/    # 对比分析
│   ├── synthesis/      # 综合分析
│   │   └── sessions/   # 对话结晶（agent 新增的对话沉淀都进这里）
│   └── queries/        # 保存的查询结果
├── purpose.md          # 研究方向
├── index.md            # 索引
├── log.md              # 操作日志
├── .wiki-schema.md     # 配置（识别"这是个知识库"的标志文件）
├── .wiki-cache.json    # 素材去重缓存
├── .wiki-tmp/          # Skill 运行时临时目录（agent 不读不写，Skill 的 .gitignore 已排除）
└── .gitignore          # init 时生成，至少排除 .wiki-tmp/
```

❗ agent 项目**不重新设计这个结构**。完全沿用 Skill 现有约定，确保两边互通。
❗ 结构以 `scripts/init-wiki.sh` 为权威，不要在 PRODUCT.md 里手动维护差异。

### 6.3 应用数据目录

```
~/.llm-wiki-agent/
├── config.json         # UI 偏好、默认模型、外部库登记 —— 不存任何 API key
├── sessions/           # pi-agent 会话持久化（对话历史）
├── skills/             # 软链接或拷贝到此目录的 Skill
│   ├── llm-wiki/       # → 链接到 llm-wiki-skill 安装位置
│   ├── docx/           # 来自 anthropics/skills
│   └── ...
└── logs/
```

**模型认证不在这里**。所有模型凭证由 pi-agent 统一管理，存在：

```
~/.pi/agent/auth.json    # pi-agent 的认证文件，权限 0600
```

❗ **应用数据 ≠ 知识库数据 ≠ 模型凭证**，三类彻底分离：

| 类型 | 位置 | 谁管 |
|---|---|---|
| 知识库数据 | `~/llm-wiki/<name>/` 或外部路径 | 用户 + agent |
| 应用数据 | `~/.llm-wiki-agent/` | llm-wiki-agent |
| 模型凭证 | `~/.pi/agent/auth.json` | pi-agent SDK |

❗ `.gitignore` 排除 `~/.llm-wiki-agent/`。**永远不要**把 API key 写进任何源代码或仓库文件。详见 ADR-13。

### 6.4 Obsidian / 第三方工具共存规则

很多用户（包括作者本人）用 Obsidian 浏览同一份知识库。两者必须零冲突。

**agent 读写的文件**：
- ✅ `raw/` 下任意文件
- ✅ `wiki/` 下任意 `.md` 文件
- ✅ `purpose.md` / `index.md` / `log.md`
- ✅ `.wiki-schema.md` / `.wiki-cache.json`

**agent 完全忽略的文件 / 目录**：
- ❌ `.obsidian/`（Obsidian 元数据）
- ❌ `.DS_Store`（macOS）
- ❌ `*.base`（Obsidian Bases）
- ❌ `*.canvas`（Obsidian Canvas）
- ❌ `.wiki-tmp/`（Skill 自用的临时目录）
- ❌ `node_modules/`、`.git/`、`venv/` 等所有 dev 类目录
- ❌ 任何非 markdown、非 Skill 约定内的文件

用户用 Obsidian 编辑 markdown、画 Canvas、做 Base，agent 都不会碰。

### 6.5 运行时应用状态（由 Extension 持有）

- `currentKnowledgeBase`：当前打开的知识库绝对路径
- `currentConversationId`：当前对话的 ID（pi-agent 会话）
- `pinnedReferences`：当前对话固定引用的页面列表
- `activeSkills`（可选）：本次会话允许的 Skill 子集

### 6.6 中文路径与 UTF-8 铁律

用户的知识库名可能含中文（如 `AI学习知识库`）、空格、emoji。

❗ **铁律**：所有路径处理代码必须用 UTF-8，**绝不**使用"路径转拼音"、"中文字符转码"等歪招。Node.js / Tauri 原生支持 UTF-8，正确写法即可。

### 6.7 边界场景行为约定

| 场景 | 行为 |
|---|---|
| **多实例启动** | 只允许单实例。第二次启动直接 focus 已有窗口（macOS Cmd+N 也不开新窗口）。原因：本地后端服务监听固定端口，多实例冲突；也避免对同一文件并发写 |
| **无网络 / 未配置 API key** | 启动不报错。库列表、对话历史、wiki 页面浏览**仍可用**。试图发新消息时给一个明确提示"未配置 API key，去设置面板"或"网络断开" |
| **崩溃 / 异常退出后恢复** | 重启后：自动恢复"最后一次使用的库 + 最近活跃对话"；对话内容由 pi-agent session 持久化保证完整；侧栏折叠状态和右抽屉宽度保存在本机并恢复；右抽屉开关本身**不恢复**，避免恢复到"半坏"的 UI |
| **后端服务未起** | 前端 UI 显示明显的"后端服务未连接"状态，不渲染对话区（避免误以为是 agent 卡死） |
| **知识库目录被外部删除** | 列表里标灰，点击给出"目录已失效，是否从列表移除"提示，不崩溃 |

---

## 7. 关键决策记录（ADR）

> 决策一旦写下，未来要推翻必须明确说明"什么变化了"。

### ADR-1：选 pi-agent 而非 Vercel AI SDK / Mastra

- Vercel AI SDK 强项是云部署，本项目不部署
- Mastra 偏企业向 dashboard，对单人本地工具偏重
- pi-agent **原生支持 Anthropic Skill 标准**，可零适配复用 llm-wiki-skill 和社区 Skill 生态
- pi-agent SDK 和 RPC 模式都明确支持嵌入到 web / 桌面 UI

### ADR-2：对话中心而非图谱中心

- 用户已有 Codex / Claude Desktop 的对话心智，零学习成本
- `@` / `/` 是 Skill 和工具集成的天然入口
- 图谱适合"探索"，不适合作为日常工作主屏；作辅助面板更合适

### ADR-3：SSE 而非 WebSocket

- agent → UI 是**单向**事件流
- SSE 是 HTTP 标准，浏览器和 webview 原生支持，断线自动重连
- WebSocket 需管理双向状态机，本场景过度

### ADR-4：先 web 再 Tauri 打包

- web 是验证产品逻辑最快的形态
- Tauri 本质是 webview 容器，前端可直接装现成
- 一开始做桌面会让"前端开发"和"打包调试"两个复杂度叠加，0 代码起步必死

### ADR-5：不用 MCP

- MCP 是跨进程 RPC，每个能力一个独立 server，本地场景过重
- Skill 是 markdown + scripts，进程内执行，简单一个量级
- pi-agent 的 Skill 加载机制已足够
- 未来如果某个能力**必须**用 MCP（比如调云端服务），再单独接入

### ADR-6：完全进化为 agent，不维护双通道

- 单人项目维护两个发行通道是开发者陷阱
- pi-agent 能直接复用 Skill 内容，"完全进化"代价比想象的小
- Skill 仓库进入维护模式，老用户照常使用

### ADR-7：知识库上下文用 Extension 注入，不拼 prompt

- 拼 prompt 难以维护、容易污染、对模型不友好
- pi-agent Extension 可以注册自定义 tool 并持有应用状态
- 让 agent 通过 tool 调用获取"当前在哪个库"、"库的元数据"，行为更可控
- 切库时 Extension 状态变化即可，不需要重建 session

### ADR-8：React + Vite 而非 Next.js

- Next.js 的 SSR / Edge / 部署优化在 Tauri 里全废
- Vite 纯 SPA 路线打包简单，Tauri 一行命令吃下
- React 生态对新手最友好

### ADR-9：UI 用 shadcn/ui

- 组件是复制到本仓库的源代码，不是黑盒 npm 包，0 代码用户也能改
- 原生 Tailwind + 深色主题，符合工具感视觉风格
- 社区主流，AI 协作样本量大

### ADR-10：pi-agent 作为 npm 依赖，不 fork、不 clone 源码

- npm 依赖是现代 JS 项目用第三方库的标准方式，"不造轮子"正解
- fork 会导致上游更新无法 merge，维护噩梦
- submodule 对新手是地狱级体验，没有任何收益
- 极端情况需要 patch 时用 `patch-package`，保持升级路径干净

### ADR-11：知识库采用混合存储策略（默认根 + 外部登记）

- 用户的知识天然分类，不该被强制塞到一个固定位置
- 默认根 `~/llm-wiki/` 给新用户零配置上手
- 外部库登记给已有库的用户（如 Obsidian vault 用户）零迁移成本
- 不选 `~/Documents/` 因为 macOS 的 iCloud Drive 会撕坏文件锁

### ADR-12：会话绑定知识库，同库支持多并行对话

- 会话绑定库：防止跨库上下文污染（投资笔记不该混进 AI 研究）
- 同库多对话：符合 Claude Desktop / ChatGPT 的心智，用户切换思路不用清空历史
- 切库自动保存 + 自动选中目标库最近对话：零摩擦
- 全程自动保存，无确认弹窗

### ADR-13：模型认证完全复用 pi-agent 的 auth 体系（三层 fallback）

**不**在 llm-wiki-agent 自己维护 API key 存储。所有凭证最终落到 pi-agent 的 `~/.pi/agent/auth.json`，由 pi-agent SDK 统一读取与刷新。

**三层 fallback（按推荐顺序）**：

1. **复用 pi CLI 登录态**（推荐）
   - 用户在终端跑 `pi login`，选择 Claude Pro/Max / ChatGPT Plus / GitHub Copilot OAuth，或填 Anthropic / OpenAI 等 API key
   - 凭证由 pi CLI 写入 `~/.pi/agent/auth.json`（权限 0600）
   - 我们的 app 通过 `AuthStorage.create()` 自动读取
   - **UX 等价于 open-design 的"复用本地 CLI"**：登录一次，到处可用
2. **UI 内填 API key**
   - 设置面板里直接填 Anthropic / OpenAI 等 key
   - app 写入 **同一个** `~/.pi/agent/auth.json`，不是我们自己的 config 文件
   - 测试连接按钮验证有效
3. **环境变量**
   - 用户在 shell 里 `export ANTHROPIC_API_KEY=...`
   - pi-agent SDK 自动检测
   - 设置面板只读显示当前环境变量状态

**关键约束**：
- llm-wiki-agent 的 `config.json` **不存任何 key**，只存 UI 偏好、外部库登记、默认模型等元数据
- 想用 Claude Pro/Max 订阅的用户**零成本**接入（这是 BYOK API key 路线给不了的礼物）
- macOS Keychain / 1Password 等高级用法通过 auth.json 的 `!shell command` 语法支持，不需要我们额外做

### ADR-13b：不抄 open-design 的"多 CLI 子进程"模式

open-design 通过启动 CLI 子进程（Claude Code / Codex / Cursor 等 16 个）来实现"复用本地 CLI"，因为它要兼容多家协议。

我们只用 pi-agent SDK，已经覆盖所有主流 provider（Anthropic / OpenAI / Google / DeepSeek / Bedrock / Azure / xAI / OpenRouter ...）。不需要再做 CLI 检测和子进程管理。

未来如果某用户极度想用某 CLI 驱动 llm-wiki，可作为可选适配层加进来，但**不进阶段一-五主线**。

### ADR-14：app 内一键新建知识库

- 用户不应该被迫开终端才能创建新库
- 内置 `/new-wiki` 命令调用 llm-wiki-skill 的 init 流程
- agent 自己跑自己的 Skill，闭环

### ADR-15：Obsidian 共存（agent 忽略非 markdown 与第三方元数据）

- 大量用户用 Obsidian 浏览同一份知识库
- agent 不碰 `.obsidian/`、`*.canvas`、`*.base`、`.DS_Store` 等
- 用户用 Obsidian 编辑 / 画 Canvas / 做 Base 不受影响

### ADR-16：长期与 llm-wiki 仓库合并（agent 是 Skill 的升级版）

**背景**：作者的 llm-wiki-skill 是 1.7k 星的成熟项目，纯提示词系统形态，没有 agent 循环 / 子 agent 分工 / 多步工具链。本项目（llm-wiki-agent）是把 Skill 升级为 agent 形态的实验。

**决策**：agent 形态成熟后，本仓库代码并入 `llm-wiki` 主仓库，作为 Skill 的 agent 升级版同时存在（保留 Skill 给纯 CLI 用户）。**当前仓库是临时仓库**。

**对架构的指导（"C 混合"归属原则）**：

1. **能力归属原则**："Skill 已有的功能调 Skill，agent 工作台新能力用 Extension"。这条原则今天和合并后都成立——今天的"spawn 外部脚本"合并后变成"同仓库内调用"，调用关系不变
2. **拒绝重复造轮子**：llm-wiki-skill 已实现的消化能力（X / 微信 / 小红书 / 知乎 / YouTube / PDF / 本地文件）一律调 Skill，不在 agent 端重写
3. **拒绝塞 agent 特有命令进 Skill**：对话结晶、UI 元能力（列页面 / 读单页）、auth 管理这些"agent 工作台才有"的概念，用 Extension 实现，不污染 Skill 的"纯提示词系统"特质
4. **代码组织模块化**：agent 端目录结构保持清晰，未来可 lift-and-shift 直接挪进 `llm-wiki/agent/` 子目录
5. **不为合并提前优化**：今天该用 npm workspaces + 独立仓库就用，合并是未来的事，今天保持工程简单

**阶段 3.5 的明确例外**：批量本地文件消化为了验证"便宜模型 + 并行子代理"路线，允许子代理不调用完整 llm-wiki Skill，而是只读单个文件并输出 wiki markdown，主进程负责写盘。这个例外只覆盖阶段 3.5 的 `.md/.txt/.pdf` 批量入库场景，不推翻"Skill 已有能力优先调 Skill"的长期原则。

**未来扩展位**：媒体创作（阶段三）/ 子 agent 分工 / 多模型路由都依赖 agent 形态，是 Skill 给不了的。这些是 agent 形态存在的根本理由。

**与既有 ADR 的关系**：
- 强化 **ADR-7**（知识库上下文用 Extension 注入，不拼 prompt）
- 强化 **ADR-13b**（不抄 open-design 的多 CLI 子进程模式，因为我们最终是同仓库 agent）
- 兼容 **ADR-10**（pi-agent 作 npm 依赖）和 **ADR-14**（app 内一键新建知识库）

### ADR-17：阶段二新增前端依赖（react-markdown + cmdk）

**背景**：阶段二引入 markdown 渲染（右抽屉显示 wiki 页面）+ 命令补全菜单（`/` 和 `@`）。两个能力都需要新依赖。

**决策**（已在 `web/package.json` 落地）：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `react-markdown` | ^9 | assistant 消息 + 右抽屉的 markdown 渲染 |
| `remark-gfm` | ^4 | GFM 支持：表格、任务列表、自动链接 |
| `cmdk` | ^1 | `/` 命令菜单 + `@` 引用菜单底层（即 shadcn `<Command>` 基础） |

**拒绝项**：
- marked / markdown-it：生态/类型/插件不如 react-markdown 稳
- Radix Popover 自写：键盘导航与 a11y 都要重写，工作量大

**与 ADR-9（shadcn/ui）的关系**：cmdk 即 shadcn 官方 Command 底层；react-markdown 在 shadcn 生态里是社区主流选型。两者都与现有 UI 体系自然契合，无破坏性。

**长期**：阶段三引入产出类 Skill（docx / pdf / pptx）+ open-design 设计 Skill 时，UI 端会需要更多依赖（PPT 渲染、文件预览等）。届时再补 ADR-18+。

### ADR-18：阶段 3.5 多模型双角色 + 轻量子代理框架

**背景**：阶段 1-3 完成后两个痛点同时浮现——TBD-2（多模型路由）一直没有承载场景；阶段二的"一次喂一篇"消化模式拦住了批量进库的用户。两件事在阶段 3.5 合并解决：批量消化天然需要"便宜模型 + 并行"，正好把多模型路由落地。

**决策**：

1. **双角色而非 N 角色**：只引入 `main`（聊天）+ `digest`（消化）两个角色。拒绝项："per-task 模型路由"（消化/沉淀/产出/对话各自一个）太复杂、用户配不动；"只有一个 default model"则无法承载阶段 3.5 的核心需求
2. **角色配置存项目 config.json 不写 pi settings.json**：跨工具污染坏处大于好处；`~/.llm-wiki-agent/config.json` 是我们自己的偏好文件
3. **main 角色接管主对话**：设置里的 main 角色用于主对话创建和切换；保存 main 后重载当前活跃对话，让右上角模型显示与设置保持一致。digest 角色强制走子代理，保证"消化用便宜模型"的承诺
4. **子代理用 pi SDK 原生 API 而非自建框架**：`createAgentSession({ model, authStorage, modelRegistry, sessionManager: inMemory(), tools: ["read"] })` 已经够用。拒绝项：抄 omp 的 `executor.ts` / `index.ts` 那 3000 行（工作树隔离 / 嵌套子代理 / worker IPC 我们都不需要）；自建独立子代理 runtime 重复造轮子
5. **并发控制自写 30 行**：拒绝引入 p-limit / async-pool 等并发库（一个 while 循环就能做）；拒绝 `Promise.all` 一把开（N 个文件 = N 个并发模型请求会 429）
6. **子代理不挂业务 extension**：阶段 3.5 的批量本地文件消化是 ADR-16 的明确例外，消化是裸 prompt + 只读工具的简单任务，挂 KB / synthesis / artifacts extension 反而让 cheap 模型困惑
7. **写盘归主进程**：子代理只输出 wiki markdown 文本，主进程负责写到 `wiki/synthesis/sessions/`。让 cheap 模型决定文件路径风险大；主进程已知正确路径无需让 cheap 模型决策
8. **SSE 沿用 ADR-3 路线**：批量消化接口直接返回 `text/event-stream`，不为此开 WebSocket，也不做轮询
9. **拖拽优先于输入，但不假设浏览器一定暴露绝对路径**：阶段 3.5 先实测 macOS Finder 拖拽时 `DataTransfer` 是否提供 `file://`；若提供则自动填路径，若不提供则用输入框作为明确兜底。输入框不是降级体验，而是 web 沙箱下必须保留的可靠通道

**与既有 ADR 的关系**：
- 解决 **TBD-2**（多模型路由）：选项 B 落地——通过角色映射而非任务路由
- 兼容 **ADR-3**（SSE）：批量消化进度沿用 SSE
- 兼容 **ADR-7**（Extension 注入上下文）：子代理不需要 KB 上下文，直接 prompt 传入；主对话保持现有 extension 注入路径
- 兼容 **ADR-16**（Skill 优先）：本阶段对子代理批量本地文件消化做一次受控例外，不扩展到 Skill 已覆盖的完整素材消化流程
- 兼容 **ADR-10**（pi-agent 作 npm 依赖）：完全用 SDK 原生 API，不 fork 不 patch
- 强化 **ADR-12**（会话绑定知识库）：子代理是临时 inMemory session，不污染 KB 的对话历史
- 强化 **ADR-13**（凭证落 `~/.pi/agent/auth.json`）：modelRoles 只存 `{provider, modelId}`，不存任何 key

**何时重新评估**：
- main 角色切换后如果出现历史会话恢复异常 → 回退为仅对新会话生效
- 用户反馈"批量消化输出格式漂移" → 引入 schema 校验 + 重试
- 用户反馈"并发 3 还是太慢" → 提供更高档位 + 自适应降级（429 自动退避）

### ADR-19：主对话引入“系统检索 + 上下文注入”

**背景**：阶段 3.5 批量消化后，用户进入当前知识库直接问“这些文章总结一下”，弱模型可能不会主动调用 `list_knowledge_base_pages` / `read`，而是反问用户提供文章内容。ADR-7 的“靠 Extension 工具让 agent 自觉获取上下文”在问答检索场景下不够稳定。

**决策**：

1. 主对话 `/api/prompt` 路径破例采用“后端检索 + 拼隐藏上下文”模式。
2. ADR-7 的“应用状态用 Extension 注入”原则仍然成立；本破例只覆盖“问答类知识库检索”，不改变 `current_knowledge_base` 等状态工具。
3. 同一份检索能力同时暴露为 `query_knowledge_base` 工具，保留 Extension 路径供强模型主动调用。
4. 每个 user turn 独立判断并检索，不跨轮复用旧结果。
5. 检索失败时降级为普通对话，同时通过 SSE 轻提示并写入 retrieval 日志，不中断用户输入。

**与既有 ADR 的关系**：
- 破例 **ADR-7**：仅限主对话问答检索。
- 兼容 **ADR-3**：新增轻量 SSE 事件。
- 兼容 **ADR-16**：检索是 agent 工作台元能力，落在 server 端。
- 兼容 **ADR-18**：不影响 digest 子代理批量消化路径。

**何时重新评估**：
- 主流模型工具调用稳定性显著提升 → 考虑改回纯工具路径
- 用户大量反馈“参考页面被编造” → 强化 prompt 约束 + 引入后置校验
- KB 规模超过 100 篇且本地文本检索变慢 → 引入向量检索

---

## 8. 给 0 代码作者的盲区与协作规则

### 8.1 环境陷阱

- macOS 默认 Node 版本可能旧。**统一用 [mise](https://mise.jdx.dev/) 或 nvm 管理 Node 版本**，锁到 **`>=22.19.0`**（pi-coding-agent 0.75.x 的硬要求）。否则 `npm install` 就直接报错
- 不要全局 `npm install -g`。每个项目用 `package.json` 锁版本
- API key **完全不进我们的仓库**，也不进 `~/.llm-wiki-agent/`。统一由 pi-agent SDK 管理，落到 `~/.pi/agent/auth.json`（权限 0600）。详见 ADR-13

### 8.2 进度陷阱

- **"差一点就跑通了"是最危险的状态**。验收标准要严格，跑不通就不进下一阶段
- AI 协作最大的隐性风险：你不懂代码 → AI 改 A 引起 B 坏，你不知道 → 雪球越滚越大
  - **对策**：每阶段结束让 AI 主动列出"本次改了哪些文件、新增了什么依赖、为什么"，你看明白再确认
- **Git 是你的安全网**。每个验收节点 commit 一次。

### 8.3 协作规则（AI 必须遵守）

- **不要自由发挥**。每次动手前先说"打算改哪些文件、为什么这么改、对其他部分有什么影响"，作者确认后再动
- **任何要新增依赖**（npm package、Skill、配置项），先问"这是 PRODUCT.md 里规划过的吗"
- **任何要修改 PRODUCT.md 之外的决策**，先说明"这与 PRODUCT.md 第 X.Y 节冲突，建议修改文档为 Z"，等作者拍板
- **作者思路断了的时候**，先读 PRODUCT.md，不要急着问"我们做到哪里了"——日志和 git 记录是事实，文档是意图，两个对照看
- **绝不主动跳阶段**。阶段二验收不过，不允许动阶段三的代码

### 8.4 心态陷阱

- 0 代码做出本地工具是可行的，但**"做出来"和"做得好"差距很大**
- 阶段一跑通会有巨大成就感，但 80% 时间在阶段二-四
- 桌面打包（阶段五）是难度峰值，会卡很多坑
- 接受"中途某个设计要推倒重来"——写进 ADR 比硬撑下去更省力

---

## 9. 待决事项

记录尚未拍板但要在未来某阶段决定的事。决定后移到 ADR。

| 编号 | 事项 | 现状 | 何时定 |
|---|---|---|---|
| ~~TBD-1~~ | ~~项目正式名~~ | **已定：`llm-wiki-agent`**。桌面应用显示名留到阶段五前再定 | ✅ |
| TBD-2 | 默认模型 | **阶段 3.5 已落地**：双角色 `modelRoles.{main, digest}` 写入 `~/.llm-wiki-agent/config.json`；main 角色用于主对话，digest 角色用于批量消化。详见 ADR-18 | ✅ |
| ~~TBD-3~~ | ~~多库会话隔离~~ | **已定：会话绑定知识库，同库支持多并行对话**（见 ADR-12） | ✅ |
| TBD-4 | 危险操作确认 | 删除 / 覆盖类是否弹窗 | 阶段二 |
| ~~TBD-5~~ | ~~API key 配置 UI~~ | **已定：三层 fallback（pi CLI 登录 / UI 填 key / env var），统一存 `~/.pi/agent/auth.json`**（见 ADR-13） | ✅ |
| TBD-6 | 知识库导入导出 | 是否需要打包导出格式 | 阶段四后 |
| ~~TBD-7~~ | ~~知识库根目录~~ | **已定：默认 `~/llm-wiki/` + 外部目录登记**（见 ADR-11） | ✅ |
| TBD-8 | HTML 产出 Skill | 用现成的还是自建 | 阶段三 |

---

## 10. 进度追踪

### 阶段一：主干打通 ✅ 已完成 2026-05-26

| # | 任务 | Commit |
|---|---|---|
| 1 | 仓库骨架：`package.json` / `.gitignore` / `README.md` / `LICENSE` / `tsconfig.json` | `81ddb29` |
| 2 | 后端骨架：Node + Hono，最小 `/api/echo` | `5ffd2c0` |
| 3 | 前端骨架：Vite + React + shadcn/ui + SSE echo 排练 | `3662b60` |
| 4 | 接入 pi-coding-agent SDK，实现真 agent 对话 | `c4e0dad` |
| 5 | 第一个 Extension：注入 `currentKnowledgeBase` 上下文 | `ebe054b` |
| 6 | 知识库扫描接口：扫 `~/llm-wiki/` + 读 `config.json` 外部库 | `daebc62` |
| 7 | 前端知识库选择 UI + 三栏布局雏形 | `49dc00e` |
| 8 | 同库多对话 + 切换 + 持久化（阶段一完结） | `75e176b` |
| – | review 修补：一行 `npm run dev` / auto-restore / 默认深色 / 顶部状态条占位 | `f835433` |
| – | TBD-2 删 Sonnet 表述 + 光标真闪烁 | `dd021bc` |

阶段一完成情况详见 §4 阶段一末尾的"完成情况"小节。

### 阶段二：核心循环（@、/、结晶、消化）✅ 已完成 2026-05-27

**最终 PR**：[#1 feat: complete stage 2 core loop](https://github.com/sdyckjq-lab/llm-wiki-agent/pull/1)（base: main, head: stage-2）

**8 step commit + 5 fix commit + 1 doc 修订 commit**：

| # | 任务 | Commit |
|---|---|---|
| 1 | `/sediment` Extension：结晶对话到 `wiki/synthesis/sessions/` | `fe54d47` |
| 2 | `/new-wiki` Extension：spawn `init-wiki.sh` 新建库 | `5ab13dc` |
| 3 | `/api/refs`：候选页面列表（递归 fingerprint 缓存） | `b0802b8` |
| 4 | `/api/commands`：内置 + Skill 命令合并（TBD-1 方案 B） | `202bf4d` |
| 5 | 设置面板：API key 三层认证 + 测试连接（TBD-2 方案 B） | `3654791` |
| 6 | `/` 命令补全 UI（cmdk） | `b6dffc0` |
| 7 | `@` 补全 + 右抽屉 + markdown 渲染（react-markdown） | `7801d2c` |
| 8 | 消化新素材 chip | `7a46f4b` |
| – | fix: 设置面板可关闭 | `c045b9e` |
| – | fix: `/api/commands` 包含 Claude skill | `791d73a` |
| – | fix: agent resource loader 加载 Claude skill 目录 | `f990229` |
| – | fix: 新建库 UI 端点 + refs cache fingerprint 升级 + Sidebar 加按钮 | `a088b97` |
| – | fix: 右抽屉支持 Esc 关闭 | `2686b51` |
| – | docs(stage-2): 闭合验收 issue #2/#3/#4 + 标 TBD-3 已解决 | `208ad4d` |

**阶段二完成情况** ✅ 2026-05-27（合并 PR #1 后）
- 范围 7 项全部交付（@、/、/sediment、/new-wiki、链接预览、消化、设置面板）
- 验收 3 条全过：建库 / 消化→讨论→结晶 闭环 / API key 落 `~/.pi/agent/auth.json`
- 关键架构决策：**D9 能力归属原则**（消化等知识库本职 → Skill；对话结晶等 agent 元能力 → Extension）落地，对应 ADR-16 长期合并愿景
- **超出原设计的增强**：
  - `POST /api/knowledge-bases/new` + `NewWikiDialog`（UI 直接建库，不必先与 agent 对话）
  - `pages.ts` cache 升级 mtime → 递归 fingerprint（修了"嵌套新建后 refs 看不到"的潜在 bug）
  - `wiki-init.ts::findInitScript()` 兼容 init-wiki.sh 在 skill 根目录或 `scripts/` 两种位置
- **接受的妥协**（不阻塞阶段三）：
  - 设置面板只做认证 Tab（默认模型 / 根目录 / 外部库管理推迟）
  - Anthropic 测试连接未跑（缺 key），但代码路径同 DeepSeek 一致
  - 阶段二完整设计 + 8 step 细则 + 总验收剧本归档在 `docs/stage-2-design.md`（已标 ✅）
- **新增依赖**：见 §3.2 + ADR-17

### 阶段三：产出能力（产品亮点）✅ 已完成 2026-05-27

**最终分支**：`stage-3`（base: main, head: `1f1f591`）

**8 step commit + 1 fix commit**：

| # | 任务 | Commit |
|---|---|---|
| 1 | vendor 4 个 anthropics Skills + 收紧命令源标签 | `6d2e218` |
| 2 | 产物 manifest 存储 + CRUD API | `f19687c` |
| 3 | 导出按钮 + prompt 模板（3 通道触发） | `bf6b878` |
| 4 | 产物右抽屉多 Tab 切换 | `bc70b2c` |
| 5 | HtmlRenderer：iframe sandbox 预览 | `862265a` |
| 6 | DownloadOnlyRenderer：元数据卡片 + 下载 | `38006a7` |
| 7 | 全局 Skill 可见性开关（settings toggle） | `1016601` |
| 8 | 产物工作流 UX 打磨 | `91a9761` |
| – | fix: 修复导出工作流 review 问题 | `1f1f591` |

**阶段三完成情况** ✅ 2026-05-27（审查通过，合并到 main）
- 范围全部交付：5 个导出按钮（PDF/Word/PPT/Excel/HTML）+ 4 个 vendored Skills + 2 个 Extension 工具 + 6 个新 API + 1 个新 SSE event
- 关键架构决策：**E13（D9 落地）**——产出操作走 Skill，`prepare_artifact` / `finalize_artifact` 作为 agent 元能力 Extension；HTML 导出不依赖 Skill，由 agent 内置能力直接生成
- 新增 4 个端点：`GET /api/artifacts`、`GET /api/artifacts/:id`、`GET /api/artifacts/:id/files/:filename`、`POST /api/config` + `GET /api/config` 扩展 `showUserGlobalSkills`
- 安全验证通过：path traversal 防护、iframe sandbox（无 `allow-same-origin`）、UIID 验证、文件名净化
- **接受的妥协**（不阻塞阶段四）：
  - PPTX 在浏览器内无预览（DownloadOnlyRenderer），设计文档原定的 PPTXjs 方案未落地
  - HTML 导出不依赖外部 Skill，由 agent 内置 fs 能力直接生成（TBD-5 方案）
  - 阶段三完整设计 + 8 step 细则 + 总验收剧本归档在 `docs/stage-3-design.md`
- **新增依赖**：无（0 个新 npm package）

### 阶段 3.5：导航 UX 重构 + 多模型子代理批量消化 ✅ 已完成 2026-05-27

**当前状态**：已合并到 `main` 并推送；阶段性分支已清理

**设计文档**：[docs/stage-3.5-design.md](docs/stage-3.5-design.md)（1148 行：7 step 细则 + 13 项关键决策 + 5 个 TBD + API 契约 + 验收剧本）

**收尾补强设计文档**：[docs/superpowers/specs/2026-05-28-resizable-preview-layout-design.md](docs/superpowers/specs/2026-05-28-resizable-preview-layout-design.md)

**7 step 概览**：

| # | 任务 | 状态 |
|---|---|---|
| 1 | 侧栏重构：统一 KB 列表 + 折叠对话子树 | ✅ |
| 2 | 拖拽 + 输入框路径填充（含 inspect 端点） | ✅ |
| 3 | 非 wiki 目录初始化引导 | ✅ |
| 4 | 多模型双角色（main / digest） | ✅ |
| 5 | 后端子代理批量消化框架 | ✅ |
| 6 | 批量消化 UI + SSE 进度推送 | ✅ |
| 7 | 总验收 + UX 体感打磨 | ✅ |

**关键风险**：
- TBD-3.5-1：子代理 session 共享 `authStorage` / `modelRegistry` 的资源生命周期未实测（codex 起手第一件事写 60 行验证）
- TBD-3.5-2：`init-wiki.sh` 就地初始化会写入固定文件，必须先做冲突检测与备份（Step 3 起手看源码确认文件列表）
- TBD-3.5-3：main 角色已接管主对话；设置切换后重载当前活跃对话

**验收实况**：
- `npm run --silent typecheck` 通过
- `node --import tsx --test server/src/digest/concurrency.test.ts` 通过
- 本地接口实测通过：目录 inspect、初始化冲突 409、就地初始化成功、模型列表、模型角色保存、批量消化参数校验
- 单文件批量消化真实跑通，SSE 返回 start / file_start / file_complete / done，并写入 `wiki/synthesis/sessions/`
- 验收后补强：批量消化改为逐文件失败隔离，进度面板显示每个文件状态、生成字数和结果入口；外部目录批量消化改用 inspect 扫描凭据，不再信任前端传任意 sourceRoot；初始化后批量消化可临时选择 digest 模型
- 收尾补强：当前知识库自动检索已落地（见 [docs/current-kb-retrieval-design.md](docs/current-kb-retrieval-design.md)）；批量消化后直接提问会先检索当前知识库，普通寒暄和导出指令不会误触发检索
- UI 视觉迁移补强：基于本地原型 `index.html` 统一工作台视觉，补齐浅色 / 深色主题切换；保持原有侧栏、对话、引用、命令、产物抽屉、设置、批量消化流程不变，不新增依赖
- 预览布局补强：侧栏可折叠为 52px 窄图标栏，右抽屉支持拖动调宽和双击恢复默认宽度；折叠状态与抽屉宽度保存在本机；移动端继续使用全屏抽屉

### 阶段四 / 五：未开始（详见 §4）

### 协作约定（持续生效）

每一步动手前 AI 都要先说计划，作者确认后再动。每完成一步：

- AI 列改动清单（文件、依赖、决策）
- 作者确认理解
- AI 创建 git commit（commit message 含本步范围 + 实测验收要点）
- 进入下一步

---

## 附录 A：术语表

| 术语 | 解释 |
|---|---|
| **Skill** | Anthropic 提出的能力包格式：一个目录 + 一份 SKILL.md。详见 [agentskills.io](https://agentskills.io/) |
| **pi-agent** | TypeScript agent runtime，原生支持 Skill 标准。`@earendil-works/pi-coding-agent` |
| **SSE** | Server-Sent Events，服务器单向推送事件给浏览器的 HTTP 标准 |
| **Extension** | pi-agent 的扩展机制：TS 模块，能注册自定义 tool / 命令 / 拦截事件 / 持有状态 |
| **Tauri** | 用系统 webview + Rust 后端打包跨平台桌面应用的框架，二进制和内存占用通常显著低于 Electron |
| **Hono** | 轻量 TypeScript web 框架，跑 Node / Bun / Deno / Cloudflare 都行 |
| **shadcn/ui** | 组件库，但代码是直接复制到你仓库的（不是 npm 黑盒），方便修改 |
| **结晶 / 沉淀** | 把对话内容固化为 wiki 页面的动作（继承自 llm-wiki-skill 术语） |

---

## 附录 B：参考链接

- pi-agent 仓库：https://github.com/earendil-works/pi
- pi-agent Skill 文档：`packages/coding-agent/docs/skills.md`
- pi-agent SDK 文档：`packages/coding-agent/docs/sdk.md`
- pi-agent Extension 文档：`packages/coding-agent/docs/extensions.md`
- llm-wiki-skill 仓库：https://github.com/sdyckjq-lab/llm-wiki-skill
- Anthropic Skill 标准：https://agentskills.io/specification
- Anthropic 官方 Skills：https://github.com/anthropics/skills
- pi-skills：https://github.com/badlogic/pi-skills
- Tauri 文档：https://tauri.app/
- shadcn/ui：https://ui.shadcn.com/

---

> 本文档第一版完成于 2026-05-26。后续更新请在文末追加 changelog。

## Changelog

- **2026-05-28 v12（阶段 3.5 预览布局收尾）**：补记可拖动预览区与侧栏折叠
  - 右抽屉支持拖动左边缘调整预览宽度，双击恢复默认宽度；宽度保存在本机
  - 左侧栏支持折叠为 52px 窄图标栏，保留核心入口并提供悬停提示；折叠状态保存在本机
  - 小屏幕下保持原有全屏抽屉方式，不启用拖动
  - 设计与验证记录见 `docs/superpowers/specs/2026-05-28-resizable-preview-layout-design.md`
- **2026-05-28 v11（阶段 3.5 UI 收尾）**：补记原计划外的 UI 原型迁移
  - 基于本地原型 `index.html` 统一工作台视觉，覆盖侧栏、顶部状态条、对话区、输入区、`@` / `/` 菜单、右抽屉、设置和批量消化面板
  - 增加浅色 / 深色主题切换，默认深色，用户选择保存在本机
  - 保持阶段 3.5 既有产品范围，不新增 npm 依赖；本次属于收尾视觉补强，不改变知识库和 agent 行为
- **2026-05-28 v10（阶段 3.5 收尾）**：阶段 3.5 收尾补强完成，准备合并推送
  - 新增当前知识库自动检索：主对话提问时后端先检索当前 KB 并注入上下文，避免批量消化后模型反问用户提供文章
  - `query_knowledge_base` 工具与 `/api/prompt` 共用同一套检索逻辑，ADR-19 已写入 §7
  - 检索失败降级为普通对话并写 retrieval 日志；寒暄、`/` 命令、导出产物指令不会误触发检索
  - 验证覆盖：检索单测、并发单测、类型检查、真实接口总结/寒暄/导出三条路径
- **2026-05-27 v9（阶段 3.5 完成）**：阶段 3.5 实施完成并本地验证
  - 侧栏统一、拖拽/输入路径检查、非 wiki 目录初始化、多模型角色、批量消化子代理、SSE 进度浮窗均已落地
  - 保持零新增 npm 依赖；main 角色已接管主对话，digest 角色用于批量消化
- **2026-05-27 v8（阶段 3.5 设计完成）**：阶段 3.5 设计完成，待 codex 实施
  - §4 新增"阶段 3.5：导航 UX 重构 + 多模型子代理批量消化"小节，列出背景、7 step 范围、5 条验收标准、设计文档指引
  - §7 新增 **ADR-18：阶段 3.5 多模型双角色 + 轻量子代理框架**（9 条核心决策 + 与既有 ADR 关系 + 重新评估触发条件）
  - §9 TBD-2 状态更新："阶段三再做"→"阶段 3.5 落地中"
  - §10 新增"阶段 3.5"小节：当前分支 `stage-3.5`、设计文档链接、7 step 占位、3 个关键风险
  - 设计细则归档 `docs/stage-3.5-design.md`（1148 行，与阶段三同量级）
- **2026-05-26 v7（阶段一完成标记）**：阶段一全部 step + review 修补完成，作者确认 MVP 可用
  - §4 阶段一标题加 `✅ 已完成 2026-05-26`
  - §4 阶段一末尾新增"完成情况"小节：含最终 commit、验收实况、接受的妥协、**启动 & 运行速查表**（compact 后从这里恢复上下文）
  - §10 重命名 "下一步行动" → "进度追踪"：阶段一 8 step + 2 review commit 全部 ✅ + commit hash 表；阶段二预占骨架（7 项待办）；阶段三/四/五标 "未开始"
  - 协作约定移到 §10 末尾，作为持续生效条款
- **2026-05-26 v6**：
  - TBD-2 表述改：删"阶段一固定 Claude Sonnet"，改为"沿用 pi-agent 默认设置"。实际作者通过 pi-agent 的 provider 体系接入了其他 provider（如 zai/glm-5.1），llm-wiki-agent 本不该假设固定 Sonnet
  - §阶段后规划"多模型路由"措辞更通用，不锁死 Anthropic
  - 微调：ChatPanel 流式光标 `animate-pulse` → 自定义 `animate-cursor-blink`（1s steps 真闪烁，原 pulse 在 ▍ 粗块上视觉太弱）
- **2026-05-26 v5（阶段一完结 review 修补）**：实际 review 阶段一代码对照文档，发现并修复 3 项硬 gap、4 项偏差对齐
  - 修 Gap 1：根 `package.json` 加 `npm run dev` 一行起两个服务（用 `concurrently`，符合 §4 阶段一范围第 1 条）
  - 修 Gap 2：`AppConfig` 加 `lastUsedKbPath`；`selectKb/selectConversation/createNewConversation` 写入；`agent.bootstrapFromConfig()` 启动时 await 恢复（符合 §5.1.1）
  - 修 Gap 3：`web/index.html` `<html class="dark">`（符合 §5.4 "默认深色"）
  - §5.2 顶部状态条占位：ChatPanel header 加 `🤖 模型` 显示（disabled，从后端返回的 `active.model` 拿真实 provider/id）+ `⚙ 设置` 占位按钮，tooltip 标注"阶段二/三补"
  - §5.5 严禁项对齐：删除 "等待 agent 响应…" 文字提示；streaming 时最后一个 assistant 气泡显示 `▍` 光标
  - §5.4 等宽字体：`index.css` 加 `--font-mono` (JetBrains Mono / SF Mono stack) 给 `code/pre/kbd/samp` 元素
  - 后端 `/api/knowledge-base` GET/POST、`/api/conversations` POST、`/api/conversations/new` POST 全部在 `active` 上返回 `model: { provider, id } | null`
  - **明确推迟到阶段二/三**：§5.1 侧栏底部"图谱入口"延迟（阶段四，作者要重新构思）；"设置入口"占位放在 ChatPanel header（阶段二补完整面板）
- **2026-05-26 v4 (review pass)**：基于源码/文档验证，修复 5 项事实错误 + 4 项精确化 + 3 项软化/标注
  - 修：§3.1 架构图知识库路径 `~/wikis/` → `~/llm-wiki/`，并补充 `~/.pi/agent/auth.json`
  - 修：§6.2 知识库目录补 `wiki/comparisons/`、`wiki/overview.md`、`.wiki-tmp/`、`.gitignore`（依据 `scripts/init-wiki.sh` 实际行为）
  - 修：§8.1 删除"API key 走 config.json"过期描述，改为引用 ADR-13
  - 修：§9 TBD-5 已定描述同步到 ADR-13 现状
  - 加：Node 版本要求 `>=22.19.0`（pi-coding-agent 0.75.x 硬要求，写入 §3.2、§3.4、§8.1）
  - 加：§3.4 补充 Extension 注入方式（SDK 用 `bindExtensions` / `ResourceLoader`，不依赖 CLI 全局发现）
  - 加：§6.4 Obsidian 忽略列表补 `.wiki-tmp/` 和 dev 类目录
  - 加：§2.3 anthropics/skills 列出 17+ 个实际 Skill，不止"四件套"
  - 软：§3.2 "Tauri 比 Electron 轻 10×" → "二进制和内存通常显著低于 Electron（5-30 MB vs 100+ MB）"
  - 软：§3.2 mise 描述更准确为"多语言版本管理（含 Node）"
  - 标：§3.3 流程中的 `/api/*` 路径标注为"建议命名，最终以实现为准"
  - 标：§阶段三 PPTX 渲染库删除错误链接，明确"阶段三选型"
- **2026-05-26 v1**：第一版完成，确立产品定位、5 阶段路线、9 条 ADR、协作规则。
- **2026-05-26 v2**：
  - 新增 3.4 节《pi-agent 的使用方式》，明确"npm 依赖，不 clone 不 fork"
  - 新增 5.1.1 节《会话与切换行为》，定义并行对话与切库自动保存
  - 重写 6.1 节《知识库存储策略》，从单一目录改为"默认 `~/llm-wiki/` + 外部登记"混合策略
  - 新增 6.4 节《Obsidian 共存规则》，明确 agent 不碰的文件类型
  - 新增 6.6 节《中文路径与 UTF-8 铁律》
  - 新增 ADR-10 ~ ADR-15 六条决策
  - TBD-1 / TBD-3 / TBD-5 / TBD-7 关闭并归档到 ADR
  - TBD-2 改为阶段三才决定（阶段一固定 Sonnet）
  - 阶段一范围补充：知识库扫描含外部库登记、多并行对话支持
  - 阶段二范围补充：内置 `/new-wiki` 命令、设置面板 UI
- **2026-05-26 v3**：
  - 新增 6.7 节《边界场景行为约定》：单实例、无网络/无 key、崩溃恢复、后端未起、目录失效
  - **重写 ADR-13**：模型认证完全复用 pi-agent 的 `~/.pi/agent/auth.json`，三层 fallback（pi CLI 登录 / UI 填 key / env var）；`config.json` 不再存任何凭证
  - 新增 ADR-13b：明确不抄 open-design 的多 CLI 子进程模式
  - 重写 6.3 应用数据目录，澄清"应用数据 / 知识库数据 / 模型凭证"三类彻底分离
  - 阶段二范围细化：设置面板 UI 改为"三层认证 + 偏好"，验收标准更新
- **2026-05-27 v9（阶段三完成标记）**：阶段三全部 8 step + 1 fix commit 完成，审查通过合并到 main
  - §4 阶段三标题加 `✅ 已完成 2026-05-27`
  - §10 阶段三标记已完成，补充 9 commit 表 + 完成情况（范围、决策、妥协）
  - CLAUDE.md 更新"项目当前阶段"：阶段二 → 阶段三
  - 阶段三完整设计 + 8 step 细则 + 总验收剧本归档在 `docs/stage-3-design.md`
