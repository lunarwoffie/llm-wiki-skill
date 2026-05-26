import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (path: string) => Promise<void>;
}

/**
 * 登记外部知识库的对话框。
 * 用户粘绝对路径，后端验证（存在 + 是目录 + 含 .wiki-schema.md）。
 */
export function AddExternalDialog({ open, onOpenChange, onSubmit }: Props) {
	const [path, setPath] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reset = () => {
		setPath("");
		setError(null);
		setSubmitting(false);
	};

	const handleSubmit = async () => {
		const trimmed = path.trim();
		if (!trimmed) {
			setError("路径不能为空");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			await onSubmit(trimmed);
			reset();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setSubmitting(false);
		}
	};

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) reset();
		onOpenChange(newOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>添加现有知识库</DialogTitle>
					<DialogDescription>
						输入一个绝对路径，目录里需要含有 <code>.wiki-schema.md</code>（由 llm-wiki-skill 初始化产生）。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-2">
					<Input
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/Users/yourname/Documents/我的知识库"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !submitting) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						autoFocus
					/>
					{error && (
						<div className="rounded-md border border-destructive bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					<Button onClick={handleSubmit} disabled={submitting}>
						{submitting ? "添加中…" : "添加"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
