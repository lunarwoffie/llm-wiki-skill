import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { DEFAULT_KNOWLEDGE_BASE_ROOT } from "./config.js";

const execFileAsync = promisify(execFile);

export interface CreateWikiResult {
	name: string;
	path: string;
	stdout: string;
	stderr: string;
}

export function truncateOutput(text: string): string {
	return text.length > 4096 ? text.slice(0, 4096) + "\n...[truncated]" : text;
}

export function validateWikiName(name: string): string {
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

export async function createWiki(nameInput: string, purposeInput: string): Promise<CreateWikiResult> {
	const name = validateWikiName(nameInput);
	const scriptPath = await findInitScript();
	if (!scriptPath) {
		throw new Error("llm-wiki-skill 未安装。请先安装到 ~/.claude/skills/llm-wiki-skill/。");
	}

	const targetPath = path.join(DEFAULT_KNOWLEDGE_BASE_ROOT, name);
	assertInside(DEFAULT_KNOWLEDGE_BASE_ROOT, targetPath);
	await mkdir(DEFAULT_KNOWLEDGE_BASE_ROOT, { recursive: true });

	const { stdout, stderr } = await execFileAsync(
		scriptPath,
		[targetPath, purposeInput.trim() || name, "中文"],
		{
			timeout: 60_000,
			env: {
				HOME: homedir(),
				PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
			},
			maxBuffer: 1024 * 1024,
		},
	);

	return {
		name,
		path: targetPath,
		stdout: truncateOutput(stdout),
		stderr: truncateOutput(stderr),
	};
}
