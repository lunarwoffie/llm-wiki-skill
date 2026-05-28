import { useCallback, useEffect, useState } from "react";

import { BatchDigestPanel, type BatchDigestJob } from "@/components/BatchDigestPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { RightDrawer } from "@/components/RightDrawer";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Sidebar } from "@/components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	type ActiveContext,
	type ConversationInfo,
	createNewConversation,
	createKnowledgeBase,
	type ArtifactManifest,
	getActiveContext,
	type KnowledgeBaseInfo,
	listArtifacts,
	listConversations,
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	readPage,
	selectConversation,
	selectKnowledgeBase,
	streamBatchDigest,
	type UIMessage,
} from "@/lib/api";

/**
 * 阶段一 step 8 - 阶段一完结
 *
 * Layout:
 *   [Sidebar 知识库 + 对话列表] [ChatPanel 对话主区]
 *
 * 切库联动：
 *   1. POST /api/knowledge-base → 后端自动选/新建该库最近对话
 *   2. 拿到 active 后刷新 conversations 列表
 *   3. chatKey++ 让 ChatPanel 重挂载（载入历史消息）
 *
 * 切对话联动：
 *   1. POST /api/conversations { kbPath, conversationId }
 *   2. ChatPanel 重挂载
 *
 * 新建对话：
 *   1. POST /api/conversations/new
 *   2. 刷新 conversations 列表（含合成 stub）
 *   3. ChatPanel 重挂载
 */
