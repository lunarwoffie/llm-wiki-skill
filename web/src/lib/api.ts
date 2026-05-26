/**
 * api.ts - 类型化的后端调用层
 *
 * 所有走 Vite proxy 到 :8787 的后端调用集中在这里，
 * UI 组件不直接 fetch，避免散落与类型漂移。
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

export async function getCurrentKnowledgeBase(): Promise<CurrentKnowledgeBase | null> {
	const res = await fetch("/api/knowledge-base");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = (await res.json()) as { ok: boolean; current: CurrentKnowledgeBase | null };
	return json.current;
}

export async function setCurrentKnowledgeBase(path: string): Promise<CurrentKnowledgeBase> {
	const res = await fetch("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		current?: CurrentKnowledgeBase;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.current) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.current;
}

export async function clearCurrentKnowledgeBase(): Promise<void> {
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

export async function resetSession(): Promise<void> {
	await fetch("/api/reset", { method: "POST" });
}

/**
 * 流式 prompt：返回一个 AsyncGenerator of SSE 消息。调用方按 event 类型分发。
 */
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
