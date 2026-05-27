/**
 * agent.ts - pi-coding-agent SDK 的活跃会话管理
 *
 * 阶段一 step 8：从单 in-memory session 升级为
 *   "活跃上下文 = (当前 KB, 当前对话, pi session 实例)"
 *
 * 会话持久化到 ~/.llm-wiki-agent/sessions/<kb-hash>/，由 pi SessionManager 管理。
 * 任一时刻只有一个 active session（单用户、单浏览器假设）。
 *
 * 切换逻辑：
 *   selectKb(kbPath)            → 先 dispose 老 session，再尝试 continueRecent，
 *                                 如果该 KB 无任何对话则创建新的
 *   selectConversation(kbPath, conversationId) → dispose 老 + 打开指定文件
 *   createNewConversation(kbPath)              → dispose 老 + 新建空白对话
 */

import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { loadConfig, saveConfig } from "./config.js";
import { ensureKbSessionDir, listConversations } from "./conversations.js";
import knowledgeBaseExtension from "./extensions/knowledge-base.js";
import { setCurrentKnowledgeBase } from "./extensions/knowledge-base.js";
import { createNewWikiExtension } from "./extensions/new-wiki.js";
import { createSynthesisExtension } from "./extensions/synthesis.js";

async function rememberLastUsedKb(kbPath: string): Promise<void> {
	try {
		const config = await loadConfig();
		if (config.lastUsedKbPath === kbPath) return;
		await saveConfig({ ...config, lastUsedKbPath: kbPath });
	} catch (err) {
		console.warn(`[agent] 写入 lastUsedKbPath 失败: ${err instanceof Error ? err.message : err}`);
	}
}

export interface ActiveContext {
	kb: { path: string; name: string };
	session: AgentSession;
	conversationId: string;
	isNew: boolean; // 本次 select 是否新建的会话
}

let resourceLoaderPromise: Promise<DefaultResourceLoader> | null = null;
let active: ActiveContext | null = null;

function getResourceLoader(): Promise<DefaultResourceLoader> {
	if (!resourceLoaderPromise) {
		resourceLoaderPromise = (async () => {
			const loader = new DefaultResourceLoader({
				cwd: process.cwd(),
				agentDir: getAgentDir(),
				extensionFactories: [
					knowledgeBaseExtension,
					createSynthesisExtension(() => active),
					createNewWikiExtension(),
				],
			});
			await loader.reload();
			console.log("[agent] ResourceLoader ready");
			return loader;
		})().catch((err) => {
			resourceLoaderPromise = null;
			throw err;
		});
	}
	return resourceLoaderPromise;
}

async function disposeActive(): Promise<void> {
	if (active) {
		try {
			active.session.dispose();
		} catch {
			// noop
		}
		active = null;
	}
}

export function getActive(): ActiveContext | null {
	return active;
}

export async function getActiveSession(): Promise<AgentSession> {
	if (!active) {
		throw new Error("没有活跃对话。请先选择知识库或新建对话。");
	}
	return active.session;
}

export interface LoadedSkillInfo {
	name: string;
	description: string;
}

export async function listLoadedSkills(): Promise<LoadedSkillInfo[]> {
	const loader = await getResourceLoader();
	const seen = new Set<string>();
	return loader
		.getSkills()
		.skills.filter((skill) => {
			if (seen.has(skill.name)) return false;
			seen.add(skill.name);
			return true;
		})
		.map((skill) => ({
			name: skill.name,
			description: skill.description,
		}));
}

/**
 * 选择/进入一个知识库：dispose 老 session，加载/新建该库下的活跃对话。
 *   - 该 KB 有对话：opens most recent
 *   - 该 KB 无对话：creates a new one
 */
export async function selectKb(kbPath: string): Promise<ActiveContext> {
	await disposeActive();
	const kb = await setCurrentKnowledgeBase(kbPath);
	const dir = await ensureKbSessionDir(kbPath);
	const loader = await getResourceLoader();

	const existing = await listConversations(kbPath);

	let isNew = false;
	let sessionManager: ReturnType<typeof SessionManager.create>;
	const mostRecent = existing[0];
	if (mostRecent) {
		sessionManager = SessionManager.open(mostRecent.path);
	} else {
		sessionManager = SessionManager.create(process.cwd(), dir);
		isNew = true;
	}

	const { session, modelFallbackMessage } = await createAgentSession({
		resourceLoader: loader,
		sessionManager,
	});
	if (modelFallbackMessage) console.log(`[agent] ${modelFallbackMessage}`);

	active = { kb, session, conversationId: session.sessionId, isNew };
	await rememberLastUsedKb(kbPath);
	console.log(
		`[agent] selectKb ${kb.name} → conversation ${active.conversationId.slice(0, 8)} (${isNew ? "new" : "resumed"})`,
	);
	return active;
}

/**
 * 切到该 KB 下指定的对话。
 */
export async function selectConversation(
	kbPath: string,
	conversationId: string,
): Promise<ActiveContext> {
	const list = await listConversations(kbPath);
	const target = list.find((c) => c.id === conversationId);
	if (!target) {
		throw new Error(`对话不存在：${conversationId}`);
	}

	await disposeActive();
	const kb = await setCurrentKnowledgeBase(kbPath);
	const loader = await getResourceLoader();

	const { session, modelFallbackMessage } = await createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.open(target.path),
	});
	if (modelFallbackMessage) console.log(`[agent] ${modelFallbackMessage}`);

	active = { kb, session, conversationId: session.sessionId, isNew: false };
	await rememberLastUsedKb(kbPath);
	console.log(
		`[agent] selectConversation ${kb.name} → ${active.conversationId.slice(0, 8)}`,
	);
	return active;
}

/**
 * 在该 KB 下新建一个空白对话，并设为活跃。
 */
export async function createNewConversation(kbPath: string): Promise<ActiveContext> {
	await disposeActive();
	const kb = await setCurrentKnowledgeBase(kbPath);
	const dir = await ensureKbSessionDir(kbPath);
	const loader = await getResourceLoader();

	const { session, modelFallbackMessage } = await createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.create(process.cwd(), dir),
	});
	if (modelFallbackMessage) console.log(`[agent] ${modelFallbackMessage}`);

	active = { kb, session, conversationId: session.sessionId, isNew: true };
	await rememberLastUsedKb(kbPath);
	console.log(`[agent] createNewConversation ${kb.name} → ${active.conversationId.slice(0, 8)}`);
	return active;
}

/**
 * 完全清空活跃上下文（不删除磁盘上的会话文件）。
 */
export async function clearActive(): Promise<void> {
	await disposeActive();
}

/**
 * 启动时自动恢复 config.lastUsedKbPath 指向的 KB（PRODUCT.md §5.1.1）。
 * 失败（路径已删除等）不抛错，仅记 warn。
 */
export async function bootstrapFromConfig(): Promise<void> {
	try {
		const config = await loadConfig();
		if (!config.lastUsedKbPath) return;
		await selectKb(config.lastUsedKbPath);
		console.log(`[agent] bootstrap restored: ${config.lastUsedKbPath}`);
	} catch (err) {
		console.warn(
			`[agent] bootstrap restore failed (path may be invalid or removed): ${err instanceof Error ? err.message : err}`,
		);
	}
}
