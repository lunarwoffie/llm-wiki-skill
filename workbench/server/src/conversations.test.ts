import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { piMessagesToUIMessages } from "./conversations.js";

test("piMessagesToUIMessages renders history summaries for tool calls and results", () => {
	const messages = piMessagesToUIMessages([
		userMessage("请读取文件"),
		assistantMessage("我来读取。", [
			{
				type: "toolCall",
				id: "call-1",
				name: "read",
				arguments: { path: `${homedir()}/wiki/index.md` },
			},
		]),
		toolResultMessage("call-1", "read", "读取完成", false),
	]);

	assert.deepEqual(messages, [
		{ id: "u-0", role: "user", content: "请读取文件", tools: [] },
		{
			id: "a-1",
			role: "assistant",
			content: "我来读取。",
			tools: [{ name: "读取 ~/wiki/index.md：读取完成", status: "done" }],
		},
	]);
});

test("piMessagesToUIMessages uses best-effort summary for old incomplete tool calls", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("", [{ type: "tool_call", toolName: "bash" }]),
	]);

	assert.deepEqual(messages, [
		{
			id: "a-0",
			role: "assistant",
			content: "",
			tools: [{ name: "历史工具调用：bash", status: "done" }],
		},
	]);
});

test("piMessagesToUIMessages omits empty summaries for messages without tools", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("普通回答", []),
	]);

	assert.deepEqual(messages, [
		{ id: "a-0", role: "assistant", content: "普通回答", tools: [] },
	]);
});

test("piMessagesToUIMessages does not invent details missing from tool results", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("执行命令。", [
			{ type: "toolCall", id: "call-2", name: "bash", arguments: {} },
		]),
		toolResultMessage("call-2", "bash", "", true),
	]);

	assert.deepEqual(messages[0]?.tools, [
		{ name: "历史工具调用：bash 失败", status: "done" },
	]);
});

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as AgentMessage;
}

function assistantMessage(text: string, extra: unknown[]): AgentMessage {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text", text }] : []),
			...extra,
		],
	} as AgentMessage;
}

function toolResultMessage(
	toolCallId: string,
	toolName: string,
	text: string,
	isError: boolean,
): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: text ? [{ type: "text", text }] : [],
		isError,
	} as AgentMessage;
}
