/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 8 完整端点：
 *   GET    /api/health                          心跳
 *   POST   /api/echo                            诊断回显
 *   POST   /api/prompt                          发消息（SSE 回 agent 事件流）
 *
 *   GET    /api/knowledge-bases                 列出所有已知知识库
 *   POST   /api/knowledge-bases/external        登记外部库
 *   DELETE /api/knowledge-bases/external        取消登记
 *
 *   GET    /api/knowledge-base                  当前活跃上下文（含 kb + conversation + messages）
 *   POST   /api/knowledge-base                  选择 KB（自动加载/新建对话）
 *   DELETE /api/knowledge-base                  清空活跃上下文
 *
 *   GET    /api/conversations?kb=<path>         列出某 KB 下所有对话
 *   POST   /api/conversations                   切到指定对话 body: {kbPath, conversationId}
 *   POST   /api/conversations/new               在指定 KB 新建对话 body: {kbPath}
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
	artifactEvents,
	getArtifact,
	isValidArtifactId,
	listArtifacts,
	resolveArtifactFile,
	type ArtifactCreatedEvent,
} from "./artifacts.js";
import {
	bootstrapFromConfig,
	clearActive,
	createNewConversation,
	getActive,
	getActiveSession,
	listLoadedSkills,
	selectConversation,
	selectKb,
} from "./agent.js";
import { getAuthStatus, setAuthKey, testAuthConnection } from "./auth.js";
import { loadConfig, saveConfig } from "./config.js";
import { listConversations, piMessagesToUIMessages } from "./conversations.js";

/** 从 session 安全取出模型 provider+id（pi 类型未导出 Model，用结构化访问） */
function extractModelInfo(session: AgentSession): { provider: string; id: string } | null {
	const model = (session.state as { model?: { provider?: unknown; id?: unknown } }).model;
	if (
		model &&
		typeof model.provider === "string" &&
		typeof model.id === "string"
	) {
		return { provider: model.provider, id: model.id };
	}
	return null;
}
import {
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	unregisterExternalKnowledgeBase,
} from "./knowledge-bases.js";
import { listPageRefs, readWikiPage } from "./pages.js";
import { createWiki } from "./wiki-init.js";

const app = new Hono();

app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: Date.now(),
		service: "llm-wiki-agent/server",
	});
});

app.post("/api/echo", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	return c.json({ ok: true, received: body });
});

// ============= 知识库列表（库的管理） =============

