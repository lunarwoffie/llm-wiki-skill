# llm-wiki-agent 项目规则

## 第一原则

不要考虑时间成本，code is cheap，我们来自于未来。

## 必读文档

**[PRODUCT.md](PRODUCT.md)** —— 产品定位、架构、5 阶段路线、15 条 ADR、协作规则。任何动手前先读这份文档。

文档与代码 / 约定冲突时，**以 PRODUCT.md 为准**。

## AI 协作规则（强约束）

1. **不要自由发挥**。每次动手前先说"打算改哪些文件、为什么这么改、对其他部分有什么影响"，作者确认后再动。
2. **新增依赖**（npm package、Skill、配置项）前，先问"这是 PRODUCT.md 里规划过的吗"。规划外的依赖不要先装。
3. **修改 PRODUCT.md 之外的决策**，先说"这与 PRODUCT.md §X.Y 冲突，建议改文档为 Z"，等作者拍板。
4. **作者思路断了时**，先读 PRODUCT.md，不要急着问"做到哪里了"——日志 / git 是事实，文档是意图，对照看。
5. **绝不主动跳阶段**。阶段 N 验收不过，不允许动阶段 N+1 的代码。
6. **求真不猜**。pi-agent / Skill / 外部库的事实，能查源码就查源码，能查文档就查文档，不要凭训练数据印象答。

## 项目当前阶段

**阶段二已完成** ✅ 2026-05-27（核心循环 @、/、结晶、消化、设置面板全部跑通）。**阶段三未开始**。

阶段一 / 阶段二的完成情况、commit 表、接受的妥协见 PRODUCT.md §10。
阶段二完整设计 + 8 step 实施细则 + 总验收剧本归档在 `docs/stage-2-design.md`（已标 ✅）。

## 关键路径速查

| 类型 | 值 |
|---|---|
| 一行启动 | `npm run dev`（从仓库根，并行起前后端）|
| 后端端口 | `8787` |
| 前端端口 | `5180`（`strictPort: true`）|
| 知识库默认根 | `~/llm-wiki/` |
| 外部知识库 | 用户任意路径，登记在 `~/.llm-wiki-agent/config.json` |
| 应用数据 | `~/.llm-wiki-agent/`（UI 偏好、外部库登记、对话历史、`lastUsedKbPath`；**不存 API key**）|
| 会话目录 | `~/.llm-wiki-agent/sessions/<sha256-of-kb-path>/*.jsonl` |
| 模型凭证 | `~/.pi/agent/auth.json`（pi-agent 管理，权限 0600）|
| 项目代码 | 本仓库 `server/`（Hono + pi-coding-agent SDK）+ `web/`（Vite + React + shadcn/ui）|

## Node 版本

`>=22.19.0`（pi-coding-agent 0.75.x 的硬要求）。

仓库根用 `.mise.toml` / `.nvmrc` 锁定。
