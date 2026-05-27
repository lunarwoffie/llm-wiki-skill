import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CommandMenu } from "@/components/CommandMenu";
import { MarkdownView } from "@/components/MarkdownView";
import { RefMenu } from "@/components/RefMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	type CommandItem,
	listCommands,
	listRefs,
	type ModelInfo,
	type PageRef,
	streamPrompt,
	type UIMessage,
} from "@/lib/api";

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

function fromUIMessage(m: UIMessage): Message {
	return {
		id: m.id,
		role: m.role,
		content: m.content,
		tools: m.tools.map((t) => ({ name: t.name, status: "done" as const })),
	};
}

/**
 * 多轮对话主区。
 *
 * 阶段一 step 8 + review 修：
 *   - 接受 initialMessages（历史消息）作为初始状态
 *   - 父组件通过 key 在切换会话时强制重挂载本组件
 *   - 顶部状态条按 PRODUCT.md §5.2 占位三栏（KB / 模型 / 设置）
 *   - 删除"等待 agent 响应…"文字，改用 ▍ 光标
 */
interface Props {
	currentKnowledgeBaseName: string | null;
	currentKnowledgeBasePath: string | null;
	model: ModelInfo | null;
	initialMessages: UIMessage[];
	onMessageSent?: () => void;
	onOpenSettings?: () => void;
	onOpenPage?: (path: string) => void;
}

