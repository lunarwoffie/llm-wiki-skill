import { useEffect } from "react";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/MarkdownView";

interface Props {
	path: string | null;
	content: string;
	loading: boolean;
	error: string | null;
	onClose: () => void;
}

export function RightDrawer({ path, content, loading, error, onClose }: Props) {
	useEffect(() => {
		if (!path) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [path, onClose]);

	if (!path) return null;
	return (
		<aside className="fixed right-0 top-0 z-30 flex h-full w-[400px] max-w-[85vw] flex-col border-l border-input bg-background shadow-xl">
			<header className="flex items-center justify-between gap-3 border-b border-input px-4 py-3">
				<div className="min-w-0 truncate font-mono text-xs">{path}</div>
				<Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
					<X className="size-4" />
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
				{loading && <div className="text-muted-foreground">加载中...</div>}
				{error && <div className="whitespace-pre-wrap text-destructive">{error}</div>}
				{!loading && !error && <MarkdownView content={content} />}
			</div>
		</aside>
	);
}
