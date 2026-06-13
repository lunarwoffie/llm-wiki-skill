/**
 * conversations.ts - 对话（pi session）管理
 *
 * 设计：
 *   - 每个知识库一个会话目录：~/.llm-wiki-agent/sessions/<kb-hash>/
 *   - kb-hash = sha256(absolute_kb_path).slice(0, 16)
 *     好处：1) 文件系统安全（无中文/斜杠等）；2) KB 重命名/挪走时旧会话不会丢
 *   - 会话文件由 pi-agent SessionManager 管理（.jsonl 格式）
 *
 * UI 对话气泡转换：
 *   pi 的 AgentMessage 含 user / assistant / toolResult / 自定义类型；
 *   UI 只显示 user 文本和 assistant 文本。tool 调用在历史里降级为提示文字。
 */

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

import { APP_DIR } from "./config.js";
import { stripKnowledgeContextForDisplay } from "./retrieval.js";

export const SESSIONS_ROOT = join(APP_DIR, "sessions");

export interface ConversationInfo {
	id: string;
	path: string;
	firstMessage: string;
	modifiedAt: number;
}

export interface UIMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	tools: { name: string; status: "done" }[];
}

/**
 * 知识库路径 → 会话目录路径（哈希命名）
 */
export function kbSessionDir(kbAbsolutePath: string): string {
	const hash = createHash("sha256").update(kbAbsolutePath).digest("hex").slice(0, 16);
	return join(SESSIONS_ROOT, hash);
}

/**
 * 确保 KB 的会话目录存在
 */
export async function ensureKbSessionDir(kbAbsolutePath: string): Promise<string> {
	const dir = kbSessionDir(kbAbsolutePath);
	await mkdir(dir, { recursive: true });
	return dir;
}

/**
 * 列出某 KB 下的所有对话（按修改时间从新到旧）
 */
export async function listConversations(kbAbsolutePath: string): Promise<ConversationInfo[]> {
	const dir = await ensureKbSessionDir(kbAbsolutePath);
	let raw: SessionInfo[] = [];
	try {
		raw = await SessionManager.list(process.cwd(), dir);
	} catch {
		return [];
	}

	return raw
		.map((info) => ({
			id: info.id,
			path: info.path,
			firstMessage: stripKnowledgeContextForDisplay(info.firstMessage ?? ""),
			modifiedAt: info.modified instanceof Date ? info.modified.getTime() : 0,
		}))
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/**
 * pi 的 AgentMessage[] → UI 友好的 UIMessage[]
 *
 * 规则：
 *   - user 文本 → UIMessage{role:"user"}
 *   - assistant 文本 → UIMessage{role:"assistant"}
 *     如果该 assistant 消息有工具调用，把工具名标到这个 UIMessage 的 tools 上
 *   - toolResult / 纯工具调用 / 自定义类型 → 忽略（历史里 tool 状态不重要）
 */
export function piMessagesToUIMessages(messages: AgentMessage[]): UIMessage[] {
	const result: UIMessage[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = stripKnowledgeContextForDisplay(extractText(msg));
			if (text.trim()) {
				result.push({
					id: `u-${result.length}`,
					role: "user",
					content: text,
					tools: [],
				});
			}
		} else if (msg.role === "assistant") {
			const text = extractText(msg);
			const tools = extractToolNames(msg);
			if (text.trim() || tools.length > 0) {
				result.push({
					id: `a-${result.length}`,
					role: "assistant",
					content: text,
					tools: tools.map((name) => ({ name, status: "done" as const })),
				});
			}
		}
		// 忽略 toolResult 等其他类型
	}

	return result;
}

function extractText(msg: AgentMessage): string {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part): part is { type: string; text: string } => {
				if (typeof part !== "object" || part === null) return false;
				const p = part as Record<string, unknown>;
				return p.type === "text" && typeof p.text === "string";
			})
			.map((p) => p.text)
			.join("");
	}
	return "";
}

function extractToolNames(msg: AgentMessage): string[] {
	const content = (msg as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];
	const names: string[] = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null) continue;
		const p = part as Record<string, unknown>;
		if (p.type === "tool_call" || p.type === "toolCall") {
			if (typeof p.name === "string") names.push(p.name);
			else if (typeof p.toolName === "string") names.push(p.toolName);
		}
	}
	return names;
}
