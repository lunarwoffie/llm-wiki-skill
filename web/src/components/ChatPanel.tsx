import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { resetSession, streamPrompt } from "@/lib/api";

type ToolMark = { name: string; status: "running" | "done" };

interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	tools: ToolMark[];
}

function newId() {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * 多轮对话主区。
 *
 * 阶段一 step 7：消息状态本地，发新消息走 /api/prompt SSE。
 * 重置由父组件触发（切库时调），通过 key prop 让 React 重新挂载本组件清状态。
 */
export function ChatPanel({ currentKnowledgeBaseName }: { currentKnowledgeBaseName: string | null }) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const sendPrompt = async () => {
		const text = input.trim();
		if (!text || status === "streaming") return;

		setErrorMsg(null);
		setInput("");
		const userMsg: Message = { id: newId(), role: "user", content: text, tools: [] };
		const assistantId = newId();
		const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", tools: [] };
		setMessages((prev) => [...prev, userMsg, assistantMsg]);
		setStatus("streaming");

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const stream = await streamPrompt(text, controller.signal);
			for await (const { event, data } of stream) {
				if (event === "text_delta") {
					setMessages((prev) =>
						prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + data } : m)),
					);
				} else if (event === "tool_start") {
					const payload = JSON.parse(data) as { toolName: string };
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, tools: [...m.tools, { name: payload.toolName, status: "running" }] }
								: m,
						),
					);
				} else if (event === "tool_end") {
					const payload = JSON.parse(data) as { toolName: string };
					setMessages((prev) =>
						prev.map((m) => {
							if (m.id !== assistantId) return m;
							const tools = [...m.tools];
							for (let i = tools.length - 1; i >= 0; i--) {
								if (tools[i].name === payload.toolName && tools[i].status === "running") {
									tools[i] = { ...tools[i], status: "done" };
									break;
								}
							}
							return { ...m, tools };
						}),
					);
				} else if (event === "done") {
					setStatus("idle");
				} else if (event === "error") {
					const payload = JSON.parse(data) as { message: string; hint?: string };
					setErrorMsg(payload.message + (payload.hint ? `\n提示：${payload.hint}` : ""));
					setStatus("error");
				}
			}
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				setStatus("idle");
				return;
			}
			setErrorMsg(err instanceof Error ? err.message : String(err));
			setStatus("error");
		} finally {
			abortRef.current = null;
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			sendPrompt();
		}
	};

	const handleNewConversation = async () => {
		abortRef.current?.abort();
		await resetSession();
		setMessages([]);
		setErrorMsg(null);
		setStatus("idle");
	};

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center justify-between border-b border-input px-6 py-3">
				<div className="min-w-0 truncate">
					<div className="text-xs text-muted-foreground">当前知识库</div>
					<div className="truncate text-sm font-medium">
						{currentKnowledgeBaseName ?? <span className="italic opacity-60">未选择</span>}
					</div>
				</div>
				<Button variant="outline" size="sm" onClick={handleNewConversation} disabled={status === "streaming"}>
					新对话
				</Button>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto bg-card p-6">
				{messages.length === 0 && (
					<div className="text-sm text-muted-foreground">
						{currentKnowledgeBaseName ? (
							<>
								试试问：<code className="rounded bg-muted px-1.5 py-0.5">列出我知识库里的页面</code>
							</>
						) : (
							<>
								左侧选一个知识库进入。或先和 agent 随便聊聊也行（agent 看到的是 server cwd）。
							</>
						)}
					</div>
				)}
				{messages.map((m) => (
					<MessageBubble key={m.id} message={m} />
				))}
				{status === "streaming" &&
					messages[messages.length - 1]?.content === "" &&
					messages[messages.length - 1]?.tools.length === 0 && (
						<div className="text-xs italic text-muted-foreground">等待 agent 响应…</div>
					)}
			</div>

			{errorMsg && (
				<div className="mx-6 my-2 whitespace-pre-wrap rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
					{errorMsg}
				</div>
			)}

			<div className="border-t border-input p-4">
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					rows={3}
					className="w-full rounded-md border border-input bg-background p-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					placeholder="输入消息… Cmd/Ctrl + Enter 发送"
					disabled={status === "streaming"}
				/>
				<div className="mt-2 flex items-center justify-between">
					<span className="text-xs text-muted-foreground">状态：{status}</span>
					<Button onClick={sendPrompt} disabled={status === "streaming" || !input.trim()}>
						{status === "streaming" ? "等待中…" : "发送"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function MessageBubble({ message }: { message: Message }) {
	const isUser = message.role === "user";
	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${
					isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
				}`}
			>
				<div className="mb-1 text-xs opacity-60">{isUser ? "你" : "assistant"}</div>
				{message.tools.length > 0 && (
					<div className="mb-2 space-y-0.5">
						{message.tools.map((t, i) => (
							<div key={i} className="font-mono text-xs opacity-80">
								{t.status === "running" ? "▶" : "✓"} {t.name}
							</div>
						))}
					</div>
				)}
				<div className="whitespace-pre-wrap break-words">
					{message.content || (message.role === "assistant" ? "…" : "")}
				</div>
			</div>
		</div>
	);
}
