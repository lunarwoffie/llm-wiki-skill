import { useCallback, useEffect, useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { Sidebar } from "@/components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	type ActiveContext,
	type ConversationInfo,
	createNewConversation,
	getActiveContext,
	type KnowledgeBaseInfo,
	listConversations,
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	selectConversation,
	selectKnowledgeBase,
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

	const applyActive = (ctx: ActiveContext) => {
		setActive(ctx);
		setInitialMessages(ctx.conversation.messages);
		setChatKey((k) => k + 1);
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

	const handleMessageSent = async () => {
		// 用户发了一次消息后，刷新对话列表，把 "(新对话)" stub 替换为带 firstMessage 的真实条目
		if (active) await refreshConversations(active.kb.path);
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
				/>
				<main className="flex-1 overflow-hidden">
					<ChatPanel
						key={chatKey}
						currentKnowledgeBaseName={active?.kb.name ?? null}
						model={active?.model ?? null}
						initialMessages={initialMessages}
						onMessageSent={handleMessageSent}
					/>
				</main>
			</div>
		</TooltipProvider>
	);
}

export default App;