app.get("/api/knowledge-bases", async (c) => {
	try {
		const items = await listKnowledgeBases();
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/knowledge-bases/external", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	try {
		const result = await registerExternalKnowledgeBase(body.path);
		return c.json({ ok: true, ...result });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.delete("/api/knowledge-bases/external", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	const result = await unregisterExternalKnowledgeBase(body.path);
	return c.json({ ok: true, ...result });
});

app.post("/api/knowledge-bases/new", async (c) => {
	let body: { name?: unknown; purpose?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.name !== "string" || typeof body.purpose !== "string") {
		return c.json({ ok: false, error: "Missing 'name' or 'purpose'" }, 400);
	}
	try {
		const result = await createWiki(body.name, body.purpose);
		return c.json({
			ok: true,
			info: {
				path: result.path,
				name: result.name,
				origin: "default",
				valid: true,
			},
			stdout: result.stdout,
			stderr: result.stderr,
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= 活跃上下文（当前选中的 KB + 对话） =============

app.get("/api/knowledge-base", async (c) => {
	const ctx = getActive();
	if (!ctx) return c.json({ ok: true, active: null });
	return c.json({
		ok: true,
		active: {
			kb: ctx.kb,
			conversation: {
				id: ctx.conversationId,
				messages: piMessagesToUIMessages(ctx.session.state.messages),
			},
			model: extractModelInfo(ctx.session),
		},
	});
});

app.post("/api/knowledge-base", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	try {
		const ctx = await selectKb(body.path);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: {
					id: ctx.conversationId,
					isNew: ctx.isNew,
					messages: piMessagesToUIMessages(ctx.session.state.messages),
				},
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.delete("/api/knowledge-base", async (c) => {
	await clearActive();
	return c.json({ ok: true });
});

// ============= Wiki 页面引用候选 =============

app.get("/api/refs", async (c) => {
	const kbPath = c.req.query("kb");
	if (!kbPath) return c.json({ ok: false, error: "Missing query param 'kb'" }, 400);
	const q = c.req.query("q") ?? "";
	const rawLimit = Number(c.req.query("limit") ?? 20);
	const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
	try {
		const items = await listPageRefs(kbPath, q, limit);
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.get("/api/page", async (c) => {
	const kbPath = c.req.query("kb");
	const relPath = c.req.query("path");
	if (!kbPath || !relPath) {
		return c.json({ ok: false, error: "Missing query params 'kb' or 'path'" }, 400);
	}
	try {
		const content = await readWikiPage(kbPath, relPath);
		return c.json({ ok: true, content });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= Slash 命令列表 =============

app.get("/api/commands", async (c) => {
	try {
		const queryValue = c.req.query("includeUserGlobal");
		const includeUserGlobal =
			queryValue === "true" ||
			(queryValue === undefined && (await loadConfig()).showUserGlobalSkills === true);
		const builtin = [
			{
				slug: "/sediment",
				name: "sediment_to_wiki",
				description: "把当前对话结晶为 wiki/synthesis/sessions/ 下的页面",
				source: "builtin",
				skillPath: null,
			},
			{
				slug: "/new-wiki",
				name: "new_wiki",
				description: "在默认目录下新建一个 llm-wiki 知识库",
				source: "builtin",
				skillPath: null,
			},
		];
		const skills = (await listLoadedSkills())
			.filter((skill) => includeUserGlobal || skill.source !== "user-global")
			.map((skill) => ({
				slug: `/${skill.name}`,
				name: skill.name,
				description: skill.description,
				source: skill.source,
				skillPath: skill.skillPath,
			}));
		return c.json({ ok: true, items: [...builtin, ...skills] });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.get("/api/config", async (c) => {
	try {
		return c.json({ ok: true, config: await loadConfig() });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/config", async (c) => {
	let body: { showUserGlobalSkills?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	try {
		const current = await loadConfig();
		const next = {
			...current,
			...(typeof body.showUserGlobalSkills === "boolean"
				? { showUserGlobalSkills: body.showUserGlobalSkills }
				: {}),
		};
		await saveConfig(next);
		return c.json({ ok: true, config: next });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

// ============= 产物 Artifacts =============

app.get("/api/artifacts", (c) => {
	const conversationId = c.req.query("conversation");
	return c.json({ ok: true, items: listArtifacts(conversationId) });
});

app.get("/api/artifacts/:id", (c) => {
	const id = c.req.param("id");
	if (!isValidArtifactId(id)) {
		return c.json({ ok: false, error: "Invalid artifact id" }, 400);
	}
	const manifest = getArtifact(id);
	if (!manifest) return c.json({ ok: false, error: "Artifact not found" }, 404);
	return c.json({ ok: true, manifest });
});

app.get("/api/artifacts/:id/files/:filename", async (c) => {
	const id = c.req.param("id");
	const filename = c.req.param("filename");
	if (!isValidArtifactId(id)) {
		return c.json({ ok: false, error: "Invalid artifact id" }, 400);
	}
	try {
		const file = resolveArtifactFile(id, filename);
		const body = await readFile(file.path);
		return new Response(body, {
			headers: {
				"Content-Type": file.mimeType,
				"Content-Length": String(file.sizeBytes),
				"Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes("不存在") || message.includes("不在 manifest") ? 404 : 400;
		return c.json({ ok: false, error: message }, status);
	}
});

// ============= 模型认证 =============

app.get("/api/auth/status", async (c) => {
	try {
		return c.json({ ok: true, ...(await getAuthStatus()) });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/auth/set", async (c) => {
	let body: { provider?: unknown; type?: unknown; key?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (body.type !== "api_key" || typeof body.provider !== "string" || typeof body.key !== "string") {
		return c.json({ ok: false, error: "Missing provider/type/key" }, 400);
	}
	try {
		await setAuthKey(body.provider, body.key);
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/auth/test", async (c) => {
	let body: { provider?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.provider !== "string") {
		return c.json({ ok: false, error: "Missing provider" }, 400);
	}
	const result = await testAuthConnection(body.provider);
	return c.json(result);
});

// ============= 对话列表与切换 =============

app.get("/api/conversations", async (c) => {
	const kbPath = c.req.query("kb");
	if (!kbPath) {
		return c.json({ ok: false, error: "Missing query param 'kb'" }, 400);
	}
	try {
		const items = await listConversations(kbPath);
		// 新建后未发消息的活跃对话，pi 不会写盘 → list 不含 → UI 找不到。
		// 这里前置一个合成 stub 让 UI 看得到。
		const ctx = getActive();
		if (
			ctx &&
			ctx.kb.path === kbPath &&
			!items.some((i) => i.id === ctx.conversationId)
		) {
			items.unshift({
				id: ctx.conversationId,
				path: "",
				firstMessage: "(新对话)",
				modifiedAt: Date.now(),
			});
		}
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/conversations", async (c) => {
	let body: { kbPath?: unknown; conversationId?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.kbPath !== "string" || typeof body.conversationId !== "string") {
		return c.json({ ok: false, error: "Missing 'kbPath' or 'conversationId'" }, 400);
	}
	try {
		const ctx = await selectConversation(body.kbPath, body.conversationId);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: {
					id: ctx.conversationId,
					isNew: false,
					messages: piMessagesToUIMessages(ctx.session.state.messages),
				},
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/conversations/new", async (c) => {
	let body: { kbPath?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.kbPath !== "string") {
		return c.json({ ok: false, error: "Missing 'kbPath'" }, 400);
	}
	try {
		const ctx = await createNewConversation(body.kbPath);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: { id: ctx.conversationId, isNew: true, messages: [] },
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= Prompt（agent 事件流） =============

app.post("/api/prompt", async (c) => {
	let body: { message?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	const message = body.message;
	if (typeof message !== "string" || !message.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'message'" }, 400);
	}

	return streamSSE(c, async (stream) => {
		let session;
		try {
			session = await getActiveSession();
		} catch (err) {
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({
					message: err instanceof Error ? err.message : String(err),
					hint: "请先在侧栏选择一个知识库",
				}),
			});
			return;
		}

		const unsubscribe = session.subscribe(async (event) => {
			try {
				if (event.type === "message_update") {
					const inner = event.assistantMessageEvent;
					if (inner.type === "text_delta") {
						await stream.writeSSE({ event: "text_delta", data: inner.delta });
					}
				} else if (event.type === "tool_execution_start") {
					await stream.writeSSE({
						event: "tool_start",
						data: JSON.stringify({
							toolName: event.toolName,
							toolCallId: event.toolCallId,
						}),
					});
				} else if (event.type === "tool_execution_end") {
					await stream.writeSSE({
						event: "tool_end",
						data: JSON.stringify({
							toolName: event.toolName,
							toolCallId: event.toolCallId,
						}),
					});
				}
			} catch {
				// 客户端断开，吞
			}
		});
		const onArtifactCreated = async (event: ArtifactCreatedEvent) => {
			if (event.conversationId !== getActive()?.conversationId) return;
			try {
				await stream.writeSSE({
					event: "artifact_created",
					data: JSON.stringify({
						id: event.id,
						kind: event.kind,
						title: event.title,
					}),
				});
			} catch {
				// 客户端断开，吞
			}
		};
		artifactEvents.on("artifact_created", onArtifactCreated);

		try {
			await session.prompt(message);
			await stream.writeSSE({ event: "done", data: "" });
		} catch (err) {
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({
					message: err instanceof Error ? err.message : String(err),
				}),
			});
		} finally {
			unsubscribe();
			artifactEvents.off("artifact_created", onArtifactCreated);
		}
	});
});

const PORT = Number(process.env.PORT ?? 8787);

// 阻塞启动直到 bootstrap 完成。首次启动约 1-2s（pi ResourceLoader + 恢复 session），
// 换来前端首次 fetch 一致性。dev 模式 tsx watch 重启也会经历此延迟，可接受。
await bootstrapFromConfig();

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`[llm-wiki-agent/server] listening on http://localhost:${info.port}`);
	console.log(`  GET    /api/health`);
	console.log(`  POST   /api/echo`);
	console.log(`  POST   /api/prompt`);
	console.log(`  GET    /api/knowledge-bases`);
	console.log(`  POST   /api/knowledge-bases/external`);
	console.log(`  DELETE /api/knowledge-bases/external`);
	console.log(`  GET    /api/knowledge-base`);
	console.log(`  POST   /api/knowledge-base`);
	console.log(`  DELETE /api/knowledge-base`);
	console.log(`  GET    /api/conversations?kb=<path>`);
	console.log(`  POST   /api/conversations`);
	console.log(`  POST   /api/conversations/new`);
	console.log(`  GET    /api/artifacts?conversation=<id>`);
	console.log(`  GET    /api/artifacts/:id`);
	console.log(`  GET    /api/artifacts/:id/files/:filename`);
	console.log(`  GET    /api/config`);
	console.log(`  POST   /api/config`);
});