function App() {
	const [kbs, setKbs] = useState<KnowledgeBaseInfo[]>([]);
	const [active, setActive] = useState<ActiveContext | null>(null);
	const [conversations, setConversations] = useState<ConversationInfo[]>([]);
	const [sidebarError, setSidebarError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [chatKey, setChatKey] = useState(0);
	const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [drawerMode, setDrawerMode] = useState<"closed" | "wiki" | "artifacts">("closed");
	const [drawerPage, setDrawerPage] = useState<string | null>(null);
	const [drawerContent, setDrawerContent] = useState("");
	const [drawerLoading, setDrawerLoading] = useState(false);
	const [drawerError, setDrawerError] = useState<string | null>(null);
	const [artifacts, setArtifacts] = useState<ArtifactManifest[]>([]);
	const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
	const [drawerFullscreen, setDrawerFullscreen] = useState(false);
	const [batchJob, setBatchJob] = useState<BatchDigestJob | null>(null);
	const activeConversationId = active?.conversation.id ?? null;

	const refreshConversations = useCallback(async (kbPath: string) => {
		try {
			const items = await listConversations(kbPath);
			setConversations(items);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const refreshAll = useCallback(async () => {
		setLoading(true);
		setSidebarError(null);
		try {
			const [items, currentActive] = await Promise.all([
				listKnowledgeBases(),
				getActiveContext(),
			]);
			setKbs(items);
			setActive(currentActive);
			if (currentActive) {
				await refreshConversations(currentActive.kb.path);
			} else {
				setConversations([]);
				setArtifacts([]);
				setActiveArtifactId(null);
			}
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [refreshConversations]);

	useEffect(() => {
		refreshAll();
	}, [refreshAll]);

	useEffect(() => {
		if (!activeConversationId) return;
		let cancelled = false;
		listArtifacts(activeConversationId)
			.then((items) => {
				if (cancelled) return;
				setArtifacts(items);
				setActiveArtifactId((current) =>
					current && items.some((item) => item.id === current)
						? current
						: items.at(-1)?.id ?? null,
				);
			})
			.catch((err) => {
				if (!cancelled) setSidebarError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [activeConversationId]);

	const applyActive = (ctx: ActiveContext) => {
		setActive(ctx);
		setInitialMessages(ctx.conversation.messages);
		setChatKey((k) => k + 1);
		setDrawerMode("closed");
		setActiveArtifactId(null);
		setArtifacts([]);
	};

	const handleSelectKb = async (item: KnowledgeBaseInfo) => {
		if (!item.valid) return;
		if (item.path === active?.kb.path) return;

		setSidebarError(null);
		try {
			const ctx = await selectKnowledgeBase(item.path);
			applyActive(ctx);
			await refreshConversations(item.path);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleSelectConversation = async (item: ConversationInfo) => {
		if (!active) return;
		if (item.id === active.conversation.id) return;

		setSidebarError(null);
		try {
			const ctx = await selectConversation(active.kb.path, item.id);
			applyActive(ctx);
			await refreshConversations(active.kb.path);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleNewConversation = async () => {
		if (!active) return;
		setSidebarError(null);
		try {
			const ctx = await createNewConversation(active.kb.path);
			applyActive(ctx);
			await refreshConversations(active.kb.path);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleAddExternal = async (path: string) => {
		const { info } = await registerExternalKnowledgeBase(path);
		await refreshAll();
		if (info.valid) await handleSelectKb(info);
	};

	const handleCreateWiki = async (name: string, purpose: string) => {
		const info = await createKnowledgeBase(name, purpose);
		await refreshAll();
		await handleSelectKb(info);
	};

	const handleMessageSent = async () => {
		// 用户发了一次消息后，刷新对话列表，把 "(新对话)" stub 替换为带 firstMessage 的真实条目
		if (active) await refreshConversations(active.kb.path);
	};

	const handleOpenPage = async (pagePath: string) => {
		if (!active) return;
		setDrawerMode("wiki");
		setDrawerPage(pagePath);
		setDrawerLoading(true);
		setDrawerError(null);
		try {
			setDrawerContent(await readPage(active.kb.path, pagePath));
		} catch (err) {
			setDrawerContent("");
			setDrawerError(err instanceof Error ? err.message : String(err));
		} finally {
			setDrawerLoading(false);
		}
	};

	const refreshArtifacts = async (conversationId: string, focusId?: string) => {
		const items = await listArtifacts(conversationId);
		setArtifacts(items);
		setActiveArtifactId(focusId ?? items.at(-1)?.id ?? null);
		setDrawerMode("artifacts");
	};

	const handleOpenArtifacts = () => {
		if (artifacts.length === 0) return;
		setActiveArtifactId((current) =>
			current && artifacts.some((item) => item.id === current)
				? current
				: artifacts.at(-1)?.id ?? null,
		);
		setDrawerMode("artifacts");
	};

	const handleArtifactCreated = async (id: string) => {
		if (!active) return;
		try {
			await refreshArtifacts(active.conversation.id, id);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleStartBatchDigest = (input: {
		kbPath: string;
		filePaths: string[];
		sourceRoot?: string;
		concurrency: 1 | 3 | 5;
	}) => {
		const jobId = Math.random().toString(36).slice(2, 10);
		setBatchJob({
			id: jobId,
			status: "running",
			total: input.filePaths.length,
			completed: 0,
			failed: 0,
			events: [],
		});
		void (async () => {
			try {
				const stream = await streamBatchDigest(input);
				for await (const message of stream) {
					if (message.event === "error") {
						const payload = JSON.parse(message.data) as { message: string };
						throw new Error(payload.message);
					}
					const event = JSON.parse(message.data);
					setBatchJob((current) => {
						if (!current || current.id !== jobId) return current;
						if (event.type === "start") {
							return {
								...current,
								total: event.total,
								outputDir: event.outputDir,
								events: [...current.events, event],
							};
						}
						if (event.type === "file_start") {
							return {
								...current,
								current: event.filePath,
								events: [...current.events, event],
							};
						}
						if (event.type === "file_complete") {
							return {
								...current,
								completed: current.completed + 1,
								current: event.filePath,
								events: [...current.events, event],
							};
						}
						if (event.type === "file_error") {
							return {
								...current,
								failed: current.failed + 1,
								current: event.filePath,
								events: [...current.events, event],
							};
						}
						if (event.type === "done") {
							return {
								...current,
								status: "done",
								completed: event.completed,
								failed: event.failed,
								outputDir: event.outputDir,
								events: [...current.events, event],
							};
						}
						return current;
					});
				}
			} catch (err) {
				setBatchJob((current) =>
					current && current.id === jobId
						? {
								...current,
								status: "error",
								error: err instanceof Error ? err.message : String(err),
							}
						: current,
				);
			}
		})();
	};

	const handleConfigChanged = async () => {
		try {
			const currentActive = await getActiveContext();
			setActive(currentActive);
			if (currentActive) {
				setInitialMessages(currentActive.conversation.messages);
			}
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen w-screen">
				<Sidebar
					knowledgeBases={kbs}
					currentKbPath={active?.kb.path ?? null}
					conversations={conversations}
					currentConversationId={active?.conversation.id ?? null}
					loading={loading}
					error={sidebarError}
					onSelectKb={handleSelectKb}
					onSelectConversation={handleSelectConversation}
					onNewConversation={handleNewConversation}
					onRefresh={refreshAll}
					onAddExternal={handleAddExternal}
					onCreateWiki={handleCreateWiki}
					onStartBatchDigest={handleStartBatchDigest}
				/>
				<main className="flex-1 overflow-hidden">
					<ChatPanel
						key={chatKey}
						currentKnowledgeBaseName={active?.kb.name ?? null}
						model={active?.model ?? null}
						initialMessages={initialMessages}
						onMessageSent={handleMessageSent}
						onOpenSettings={() => setSettingsOpen(true)}
						currentKnowledgeBasePath={active?.kb.path ?? null}
						onOpenPage={handleOpenPage}
						onArtifactCreated={handleArtifactCreated}
						artifactCount={artifacts.length}
						onOpenArtifacts={handleOpenArtifacts}
						onStartBatchDigest={handleStartBatchDigest}
					/>
				</main>
				<RightDrawer
					mode={drawerMode}
					wiki={{
						path: drawerPage,
						content: drawerContent,
						loading: drawerLoading,
						error: drawerError,
					}}
					artifacts={artifacts}
					activeArtifactId={activeArtifactId}
					fullscreen={drawerFullscreen}
					onSelectArtifact={setActiveArtifactId}
					onToggleFullscreen={() => setDrawerFullscreen((value) => !value)}
					onClose={() => setDrawerMode("closed")}
				/>
				<SettingsPanel
					open={settingsOpen}
					onOpenChange={setSettingsOpen}
					onConfigChanged={handleConfigChanged}
				/>
				<BatchDigestPanel job={batchJob} onClose={() => setBatchJob(null)} />
			</div>
		</TooltipProvider>
	);
}

export default App;
