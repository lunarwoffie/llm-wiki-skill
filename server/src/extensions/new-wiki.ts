import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { DEFAULT_KNOWLEDGE_BASE_ROOT } from "../config.js";

const execFileAsync = promisify(execFile);

interface NewWikiParams {
	name: string;
	purpose: string;
}

type ToolContent = { type: "text"; text: string };

function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text } satisfies ToolContent], details };
}

function truncate(text: string): string {
	return text.length > 4096 ? text.slice(0, 4096) + "\n...[truncated]" : text;
}

function validateName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("知识库名不能为空");
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("知识库名不能包含路径分隔符");
	}
	if (trimmed === "." || trimmed === "..") {
		throw new Error("知识库名不能是 . 或 ..");
	}
	return trimmed;
}

function assertInside(baseDir: string, target: string): void {
	const resolvedBase = path.resolve(baseDir);
	const resolvedTarget = path.resolve(target);
	if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
		throw new Error("目标路径不在默认知识库根目录内");
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	const info = await stat(filePath).catch(() => null);
	return Boolean(info?.isFile());
}

async function findInitScript(): Promise<string | null> {
	const skillDir = path.join(homedir(), ".claude", "skills", "llm-wiki-skill");
	const candidates = [
		path.join(skillDir, "init-wiki.sh"),
		path.join(skillDir, "scripts", "init-wiki.sh"),
	];
	for (const candidate of candidates) {
		if (await fileExists(candidate)) return candidate;
	}
	return null;
}

export function createNewWikiExtension() {
	return function newWikiExtension(pi: ExtensionAPI) {
		pi.registerTool({
			name: "new_wiki",
			label: "新建知识库",
			description:
				"在默认知识库根目录下新建一个 llm-wiki 知识库，调用已安装的 llm-wiki-skill 初始化脚本。",
			parameters: Type.Object({
				name: Type.String(),
				purpose: Type.String(),
			}),
			async execute(_toolCallId, params: NewWikiParams) {
				let name: string;
				try {
					name = validateName(params.name);
				} catch (err) {
					return toolResult(err instanceof Error ? err.message : String(err));
				}

				const scriptPath = await findInitScript();
				if (!scriptPath) {
					return toolResult(
						"llm-wiki-skill 未安装。请先安装到 ~/.claude/skills/llm-wiki-skill/。",
						{ installed: false },
					);
				}

				const targetPath = path.join(DEFAULT_KNOWLEDGE_BASE_ROOT, name);
				try {
					assertInside(DEFAULT_KNOWLEDGE_BASE_ROOT, targetPath);
					await mkdir(DEFAULT_KNOWLEDGE_BASE_ROOT, { recursive: true });
					const { stdout, stderr } = await execFileAsync(
						scriptPath,
						[targetPath, params.purpose.trim() || name, "中文"],
						{
							timeout: 60_000,
							env: {
								HOME: homedir(),
								PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
							},
							maxBuffer: 1024 * 1024,
						},
					);

					return toolResult(`知识库已创建：~/llm-wiki/${name}`, {
						path: targetPath,
						stdout: truncate(stdout),
						stderr: truncate(stderr),
					});
				} catch (err) {
					const error = err as Error & { stdout?: string; stderr?: string };
					return toolResult(`创建知识库失败：${error.message}`, {
						path: targetPath,
						stdout: truncate(error.stdout ?? ""),
						stderr: truncate(error.stderr ?? ""),
					});
				}
			},
		});
	};
}
