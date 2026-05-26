import { useState } from "react";

import { AddExternalDialog } from "@/components/AddExternalDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { KnowledgeBaseInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
	items: KnowledgeBaseInfo[];
	currentPath: string | null;
	loading: boolean;
	error: string | null;
	onSelect: (item: KnowledgeBaseInfo) => void;
	onRefresh: () => void;
	onAddExternal: (path: string) => Promise<void>;
}

export function KnowledgeBaseSidebar({
	items,
	currentPath,
	loading,
	error,
	onSelect,
	onRefresh,
	onAddExternal,
}: Props) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const defaultItems = items.filter((i) => i.origin === "default");
	const externalItems = items.filter((i) => i.origin === "external");

	return (
		<aside className="flex h-full w-60 flex-col border-r border-input bg-muted/30">
			<div className="flex items-center justify-between border-b border-input px-4 py-3">
				<h2 className="text-sm font-semibold">知识库</h2>
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

				<Section title="默认根" hint="~/llm-wiki/">
					{defaultItems.length === 0 ? (
						<EmptyHint text="目录里还没有知识库" />
					) : (
						defaultItems.map((item) => (
							<KnowledgeBaseItem
								key={item.path}
								item={item}
								active={item.path === currentPath}
								onClick={() => onSelect(item)}
							/>
						))
					)}
				</Section>

				<Section title="外部登记" hint="config.json">
					{externalItems.length === 0 ? (
						<EmptyHint text="还没有外部库" />
					) : (
						externalItems.map((item) => (
							<KnowledgeBaseItem
								key={item.path}
								item={item}
								active={item.path === currentPath}
								onClick={() => onSelect(item)}
							/>
						))
					)}
				</Section>
			</div>

			<div className="border-t border-input p-2">
				<Button
					variant="outline"
					size="sm"
					className="w-full"
					onClick={() => setDialogOpen(true)}
				>
					+ 添加现有库
				</Button>
			</div>

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
	children,
}: {
	title: string;
	hint: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="mb-1 flex items-baseline justify-between px-2">
				<span className="text-xs font-medium text-muted-foreground">{title}</span>
				<span className="text-[10px] text-muted-foreground/60">{hint}</span>
			</div>
			<div className="space-y-0.5">{children}</div>
		</div>
	);
}

function EmptyHint({ text }: { text: string }) {
	return <div className="px-2 py-1 text-xs italic text-muted-foreground">{text}</div>;
}

function KnowledgeBaseItem({
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
