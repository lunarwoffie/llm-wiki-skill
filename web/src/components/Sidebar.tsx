import { useState } from "react";

import { AddExternalDialog } from "@/components/AddExternalDialog";
import { NewWikiDialog } from "@/components/NewWikiDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConversationInfo, KnowledgeBaseInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
	knowledgeBases: KnowledgeBaseInfo[];
	currentKbPath: string | null;
	conversations: ConversationInfo[];
	currentConversationId: string | null;
	loading: boolean;
	error: string | null;
	onSelectKb: (item: KnowledgeBaseInfo) => void;
	onSelectConversation: (item: ConversationInfo) => void;
	onNewConversation: () => void;
	onRefresh: () => void;
	onAddExternal: (path: string) => Promise<void>;
	onCreateWiki: (name: string, purpose: string) => Promise<void>;
}

export function Sidebar({
	knowledgeBases,
	currentKbPath,
	conversations,
	currentConversationId,
	loading,
	error,
	onSelectKb,
	onSelectConversation,
	onNewConversation,
	onRefresh,
	onAddExternal,
	onCreateWiki,
}: Props) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [newWikiOpen, setNewWikiOpen] = useState(false);

	const defaultKbs = knowledgeBases.filter((i) => i.origin === "default");
	const externalKbs = knowledgeBases.filter((i) => i.origin === "external");

	return (
		<aside className="flex h-full w-60 flex-col border-r border-input bg-muted/30">
			<div className="flex items-center justify-between border-b border-input px-4 py-3">
				<h2 className="text-sm font-semibold">llm-wiki-agent</h2>
				<Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} title="刷新">
					{loading ? "…" : "↻"}
				</Button>
			</div>

			<div className="flex-1 space-y-4 overflow-y-auto px-2 py-3 text-sm">
				{error && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</div>
				)}

				{/* 知识库 */}
				<Section title="知识库" hint="~/llm-wiki/">
					{defaultKbs.length === 0 ? (
						<EmptyHint text="默认根为空" />
					) : (
						defaultKbs.map((item) => (
							<KbItem
								key={item.path}
								item={item}
								active={item.path === currentKbPath}
								onClick={() => onSelectKb(item)}
							/>
						))
					)}
					{externalKbs.length > 0 && (
						<div className="mt-2 border-t border-input/50 pt-2">
							<div className="mb-1 px-2 text-[10px] text-muted-foreground/60">外部</div>
							{externalKbs.map((item) => (
								<KbItem
									key={item.path}
									item={item}
									active={item.path === currentKbPath}
									onClick={() => onSelectKb(item)}
								/>
							))}
						</div>
					)}
				</Section>

				{/* 对话 */}
				{currentKbPath && (
					<Section
						title="对话"
						hint=""
						action={
							<button
								type="button"
								onClick={onNewConversation}
								className="text-[10px] text-muted-foreground hover:text-foreground"
							>
								+ 新对话
							</button>
						}
					>
						{conversations.length === 0 ? (
							<EmptyHint text="（点上方 + 新对话开始）" />
						) : (
							conversations.map((c) => (
								<ConversationItem
									key={c.id}
									item={c}
									active={c.id === currentConversationId}
									onClick={() => onSelectConversation(c)}
								/>
							))
						)}
					</Section>
				)}
			</div>

			<div className="space-y-2 border-t border-input p-2">
				<Button
					variant="default"
					size="sm"
					className="w-full"
					onClick={() => setNewWikiOpen(true)}
				>
					+ 新建知识库
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="w-full"
					onClick={() => setDialogOpen(true)}
				>
					+ 添加现有库
				</Button>
			</div>

			<NewWikiDialog
				open={newWikiOpen}
				onOpenChange={setNewWikiOpen}
				onSubmit={onCreateWiki}
			/>
			<AddExternalDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSubmit={onAddExternal}
			/>
		</aside>
	);
}

function Section({
	title,
	hint,
	action,
	children,
}: {
	title: string;
	hint?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="mb-1 flex items-baseline justify-between px-2">
				<span className="text-xs font-medium text-muted-foreground">
					{title}
					{hint && <span className="ml-1 text-[10px] opacity-60">{hint}</span>}
				</span>
				{action}
			</div>
			<div className="space-y-0.5">{children}</div>
		</div>
	);
}

function EmptyHint({ text }: { text: string }) {
	return <div className="px-2 py-1 text-xs italic text-muted-foreground">{text}</div>;
}

function KbItem({
	item,
	active,
	onClick,
}: {
	item: KnowledgeBaseInfo;
	active: boolean;
	onClick: () => void;
}) {
	const isDisabled = !item.valid;

	const inner = (
		<button
			type="button"
			onClick={onClick}
			disabled={isDisabled}
			className={cn(
				"w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
				"hover:bg-accent hover:text-accent-foreground",
				"disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
				active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
			)}
			title={item.path}
		>
			<span className="mr-1.5">{active ? "●" : "○"}</span>
			{item.name}
		</button>
	);

	if (!item.valid && item.reason) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div>{inner}</div>
				</TooltipTrigger>
				<TooltipContent side="right">
					<div className="text-xs">{item.reason}</div>
					<div className="mt-1 text-[10px] opacity-70">{item.path}</div>
				</TooltipContent>
			</Tooltip>
		);
	}

	return inner;
}

function ConversationItem({
	item,
	active,
	onClick,
}: {
	item: ConversationInfo;
	active: boolean;
	onClick: () => void;
}) {
	const time = item.modifiedAt ? new Date(item.modifiedAt) : null;
	const timeLabel = time ? `${time.getMonth() + 1}/${time.getDate()} ${pad(time.getHours())}:${pad(time.getMinutes())}` : "";
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
				"hover:bg-accent hover:text-accent-foreground",
				active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
			)}
			title={item.firstMessage}
		>
			<div className="truncate">{item.firstMessage || "（无消息）"}</div>
			{timeLabel && <div className="text-[10px] opacity-60">{timeLabel}</div>}
		</button>
	);
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}