export function ChatPanel({
	currentKnowledgeBaseName,
	currentKnowledgeBasePath,
	model,
	initialMessages,
	onMessageSent,
	onOpenSettings,
	onOpenPage,
}: Props) {
	const [messages, setMessages] = useState<Message[]>(() => initialMessages.map(fromUIMessage));
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [ingestDismissedFor, setIngestDismissedFor] = useState<string | null>(null);
	const [commands, setCommands] = useState<CommandItem[]>([]);
	const [commandMenu, setCommandMenu] = useState<{ open: boolean; query: string; start: number; selected: number }>({
		open: false,
		query: "",
		start: 0,
		selected: 0,
	});
	const [refMenu, setRefMenu] = useState<{ open: boolean; query: string; start: number; selected: number }>({
		open: false,
		query: "",
		start: 0,
		selected: 0,
	});
	const [refs, setRefs] = useState<PageRef[]>([]);
	const abortRef = useRef<AbortController | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const detectedMaterial = (() => {
		const text = input.trim();
		if (/^https?:\/\/\S+$/.test(text)) return { kind: "URL", value: text };
		if (/^(\/|~\/)\S+$/.test(text)) return { kind: "路径", value: text };
		return null;
	})();
	const ingestChipVisible = Boolean(
		detectedMaterial && ingestDismissedFor !== detectedMaterial.value,
	);

	useEffect(() => {
		listCommands()
			.then(setCommands)
			.catch(() => setCommands([]));
	}, [currentKnowledgeBaseName]);

	useEffect(() => {
		if (!refMenu.open || !currentKnowledgeBasePath) {
			setRefs([]);
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			listRefs(currentKnowledgeBasePath, refMenu.query)
				.then((items) => {
					if (!cancelled) setRefs(items);
				})
				.catch(() => {
					if (!cancelled) setRefs([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [currentKnowledgeBasePath, refMenu.open, refMenu.query]);

	const updateMenus = (value: string, cursor: number) => {
		const before = value.slice(0, cursor);
		const commandMatch = before.match(/(^|\s)\/(\S*)$/);
		if (commandMatch) {
			const query = commandMatch[2] ?? "";
			setCommandMenu({ open: true, query, start: cursor - query.length - 1, selected: 0 });
			setRefMenu((prev) => ({ ...prev, open: false }));
			return;
		}
		const refMatch = before.match(/(^|\s)@(\S*)$/);
		if (refMatch && currentKnowledgeBasePath) {
			const query = refMatch[2] ?? "";
			setRefMenu({ open: true, query, start: cursor - query.length - 1, selected: 0 });
			setCommandMenu((prev) => ({ ...prev, open: false }));
			return;
		}
		setCommandMenu((prev) => ({ ...prev, open: false }));
		setRefMenu((prev) => ({ ...prev, open: false }));
	};

	const visibleCommands = (() => {
		const normalized = commandMenu.query.toLowerCase();
		const filtered = commands.filter((item) => {
			if (!normalized) return true;
			return (
				item.slug.toLowerCase().includes(normalized) ||
				item.name.toLowerCase().includes(normalized) ||
				item.description.toLowerCase().includes(normalized)
			);
		});
		return [
			...filtered.filter((item) => item.source === "builtin"),
			...filtered.filter((item) => item.source !== "builtin"),
		];
	})();

	const replaceCommandToken = (item: CommandItem) => {
		const textarea = textareaRef.current;
		const cursor = textarea?.selectionStart ?? input.length;
		const next = `${input.slice(0, commandMenu.start)}${item.slug} ${input.slice(cursor)}`;
		const nextCursor = commandMenu.start + item.slug.length + 1;
		setInput(next);
		setCommandMenu((prev) => ({ ...prev, open: false }));
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
		});
	};

	const replaceRefToken = (item: PageRef) => {
		const textarea = textareaRef.current;
		const cursor = textarea?.selectionStart ?? input.length;
		const link = `[[${item.path}]]`;
		const next = `${input.slice(0, refMenu.start)}${link} ${input.slice(cursor)}`;
		const nextCursor = refMenu.start + link.length + 1;
		setInput(next);
		setRefMenu((prev) => ({ ...prev, open: false }));
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
		});
	};

	const sendPrompt = async () => {
		const text = input.trim();
		if (!text || status === "streaming") return;
		const outgoingText =
			ingestChipVisible && detectedMaterial
				? `请调用 llm-wiki Skill 把以下素材消化到当前知识库的 raw/，完成后回到对话告诉我落地路径：\n${detectedMaterial.value}`
				: text;

		setErrorMsg(null);
		setInput("");
		setIngestDismissedFor(null);
		const userMsg: Message = { id: newId(), role: "user", content: text, tools: [] };
		const assistantId = newId();
		const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", tools: [] };
		setMessages((prev) => [...prev, userMsg, assistantMsg]);
		setStatus("streaming");

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const stream = await streamPrompt(outgoingText, controller.signal);
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
					onMessageSent?.();
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
		if (e.key === "Escape" && (commandMenu.open || refMenu.open)) {
			e.preventDefault();
			setCommandMenu((prev) => ({ ...prev, open: false }));
			setRefMenu((prev) => ({ ...prev, open: false }));
			return;
		}
		if (commandMenu.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			e.preventDefault();
			const max = Math.max(visibleCommands.length - 1, 0);
			setCommandMenu((prev) => ({
				...prev,
				selected:
					e.key === "ArrowDown"
						? prev.selected >= max
							? 0
							: prev.selected + 1
						: prev.selected <= 0
							? max
							: prev.selected - 1,
			}));
			return;
		}
		if (refMenu.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			e.preventDefault();
			const max = Math.max(refs.length - 1, 0);
			setRefMenu((prev) => ({
				...prev,
				selected:
					e.key === "ArrowDown"
						? prev.selected >= max
							? 0
							: prev.selected + 1
						: prev.selected <= 0
							? max
							: prev.selected - 1,
			}));
			return;
		}
		if (commandMenu.open && e.key === "Enter" && visibleCommands[commandMenu.selected]) {
			e.preventDefault();
			replaceCommandToken(visibleCommands[commandMenu.selected]);
			return;
		}
		if (refMenu.open && e.key === "Enter" && refs[refMenu.selected]) {
			e.preventDefault();
			replaceRefToken(refs[refMenu.selected]);
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			sendPrompt();
		}
	};

	const lastAssistantId = messages
		.slice()
		.reverse()
		.find((m) => m.role === "assistant")?.id;
	const showCursorOn = status === "streaming" ? lastAssistantId : null;

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center justify-between border-b border-input px-6 py-3">
				<div className="min-w-0 truncate">
					<div className="text-xs text-muted-foreground">当前知识库</div>
					<div className="truncate text-sm font-medium">
						{currentKnowledgeBaseName ?? <span className="italic opacity-60">未选择</span>}
					</div>
				</div>
				<div className="flex items-center gap-2 text-xs">
					{messages.length > 0 && (
						<span className="text-muted-foreground">{messages.length} 条消息</span>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="cursor-help rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
								🤖 {model ? `${model.provider}/${model.id}` : "无活跃模型"}
							</span>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<div className="text-xs">模型路由切换在阶段三</div>
							<div className="mt-0.5 text-[10px] opacity-70">
								当前由 pi-agent 默认配置决定（~/.pi/agent/settings.json）
							</div>
						</TooltipContent>
					</Tooltip>
					<button
						type="button"
						onClick={onOpenSettings}
						className="rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					>
						⚙ 设置
					</button>
				</div>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto bg-card p-6">
				{messages.length === 0 && (
					<div className="text-sm text-muted-foreground">
						{currentKnowledgeBaseName ? (
							<>
								试试问：<code className="rounded bg-muted px-1.5 py-0.5">列出我知识库里的页面</code>
							</>
						) : (
							<>左侧选一个知识库进入对话</>
						)}
					</div>
				)}
				{messages.map((m) => (
					<MessageBubble
						key={m.id}
						message={m}
						showCursor={m.id === showCursorOn}
						onOpenPage={onOpenPage}
					/>
				))}
			</div>

			{errorMsg && (
				<div className="mx-6 my-2 whitespace-pre-wrap rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
					{errorMsg}
				</div>
			)}

			<div className="border-t border-input p-4">
				{ingestChipVisible && detectedMaterial && (
					<div className="mb-2 flex max-w-xl items-center justify-between gap-3 rounded-md border border-input bg-muted px-3 py-2 text-xs text-muted-foreground">
						<span className="truncate">检测到{detectedMaterial.kind}，发送时将作为消化素材</span>
						<button
							type="button"
							onClick={() => setIngestDismissedFor(detectedMaterial.value)}
							className="rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
							aria-label="关闭消化提示"
						>
							<X className="size-3.5" />
						</button>
					</div>
				)}
				<div className="relative">
					<CommandMenu
						open={commandMenu.open}
						query={commandMenu.query}
						items={visibleCommands}
						selectedIndex={commandMenu.selected}
						onSelect={replaceCommandToken}
					/>
					<RefMenu
						open={refMenu.open}
						query={refMenu.query}
						items={refs}
						selectedIndex={refMenu.selected}
						onSelect={replaceRefToken}
					/>
					<textarea
						ref={textareaRef}
						value={input}
						onChange={(e) => {
							setInput(e.target.value);
							if (e.target.value.trim() !== ingestDismissedFor) setIngestDismissedFor(null);
							updateMenus(e.target.value, e.target.selectionStart);
						}}
						onClick={(e) => updateMenus(e.currentTarget.value, e.currentTarget.selectionStart)}
						onKeyUp={(e) => {
							if (["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
							updateMenus(e.currentTarget.value, e.currentTarget.selectionStart);
						}}
						onKeyDown={handleKeyDown}
						rows={3}
						className="w-full rounded-md border border-input bg-background p-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						placeholder={
							currentKnowledgeBaseName
								? "输入消息… Cmd/Ctrl + Enter 发送"
								: "请先在左侧选择一个知识库…"
						}
						disabled={status === "streaming" || !currentKnowledgeBaseName}
					/>
				</div>
				<div className="mt-2 flex items-center justify-between">
					<span className="text-xs text-muted-foreground">状态：{status}</span>
					<Button onClick={sendPrompt} disabled={status === "streaming" || !input.trim() || !currentKnowledgeBaseName}>
						{status === "streaming" ? "等待中…" : "发送"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function MessageBubble({
	message,
	showCursor,
	onOpenPage,
}: {
	message: Message;
	showCursor: boolean;
	onOpenPage?: (path: string) => void;
}) {
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
				<div className="break-words">
					{isUser ? (
						<span className="whitespace-pre-wrap">{message.content}</span>
					) : (
						<MarkdownView content={message.content} onOpenPage={onOpenPage} />
					)}
					{showCursor && <span className="animate-cursor-blink ml-0.5">▍</span>}
				</div>
			</div>
		</div>
	);
}
