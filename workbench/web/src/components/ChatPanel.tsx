import { useEffect, useRef, useState } from "react";
import { Files, Monitor, Moon, Send, Settings, Sun, X } from "lucide-react";

import { CommandMenu } from "@/components/CommandMenu";
import { ExportButtons } from "@/components/ExportButtons";
import { MarkdownView } from "@/components/MarkdownView";
import { RefMenu } from "@/components/RefMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	buildExportPrompt,
	type CommandItem,
	type ExportKind,
	inspectKnowledgeBasePath,
	type InspectPathResult,
	listCommands,
	listRefs,
	type ModelInfo,
	type PageRef,
	streamPrompt,
	type UIMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { extractWikiPageRefs } from "@/lib/wiki-links";

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

function isExportCommand(name: string): name is ExportKind {
	return ["pdf", "docx", "pptx", "xlsx", "html"].includes(name);
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
	onWikiLinkSeen?: (path: string) => void;
	onArtifactCreated?: (id: string) => void;
	artifactCount?: number;
	onOpenArtifacts?: () => void;
	theme?: "dark" | "light";
	onToggleTheme?: () => void;
	onStartBatchDigest?: (input: {
		kbPath: string;
		filePaths: string[];
		sourceScanId?: string;
		concurrency: 1 | 3 | 5;
	}) => void;
	pendingPrompt?: {
		id: string;
		message: string;
		displayText: string;
	} | null;
	onPendingPromptConsumed?: () => void;
}

