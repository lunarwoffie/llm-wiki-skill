import { ExternalLink, X } from "lucide-react";
import type { BatchDigestEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface BatchDigestJob {
	id: string;
	kbPath: string;
	status: "running" | "done" | "error";
	total: number;
	completed: number;
	failed: number;
	current?: string;
	outputDir?: string;
	error?: string;
	files: BatchDigestFileState[];
	events: BatchDigestEvent[];
}

export interface BatchDigestFileState {
	index: number;
	filePath: string;
	status: "queued" | "running" | "done" | "error";
	chars?: number;
	outputPath?: string;
	error?: string;
}

interface Props {
	job: BatchDigestJob | null;
	onClose: () => void;
	onOpenOutput: (outputPath: string) => void;
}

export function BatchDigestPanel({ job, onClose, onOpenOutput }: Props) {
	if (!job) return null;
	const percent = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
	return (
		<div className="batch-panel">
			<div className="batch-header">
				<div>
					<div className="text-sm font-semibold">批量消化</div>
					<div className="text-xs text-[var(--app-muted)]">
						{job.completed} 完成 / {job.failed} 失败 / {job.total} 总数
					</div>
				</div>
				<button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
					<X className="size-4" />
				</button>
			</div>
			<div className="batch-body">
				<div className="batch-progress">
					<div className="batch-progress-bar" style={{ width: `${percent}%` }} />
				</div>
				{job.current && (
					<div className="mb-1 truncate text-xs text-[var(--app-muted)]">{job.current}</div>
				)}
				{job.files.map((file) => (
					<div
						key={`${file.index}:${file.filePath}`}
						className="batch-file"
					>
						<FileStatusIcon status={file.status} />
						<div className="min-w-0">
							<div className="truncate text-[var(--app-fg)]">{shortName(file.filePath)}</div>
							<div className="truncate text-[var(--app-muted)]">
								{file.status === "running"
									? `生成中${file.chars ? `，约 ${file.chars} 字` : ""}`
									: file.status === "done"
										? `已完成${file.chars ? `，约 ${file.chars} 字` : ""}`
										: file.status === "error"
											? file.error
											: "排队中"}
							</div>
						</div>
						{file.outputPath ? (
							<button
								type="button"
								className="icon-btn"
								onClick={() => onOpenOutput(file.outputPath as string)}
								aria-label="打开结果"
							>
								<ExternalLink className="size-3.5" />
							</button>
						) : (
							<span />
						)}
					</div>
				))}
				{job.status === "done" && (
					<div className="mt-2 text-xs text-emerald-400">已完成：{job.outputDir}</div>
				)}
				{job.status === "error" && (
					<div className="mt-2 text-xs text-destructive">{job.error}</div>
				)}
			</div>
		</div>
	);
}

function FileStatusIcon({ status }: { status: BatchDigestFileState["status"] }) {
	return <span className={cn("batch-dot", `batch-dot-${status}`)} />;
}

function shortName(filePath: string): string {
	return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}
