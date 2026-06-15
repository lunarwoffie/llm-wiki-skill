import { type CSSProperties, useEffect, useRef } from "react";

import { Download, FileText, Maximize2, Minimize2, X } from "lucide-react";

import { ArtifactView } from "@/components/ArtifactView";
import { GraphReader } from "@/components/GraphReader";
import { GraphSelection } from "@/components/GraphSelection";
import { MarkdownView } from "@/components/MarkdownView";
import type { DrawerState } from "@/lib/drawer-state";
import { getArtifactFileUrl, type ArtifactManifest } from "@/lib/api";
import type { GraphReaderActionId } from "@/lib/graph-reader";
import { cn } from "@/lib/utils";

interface Props {
	drawer: DrawerState;
	fullscreen: boolean;
	width: number;
	defaultWidth: number;
	onSelectArtifact: (id: string) => void;
	onOpenPage: (path: string) => void;
	onWikiLinkSeen: (path: string) => void;
	onGraphReaderAction: (actionId: GraphReaderActionId) => void;
	onGraphSelectionTextChange: (value: string) => void;
	onGraphSelectionNeighbors: () => void;
	onGraphSelectionAsk: (actionId: string | null, newConversation: boolean) => void;
	onResize: (width: number) => void;
	onToggleFullscreen: () => void;
	onClose: (reason: "button" | "escape") => void;
}

const KIND_ICON: Record<ArtifactManifest["kind"], string> = {
	html: "🌐",
	pdf: "📄",
	docx: "📝",
	pptx: "📊",
	xlsx: "📋",
};

export function RightDrawer({
	drawer,
	fullscreen,
	width,
	defaultWidth,
	onSelectArtifact,
	onOpenPage,
	onWikiLinkSeen,
	onGraphReaderAction,
	onGraphSelectionTextChange,
	onGraphSelectionNeighbors,
	onGraphSelectionAsk,
	onResize,
	onToggleFullscreen,
	onClose,
}: Props) {
	const dragStart = useRef<{ x: number; width: number } | null>(null);

	useEffect(() => {
		return () => {
			document.body.classList.remove("drawer-resizing");
		};
	}, []);

	useEffect(() => {
		if (drawer.mode === "closed") return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose("escape");
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [drawer.mode, onClose]);

	if (drawer.mode === "closed") return null;
	const activeArtifact = drawer.mode === "artifacts"
		? drawer.artifacts.find((item) => item.id === drawer.activeArtifactId) ?? null
		: null;
	const title = drawerTitle(drawer, activeArtifact);
	return (
		<aside
			className={cn("drawer-panel drawer-panel-open", fullscreen && "drawer-panel-fullscreen")}
			style={{ "--drawer-width": `${width}px` } as CSSProperties}
		>
			{!fullscreen && (
				<div
					className="drawer-resize-handle"
					role="separator"
					aria-label="调整预览区宽度"
					aria-orientation="vertical"
					tabIndex={0}
					onDoubleClick={() => onResize(defaultWidth)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							onResize(width + 24);
						}
						if (event.key === "ArrowRight") {
							event.preventDefault();
							onResize(width - 24);
						}
						if (event.key === "Home") {
							event.preventDefault();
							onResize(defaultWidth);
						}
					}}
					onPointerDown={(event) => {
						event.preventDefault();
						dragStart.current = { x: event.clientX, width };
						document.body.classList.add("drawer-resizing");
						const target = event.currentTarget;
						target.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (!dragStart.current) return;
						const delta = dragStart.current.x - event.clientX;
						onResize(dragStart.current.width + delta);
					}}
					onPointerUp={(event) => {
						dragStart.current = null;
						document.body.classList.remove("drawer-resizing");
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							event.currentTarget.releasePointerCapture(event.pointerId);
						}
					}}
					onPointerCancel={(event) => {
						dragStart.current = null;
						document.body.classList.remove("drawer-resizing");
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							event.currentTarget.releasePointerCapture(event.pointerId);
						}
					}}
				/>
			)}
			<header className="drawer-header">
				<div className="drawer-title">
					{title}
				</div>
				<div className="flex items-center gap-1">
					{activeArtifact && (
						<button
							type="button"
							className="icon-btn"
							aria-label="下载"
							onClick={() => {
								const link = document.createElement("a");
								link.href = getArtifactFileUrl(activeArtifact.id, activeArtifact.primaryFile);
								link.download = activeArtifact.primaryFile;
								link.click();
							}}
						>
							<Download className="size-4" />
						</button>
					)}
					<button type="button" className="icon-btn" onClick={onToggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏"}>
						{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
					</button>
					<button type="button" className="icon-btn" onClick={() => onClose("button")} aria-label="关闭">
						<X className="size-4" />
					</button>
				</div>
			</header>
			{drawer.mode === "artifacts" && (
				<div className="drawer-tabs">
					{drawer.artifacts.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => onSelectArtifact(item.id)}
							className={cn("drawer-tab", item.id === drawer.activeArtifactId && "drawer-tab-active")}
						>
							{KIND_ICON[item.kind]} {item.metadata.title.slice(0, 12)}
						</button>
					))}
				</div>
			)}
			<div className="drawer-content">
				{drawer.mode === "wiki" && (
					<>
						{drawer.loading && <div className="text-muted-foreground">加载中...</div>}
						{drawer.error && <div className="whitespace-pre-wrap text-destructive">{drawer.error}</div>}
						{!drawer.loading && !drawer.error && <MarkdownView content={drawer.content} onOpenPage={onOpenPage} />}
					</>
				)}
				{drawer.mode === "graph-reader" && (
					<GraphReader
						payload={drawer.payload}
						content={drawer.content}
						loading={drawer.loading}
						error={drawer.error}
						onOpenPage={onOpenPage}
						onWikiLinkSeen={onWikiLinkSeen}
						onAction={onGraphReaderAction}
					/>
				)}
				{drawer.mode === "graph-selection" && (
					<GraphSelection
						title={drawer.title}
						selection={drawer.selection}
						freeText={drawer.freeText}
						onFreeTextChange={onGraphSelectionTextChange}
						onNeighbors={onGraphSelectionNeighbors}
						onAsk={(action) => onGraphSelectionAsk(action?.id ?? null, false)}
						onAskInNewConversation={(action) => onGraphSelectionAsk(action?.id ?? null, true)}
					/>
				)}
				{drawer.mode === "artifacts" && (
					activeArtifact ? (
						<ArtifactView manifest={activeArtifact} />
					) : (
						<div className="drawer-empty">
							<FileText className="size-9 opacity-30" />
							<span>当前对话还没有产物</span>
						</div>
					)
				)}
			</div>
		</aside>
	);
}

function drawerTitle(drawer: DrawerState, activeArtifact: ArtifactManifest | null): string {
	if (drawer.mode === "wiki") return drawer.path ?? "页面";
	if (drawer.mode === "graph-reader") return drawer.payload.node.title;
	if (drawer.mode === "graph-selection") return "选区";
	if (drawer.mode === "artifacts") return activeArtifact?.metadata.title ?? "产物";
	return "";
}
