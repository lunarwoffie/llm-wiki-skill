/**
 * api.ts - 类型化的后端调用层
 *
 * 所有走 Vite proxy 到 :8787 的后端调用集中在这里。
 */

import { parseSSE, type SSEMessage } from "./sse";

// ============= 类型 =============

export interface KnowledgeBaseInfo {
	path: string;
	name: string;
	origin: "default" | "external";
	valid: boolean;
	reason?: string;
}

export interface CurrentKnowledgeBase {
	path: string;
	name: string;
}

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

export interface ModelInfo {
	provider: string;
	id: string;
}

export interface ActiveContext {
	kb: CurrentKnowledgeBase;
	conversation: {
		id: string;
		isNew?: boolean;
		messages: UIMessage[];
	};
	model: ModelInfo | null;
}

// ============= API =============

export async function getHealth(): Promise<{
	status: string;
	timestamp: number;
	service: string;
}> {
	const res = await fetch("/api/health");
	if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
	return res.json();
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseInfo[]> {
	const res = await fetch("/api/knowledge-bases");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = (await res.json()) as { ok: boolean; items?: KnowledgeBaseInfo[]; error?: string };
	if (!json.ok) throw new Error(json.error ?? "未知错误");
	return json.items ?? [];
}

export async function getActiveContext(): Promise<ActiveContext | null> {
	const res = await fetch("/api/knowledge-base");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = (await res.json()) as { ok: boolean; active: ActiveContext | null };
	return json.active;
}

export async function selectKnowledgeBase(path: string): Promise<ActiveContext> {
	const res = await fetch("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		active?: ActiveContext;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.active) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.active;
}

export async function clearActiveContext(): Promise<void> {
	await fetch("/api/knowledge-base", { method: "DELETE" });
}

export async function registerExternalKnowledgeBase(path: string): Promise<{
	registered: boolean;
	info: KnowledgeBaseInfo;
}> {
	const res = await fetch("/api/knowledge-bases/external", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		registered?: boolean;
		info?: KnowledgeBaseInfo;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.info) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return { registered: json.registered ?? false, info: json.info };
}

export async function unregisterExternalKnowledgeBase(path: string): Promise<{ removed: boolean }> {
	const res = await fetch("/api/knowledge-bases/external", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	});
	const json = (await res.json()) as { ok: boolean; removed?: boolean; error?: string };
	if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
	return { removed: json.removed ?? false };
}

// ============= 对话 =============

export async function listConversations(kbPath: string): Promise<ConversationInfo[]> {
	const url = `/api/conversations?kb=${encodeURIComponent(kbPath)}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = (await res.json()) as { ok: boolean; items?: ConversationInfo[]; error?: string };
	if (!json.ok) throw new Error(json.error ?? "未知错误");
	return json.items ?? [];
}

export async function selectConversation(
	kbPath: string,
	conversationId: string,
): Promise<ActiveContext> {
	const res = await fetch("/api/conversations", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kbPath, conversationId }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		active?: ActiveContext;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.active) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.active;
}

export async function createNewConversation(kbPath: string): Promise<ActiveContext> {
	const res = await fetch("/api/conversations/new", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kbPath }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		active?: ActiveContext;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.active) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.active;
}

// ============= Prompt =============

export async function streamPrompt(
	message: string,
	signal?: AbortSignal,
): Promise<AsyncGenerator<SSEMessage, void, undefined>> {
	const res = await fetch("/api/prompt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message }),
		signal,
	});
	if (!res.ok || !res.body) {
		throw new Error(`HTTP ${res.status} ${res.statusText}`);
	}
	return parseSSE(res.body);
}
