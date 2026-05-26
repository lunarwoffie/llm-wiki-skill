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

### 阶段一：主干打通（最小可用）

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

### 阶段二：核心循环（@、/、结晶、消化）

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

### 阶段三：产出能力（产品亮点）

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
- 多模型路由：消化用 Haiku，对话用 Sonnet，自动切换
- 全局快捷键 / 系统托盘
- 主题与自定义样式
- 多端同步（如果未来真有需求）

---

## 5. UI 设计原则

### 5.1 三栏布局

```
[ 侧栏 240px ] [ 主区域 自适应 ] [ 右抽屉 0 / 400px / 全屏 ]
```

- **侧栏**永远显示：
  - 知识库列表（顶部，含"+ 新建知识库"按钮）
  - 当前库的对话列表（中部，含"+ 新对话"按钮，按最近活跃排序）
  - 图谱入口、设置入口（底部）
- **主区域**永远是对话（除非用户主动切换到图谱）
- **右抽屉**默认隐藏，呼出场景：产物预览、引用页面查看、设置面板

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

- 默认深色模式
- 等宽字体：JetBrains Mono / SF Mono
- 中文 UI 字体：系统字体（San Francisco / Microsoft YaHei / PingFang）
- 工具感优先，不追求"产品级精致"。参考 Codex / Claude Desktop / Linear

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
| **崩溃 / 异常退出后恢复** | 重启后：自动恢复"最后一次使用的库 + 最近活跃对话"；对话内容由 pi-agent session 持久化保证完整；UI 状态（侧栏选中、右抽屉开关）**不恢复**，回到默认状态——避免恢复到"半坏"的 UI |
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
| TBD-2 | 默认模型 | 阶段一固定 Claude Sonnet；阶段三再做多模型路由（消化用 Haiku、对话用 Sonnet） | 阶段三 |
| ~~TBD-3~~ | ~~多库会话隔离~~ | **已定：会话绑定知识库，同库支持多并行对话**（见 ADR-12） | ✅ |
| TBD-4 | 危险操作确认 | 删除 / 覆盖类是否弹窗 | 阶段二 |
| ~~TBD-5~~ | ~~API key 配置 UI~~ | **已定：三层 fallback（pi CLI 登录 / UI 填 key / env var），统一存 `~/.pi/agent/auth.json`**（见 ADR-13） | ✅ |
| TBD-6 | 知识库导入导出 | 是否需要打包导出格式 | 阶段四后 |
| ~~TBD-7~~ | ~~知识库根目录~~ | **已定：默认 `~/llm-wiki/` + 外部目录登记**（见 ADR-11） | ✅ |
| TBD-8 | HTML 产出 Skill | 用现成的还是自建 | 阶段三 |

---

## 10. 下一步行动

阶段一拆解（每一步动手前 AI 都要先说计划，作者确认后再动）：

1. 仓库骨架：`package.json` / `.gitignore` / `README.md` / `LICENSE` / `tsconfig.json`
2. 后端骨架：Node + Hono，跑通最小 `/api/echo` 接口（先不接 agent，验证起服务）
3. 前端骨架：Vite + React + shadcn/ui，对话框 UI，连通后端 SSE（先收回显事件流）
4. 接入 pi-coding-agent SDK，实现真正的对话
5. 第一个 Extension：注入 `currentKnowledgeBase` 上下文
6. 知识库扫描接口：扫 `~/llm-wiki/` + 读 `config.json` 外部库 → 返回列表
7. 前端知识库选择 UI（侧栏列表 + 添加外部库按钮）
8. 同库内对话列表 + 切换 + 新建对话
9. 阶段一验收

每完成一步：

- AI 列改动清单（文件、依赖、决策）
- 作者确认理解
- 作者执行 git commit
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