export function ChatPanel({
	currentKnowledgeBaseName,
	currentKnowledgeBasePath,
	model,
	initialMessages,
	onMessageSent,
	onOpenSettings,
	onOpenPage,
	onWikiLinkSeen,
	onArtifactCreated,
	artifactCount = 0,
	onOpenArtifacts,
	theme = "dark",
	onToggleTheme,
	onStartBatchDigest,
	pendingPrompt,
	onPendingPromptConsumed,
}: Props) {
	const [messages, setMessages] = useState<Message[]>(() => initialMessages.map(fromUIMessage));
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [ingestDismissedFor, setIngestDismissedFor] = useState<string | null>(null);
	const [detectedBatch, setDetectedBatch] = useState<{
		path: string;
		inspect: InspectPathResult;
	} | null>(null);
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
	const consumedPendingPromptRef = useRef<string | null>(null);

	const detectedMaterial = (() => {
		const text = input.trim();
		if (/^https?:\/\/\S+$/.test(text)) return { kind: "URL", value: text };
		if (/^(\/|~\/)\S+$/.test(text)) return { kind: "路径", value: text };
		return null;
	})();
	const ingestChipVisible = Boolean(
		detectedMaterial && ingestDismissedFor !== detectedMaterial.value,
	);
	const batchChipVisible = Boolean(
		detectedBatch?.inspect.ingestibleFiles?.count && currentKnowledgeBasePath,
	);

	useEffect(() => {
		const reload = () => {
			listCommands()
				.then(setCommands)
				.catch(() => setCommands([]));
		};
		reload();
		window.addEventListener("llm-wiki-agent:commands-changed", reload);
		return () => window.removeEventListener("llm-wiki-agent:commands-changed", reload);
	}, [currentKnowledgeBaseName]);

	useEffect(() => {
		if (!refMenu.open || !currentKnowledgeBasePath) {
			const timer = window.setTimeout(() => setRefs([]), 0);
			return () => window.clearTimeout(timer);
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
			...filtered.filter((item) => item.source === "builtin" && !item.skillPath),
			...filtered.filter((item) => item.source === "builtin" && item.skillPath),
			...filtered.filter((item) => item.source === "pi-default"),
			...filtered.filter((item) => item.source === "user-global"),
		];
	})();

	const replaceCommandToken = (item: CommandItem) => {
		if (isExportCommand(item.name)) {
			setCommandMenu((prev) => ({ ...prev, open: false }));
			startExport(item.name);
			return;
		}
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

	const exportTitleSource = () =>
		messages.find((message) => message.role === "user")?.content ?? input;

	const exportDisplayText = (kind: ExportKind) => {
		const labels: Record<ExportKind, string> = {
			pdf: "PDF",
			docx: "Word 文档",
			pptx: "PPT 演示文稿",
			xlsx: "Excel 表格",
			html: "HTML 页面",
		};
		return `导出为 ${labels[kind]}`;
	};

	const slashExportKind = (text: string): ExportKind | null => {
		const match = text.trim().match(/^\/(pdf|docx|pptx|xlsx|html)$/);
		return match && isExportCommand(match[1]) ? match[1] : null;
	};

	const startExport = (kind: ExportKind) => {
		void sendPrompt(buildExportPrompt(kind, exportTitleSource()), exportDisplayText(kind));
	};

	const handleExport = (kind: ExportKind) => {
		startExport(kind);
	};

	const sendPrompt = async (overrideText?: string, displayText?: string) => {
		const text = (overrideText ?? input).trim();
		if (!text || status === "streaming") return;
		if (!overrideText) {
			const exportKind = slashExportKind(text);
			if (exportKind) {
				setCommandMenu((prev) => ({ ...prev, open: false }));
				startExport(exportKind);
				return;
			}
		}
		const outgoingText =
			!overrideText && ingestChipVisible && detectedMaterial
				? `请调用 llm-wiki Skill 把以下素材消化到当前知识库的 raw/，完成后回到对话告诉我落地路径：\n${detectedMaterial.value}`
				: text;
		const visibleText = displayText ?? text;

		setErrorMsg(null);
		setInput("");
		setIngestDismissedFor(null);
		const userMsg: Message = { id: newId(), role: "user", content: visibleText, tools: [] };
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
				} else if (event === "knowledge_search_start") {
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, tools: [...m.tools, { name: "检索当前知识库", status: "running" }] }
								: m,
						),
					);
				} else if (event === "knowledge_search_done" || event === "knowledge_search_empty") {
					const payload = JSON.parse(data) as { count: number };
					const label =
						event === "knowledge_search_empty"
							? "当前知识库未找到相关页面"
							: `已检索到 ${payload.count} 个相关页面`;
					setMessages((prev) =>
						prev.map((m) => {
							if (m.id !== assistantId) return m;
							const tools = m.tools.filter((tool) => tool.name !== "检索当前知识库");
							return { ...m, tools: [...tools, { name: label, status: "done" }] };
						}),
					);
				} else if (event === "knowledge_search_error") {
					setMessages((prev) =>
						prev.map((m) => {
							if (m.id !== assistantId) return m;
							const tools = m.tools.filter((tool) => tool.name !== "检索当前知识库");
							return {
								...m,
								tools: [...tools, { name: "知识库检索失败，已按普通对话处理", status: "done" }],
							};
						}),
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
				} else if (event === "artifact_created") {
					const payload = JSON.parse(data) as { id: string };
					onArtifactCreated?.(payload.id);
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

	useEffect(() => {
		if (!pendingPrompt || consumedPendingPromptRef.current === pendingPrompt.id) return;
		consumedPendingPromptRef.current = pendingPrompt.id;
		onPendingPromptConsumed?.();
		void sendPrompt(pendingPrompt.message, pendingPrompt.displayText);
	}, [onPendingPromptConsumed, pendingPrompt]);

	useEffect(() => {
		if (!onWikiLinkSeen) return;
		for (const message of messages) {
			if (message.role !== "assistant") continue;
			for (const path of extractWikiPageRefs(message.content)) onWikiLinkSeen(path);
		}
	}, [messages, onWikiLinkSeen]);

	const startDetectedBatchDigest = () => {
		if (!currentKnowledgeBasePath || !detectedBatch?.inspect.ingestibleFiles?.paths.length) return;
		onStartBatchDigest?.({
			kbPath: currentKnowledgeBasePath,
			filePaths: detectedBatch.inspect.ingestibleFiles.paths,
			sourceScanId: detectedBatch.inspect.ingestibleFiles.scanId,
			concurrency: 3,
		});
		setDetectedBatch(null);
	};

	const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		const droppedPath = parseDroppedPath(event.dataTransfer);
		if (!droppedPath) {
			setErrorMsg("这次拖拽没有暴露真实路径，请直接粘贴路径");
			return;
		}
		inspectKnowledgeBasePath(droppedPath)
			.then((result) => {
				if (result.isDirectory && result.ingestibleFiles?.count) {
					setDetectedBatch({ path: droppedPath, inspect: result });
					setInput(droppedPath);
				} else {
					setInput(droppedPath);
				}
			})
			.catch((err) => setErrorMsg(err instanceof Error ? err.message : String(err)));
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
		<div className="chat-screen">
			<header className="statusbar">
				<div className="statusbar-left">
					<span className="status-dot" />
					<span className="status-kb">
						{currentKnowledgeBaseName ?? <span className="italic opacity-60">未选择</span>}
					</span>
				</div>
				<div className="statusbar-right">
					<button
						type="button"
						className="status-pill status-pill-button"
						onClick={onToggleTheme}
						title={theme === "dark" ? "切换浅色主题" : "切换暗色主题"}
						aria-label={theme === "dark" ? "切换浅色主题" : "切换暗色主题"}
					>
						{theme === "dark" ? <Moon /> : <Sun />}
					</button>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="status-pill cursor-help">
								<Monitor />
								{model ? `${model.provider}/${model.id}` : "无活跃模型"}
							</span>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							<div className="text-xs">当前模型来自设置</div>
						</TooltipContent>
					</Tooltip>
					{artifactCount > 0 && (
						<button
							type="button"
							onClick={onOpenArtifacts}
							className="status-pill status-pill-button"
							title="查看产物"
						>
							<Files />
							产物 {artifactCount}
						</button>
					)}
					<button
						type="button"
						onClick={onOpenSettings}
						className="status-pill status-pill-button"
					>
						<Settings />
						设置
					</button>
				</div>
			</header>

			<div className="chat-messages">
				{messages.length === 0 && (
					<div className="chat-empty">
						<div className="chat-empty-title">
							{currentKnowledgeBaseName ? "开始和当前知识库对话" : "左侧选一个知识库进入对话"}
						</div>
						<div className="chat-empty-hint">
							{currentKnowledgeBaseName ? (
								<>可以用 <code>@</code> 引用页面，或用 <code>/</code> 调用命令。</>
							) : (
								<>选择知识库后，agent 会基于该库内容回答。</>
							)}
						</div>
					</div>
				)}
				{messages.map((m) => (
					<MessageBubble
						key={m.id}
						message={m}
						showCursor={m.id === showCursorOn}
						onOpenPage={onOpenPage}
						onWikiLinkSeen={onWikiLinkSeen}
					/>
				))}
			</div>

			{errorMsg && (
				<div className="mx-4 my-2 whitespace-pre-wrap rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
					{errorMsg}
				</div>
			)}

			<div
				className="chat-input-area"
				onDragOver={(event) => event.preventDefault()}
				onDrop={handleDrop}
			>
				<div className="chat-input-hints">
					<span className="chat-input-hint"><kbd>@</kbd> 引用页面</span>
					<span className="chat-input-hint"><kbd>/</kbd> 调用命令</span>
					<span className="chat-input-hint"><kbd>⌘↵</kbd> 发送</span>
					<span className="chat-input-hint ml-auto opacity-60">拖入文件或链接进行消化</span>
				</div>
				{batchChipVisible && detectedBatch?.inspect.ingestibleFiles && (
					<div className="input-chip">
						<button
							type="button"
							onClick={startDetectedBatchDigest}
							className="truncate text-left hover:text-foreground"
						>
							发现 {detectedBatch.inspect.ingestibleFiles.count} 个可消化文件，点击批量消化
						</button>
						<button
							type="button"
							onClick={() => setDetectedBatch(null)}
							className="rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground"
							aria-label="关闭批量消化提示"
						>
							<X className="size-3.5" />
						</button>
					</div>
				)}
				{ingestChipVisible && detectedMaterial && (
					<div className="input-chip">
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
						className="chat-textarea"
						placeholder={
							currentKnowledgeBaseName
								? "输入消息… @引用页面  /调用命令  Cmd+Enter 发送"
								: "请先在左侧选择一个知识库…"
						}
						disabled={status === "streaming" || !currentKnowledgeBaseName}
					/>
				</div>
				<ExportButtons
					disabled={!currentKnowledgeBaseName || status === "streaming" || messages.length === 0}
					disabledReason={
						!currentKnowledgeBaseName
							? "请先选择知识库"
							: status === "streaming"
								? "当前正在生成"
								: "请先开始对话"
					}
					onExport={handleExport}
				/>
				<div className="chat-send-row">
					<span className="chat-status-text">
						{status === "streaming" ? "生成中" : status === "error" ? "出错" : "就绪"}
					</span>
					<button
						type="button"
						className="send-btn"
						onClick={() => void sendPrompt()}
						disabled={status === "streaming" || !input.trim() || !currentKnowledgeBaseName}
					>
						<Send className="size-4" />
						{status === "streaming" ? "等待中" : "发送"}
					</button>
				</div>
			</div>
		</div>
	);
}

function MessageBubble({
	message,
	showCursor,
	onOpenPage,
	onWikiLinkSeen,
}: {
	message: Message;
	showCursor: boolean;
	onOpenPage?: (path: string) => void;
	onWikiLinkSeen?: (path: string) => void;
}) {
	const isUser = message.role === "user";
	return (
		<div className={cn("msg-row", isUser ? "msg-row-user" : "msg-row-assistant")}>
			<div className={cn("msg-avatar", isUser ? "msg-avatar-user" : "msg-avatar-assistant")}>
				{isUser ? "U" : "A"}
			</div>
			<div className="msg-body">
				<div className="msg-role">{isUser ? "你" : "assistant"}</div>
				{message.tools.length > 0 && (
					<div className="msg-tools">
						{message.tools.map((t, i) => (
							<div key={i} className="msg-tool">
								<span className={cn("msg-tool-dot", t.status === "running" ? "msg-tool-running" : "msg-tool-done")} />
								<span>{t.name}</span>
							</div>
						))}
					</div>
				)}
				<div className="msg-content">
					{isUser ? (
						<span className="whitespace-pre-wrap">{message.content}</span>
					) : (
						<MarkdownView content={message.content} onOpenPage={onOpenPage} onWikiLinkSeen={onWikiLinkSeen} />
					)}
					{showCursor && <span className="animate-cursor-blink ml-0.5">▍</span>}
				</div>
			</div>
		</div>
	);
}

function parseDroppedPath(dataTransfer: DataTransfer): string | null {
	for (const type of ["text/uri-list", "text/plain"]) {
		const raw = dataTransfer.getData(type).trim();
		if (!raw) continue;
		const first = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("#"));
		if (!first) continue;
		if (first.startsWith("file://")) return decodeURIComponent(new URL(first).pathname);
		if (first.startsWith("/") || first.startsWith("~/")) return first;
	}
	return null;
}
