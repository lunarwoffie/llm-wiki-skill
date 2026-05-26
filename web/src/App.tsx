import { useCallback, useEffect, useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { KnowledgeBaseSidebar } from "@/components/KnowledgeBaseSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	getCurrentKnowledgeBase,
	type KnowledgeBaseInfo,
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	resetSession,
	setCurrentKnowledgeBase,
} from "@/lib/api";

/**
 * 阶段一 step 7 - 三栏布局雏形
 *
 * Layout:
 *   [Sidebar 知识库] [Chat 对话主区]
 *
 * 切库时：POST /api/knowledge-base → POST /api/reset → ChatPanel 重新挂载（chatKey 自增清状态）
 */
function App() {
	const [kbs, setKbs] = useState<KnowledgeBaseInfo[]>([]);
	const [current, setCurrent] = useState<{ path: string; name: string } | null>(null);
	const [sidebarError, setSidebarError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [chatKey, setChatKey] = useState(0);

	const refresh = useCallback(async () => {
		setLoading(true);
		setSidebarError(null);
		try {
			const [items, currentKb] = await Promise.all([
				listKnowledgeBases(),
				getCurrentKnowledgeBase(),
			]);
			setKbs(items);
			setCurrent(currentKb);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleSelect = async (item: KnowledgeBaseInfo) => {
		if (!item.valid) return;
		// 同一个库点了无操作（避免无谓 reset）
		if (item.path === current?.path) return;

		setSidebarError(null);
		try {
			const kb = await setCurrentKnowledgeBase(item.path);
			await resetSession();
			setCurrent(kb);
			// 通过递增 key 让 ChatPanel 重新挂载，清空消息状态
			setChatKey((k) => k + 1);
		} catch (err) {
			setSidebarError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleAddExternal = async (path: string) => {
		const { info } = await registerExternalKnowledgeBase(path);
		await refresh();
		// 自动切到刚加的库
		if (info.valid) {
			await handleSelect(info);
		}
	};

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen w-screen">
				<KnowledgeBaseSidebar
					items={kbs}
					currentPath={current?.path ?? null}
					loading={loading}
					error={sidebarError}
					onSelect={handleSelect}
					onRefresh={refresh}
					onAddExternal={handleAddExternal}
				/>
				<main className="flex-1 overflow-hidden">
					<ChatPanel key={chatKey} currentKnowledgeBaseName={current?.name ?? null} />
				</main>
			</div>
		</TooltipProvider>
	);
}

export default App;
