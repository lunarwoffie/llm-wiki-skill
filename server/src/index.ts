/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 4：接入 pi-coding-agent SDK，提供 /api/prompt（POST + SSE）
 * 端点：
 *   GET  /api/health    心跳
 *   POST /api/echo      JSON 回显（诊断用，未来不删）
 *   POST /api/prompt    发送用户输入，agent 事件流通过 SSE 推回
 *   POST /api/reset     重置 session（开新对话）
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { getSession, resetSession } from "./agent.js";
import {
	clearCurrentKnowledgeBase,
	getCurrentKnowledgeBase,
	setCurrentKnowledgeBase,
} from "./extensions/knowledge-base.js";
import {
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	unregisterExternalKnowledgeBase,
} from "./knowledge-bases.js";

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

app.post("/api/reset", async (c) => {
	await resetSession();
	return c.json({ ok: true });
});

// 当前知识库（GET 查询 / POST 设置 / DELETE 清空）
app.get("/api/knowledge-base", (c) => {
	const kb = getCurrentKnowledgeBase();
	return c.json({ ok: true, current: kb });
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
		const kb = await setCurrentKnowledgeBase(body.path);
		return c.json({ ok: true, current: kb });
	} catch (err) {
		return c.json(
			{
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			},
			400,
		);
	}
});

app.delete("/api/knowledge-base", (c) => {
	clearCurrentKnowledgeBase();
	return c.json({ ok: true });
});

// 所有已知知识库列表（默认根扫描 + 外部登记，带 valid 标志）
app.get("/api/knowledge-bases", async (c) => {
	try {
		const list = await listKnowledgeBases();
		return c.json({ ok: true, items: list });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

// 登记外部知识库
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

// 取消登记外部知识库
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

/**
 * POST /api/prompt
 * body: { "message": "用户输入" }
 *
 * SSE 事件类型：
 *   text_delta     data: <文本块>                    流式 token
 *   tool_start     data: {"toolName","toolCallId"}   工具调用开始
 *   tool_end       data: {"toolName","toolCallId"}   工具调用结束
 *   done           data: ""                          本次对话完成
 *   error          data: {"message","hint"?}         发生错误
 */
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
		// 1) 拿 session（首次会触发创建）
		let session: Awaited<ReturnType<typeof getSession>>;
		try {
			session = await getSession();
		} catch (err) {
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({
					message: `创建 agent session 失败：${err instanceof Error ? err.message : String(err)}`,
					hint: "确认已运行 `pi login` 或设置 ANTHROPIC_API_KEY 环境变量",
				}),
			});
			return;
		}

		// 2) 订阅事件 → 翻译成 SSE
		const unsubscribe = session.subscribe(async (event) => {
			try {
				if (event.type === "message_update") {
					const inner = event.assistantMessageEvent;
					if (inner.type === "text_delta") {
						await stream.writeSSE({
							event: "text_delta",
							data: inner.delta,
						});
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
				// 客户端可能已断开，吞掉写错误避免污染日志
			}
		});

		// 3) 跑 prompt（事件在执行期间推送），完成发 done
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
		}
	});
});

const PORT = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`[llm-wiki-agent/server] listening on http://localhost:${info.port}`);
	console.log(`  GET    /api/health`);
	console.log(`  POST   /api/echo`);
	console.log(`  POST   /api/prompt`);
	console.log(`  POST   /api/reset`);
	console.log(`  GET    /api/knowledge-base`);
	console.log(`  POST   /api/knowledge-base            body: {path}`);
	console.log(`  DELETE /api/knowledge-base`);
	console.log(`  GET    /api/knowledge-bases`);
	console.log(`  POST   /api/knowledge-bases/external  body: {path}`);
	console.log(`  DELETE /api/knowledge-bases/external  body: {path}`);
});
