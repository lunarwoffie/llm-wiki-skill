# llm-wiki-agent

本地运行的知识库工作台。以对话为中心，通过 `@` 引用知识库内容、`/` 调用工具能力，把对话沉淀为可读可分享的产物（笔记、HTML、PPT、Word 等）。

> ⚠️ **当前状态**：阶段一进行中（主干打通）。**尚不可用**。

## 这个项目是什么

- 配套 [llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill) 的独立 agent 形态
- 基于 [pi-agent](https://github.com/earendil-works/pi) 的 SDK
- 本地运行，未来打包为 Tauri 桌面应用

## 完整说明

产品定位、架构、路线图、决策记录全部在 [`PRODUCT.md`](PRODUCT.md)。

**任何想了解或参与这个项目的人，先读 PRODUCT.md。**

## 开发

阶段一仍在打通，命令将随阶段推进补全。

### 环境要求

- Node `>=22.19.0`（pi-coding-agent 0.75.x 的硬要求）
- 推荐用 [mise](https://mise.jdx.dev/) 或 nvm 管理版本，仓库根有 `.mise.toml` / `.nvmrc`

## License

MIT
