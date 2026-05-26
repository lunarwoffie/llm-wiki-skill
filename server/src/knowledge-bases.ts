/**
 * knowledge-bases.ts - 知识库扫描与登记
 *
 * 数据源（PRODUCT.md §6.1 混合模式）：
 *   1. ~/llm-wiki/ 默认根 → 扫描含 .wiki-schema.md 的子目录
 *   2. ~/.llm-wiki-agent/config.json 的 externalKnowledgeBases → 用户登记的外部路径
 *
 * 返回结构含 valid 标志；失效路径不自动删除（避免数据丢失），由 UI 提示用户处理
 * （PRODUCT.md §6.7 边界场景）。
 */

import type { Dirent } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
	type AppConfig,
	DEFAULT_KNOWLEDGE_BASE_ROOT,
	loadConfig,
	saveConfig,
} from "./config.js";

export interface KnowledgeBaseInfo {
	path: string; // 绝对路径
	name: string; // 目录最后一段
	origin: "default" | "external";
	valid: boolean;
	reason?: string; // valid=false 时说明
}

/**
 * 验证给定路径是否是一个合法知识库（不抛错，返回结构化结果）。
 * 规则：路径存在 + 是目录 + 含 .wiki-schema.md
 */
export async function inspectKnowledgeBasePath(
	absolutePath: string,
): Promise<{ valid: true } | { valid: false; reason: string }> {
	const info = await stat(absolutePath).catch(() => null);
	if (!info) return { valid: false, reason: "Path does not exist" };
	if (!info.isDirectory()) return { valid: false, reason: "Not a directory" };

	const schemaInfo = await stat(join(absolutePath, ".wiki-schema.md")).catch(() => null);
	if (!schemaInfo) return { valid: false, reason: "Missing .wiki-schema.md" };

	return { valid: true };
}

/**
 * 列出所有已知知识库（默认根扫描 + 外部登记），含 valid 状态。
 * 同绝对路径去重：默认根优先于外部登记。
 */
export async function listKnowledgeBases(): Promise<KnowledgeBaseInfo[]> {
	// 1. 确保默认根存在（首次启动）
	await mkdir(DEFAULT_KNOWLEDGE_BASE_ROOT, { recursive: true });

	// 2. 扫默认根
	let entries: Dirent[] = [];
	try {
		entries = await readdir(DEFAULT_KNOWLEDGE_BASE_ROOT, { withFileTypes: true });
	} catch {
		// 极端情况（比如权限问题）：仅返回外部部分，不崩
	}

	const seen = new Set<string>();
	const results: KnowledgeBaseInfo[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".")) continue;
		const path = join(DEFAULT_KNOWLEDGE_BASE_ROOT, entry.name);
		const check = await inspectKnowledgeBasePath(path);
		results.push({
			path,
			name: entry.name,
			origin: "default",
			...(check.valid ? { valid: true } : { valid: false, reason: check.reason }),
		});
		seen.add(path);
	}

	// 3. 加外部登记
	const config = await loadConfig();
	for (const externalPath of config.externalKnowledgeBases) {
		if (seen.has(externalPath)) continue; // 已经被默认扫描覆盖
		const check = await inspectKnowledgeBasePath(externalPath);
		results.push({
			path: externalPath,
			name: basename(externalPath),
			origin: "external",
			...(check.valid ? { valid: true } : { valid: false, reason: check.reason }),
		});
		seen.add(externalPath);
	}

	// 4. 排序：default 在前，按名字
	results.sort((a, b) => {
		if (a.origin !== b.origin) return a.origin === "default" ? -1 : 1;
		return a.name.localeCompare(b.name, "zh");
	});

	return results;
}

/**
 * 登记一个外部知识库。
 * - 绝对路径化（解析 ~ 由调用方负责，这里只做 resolve）
 * - 验证有效性（路径合法、含 schema 文件）
 * - 已存在则幂等（不重复追加，不报错）
 * - 若该路径正好在默认根下，提示但仍登记（用户自己选择）
 */
export async function registerExternalKnowledgeBase(rawPath: string): Promise<{
	registered: boolean;
	path: string;
	info: KnowledgeBaseInfo;
}> {
	const absolutePath = resolve(rawPath);

	const check = await inspectKnowledgeBasePath(absolutePath);
	if (!check.valid) {
		throw new Error(`不是合法知识库（${check.reason}）：${absolutePath}`);
	}

	const config = await loadConfig();
	const alreadyRegistered = config.externalKnowledgeBases.includes(absolutePath);

	if (!alreadyRegistered) {
		const updated: AppConfig = {
			...config,
			externalKnowledgeBases: [...config.externalKnowledgeBases, absolutePath],
		};
		await saveConfig(updated);
	}

	return {
		registered: !alreadyRegistered,
		path: absolutePath,
		info: {
			path: absolutePath,
			name: basename(absolutePath),
			origin: "external",
			valid: true,
		},
	};
}

/**
 * 取消登记一个外部知识库。从 config.externalKnowledgeBases 移除（不删文件系统）。
 */
export async function unregisterExternalKnowledgeBase(rawPath: string): Promise<{
	removed: boolean;
	path: string;
}> {
	const absolutePath = resolve(rawPath);
	const config = await loadConfig();
	const before = config.externalKnowledgeBases.length;
	const after = config.externalKnowledgeBases.filter((p) => p !== absolutePath);

	if (after.length === before) {
		return { removed: false, path: absolutePath };
	}

	await saveConfig({ ...config, externalKnowledgeBases: after });
	return { removed: true, path: absolutePath };
}
