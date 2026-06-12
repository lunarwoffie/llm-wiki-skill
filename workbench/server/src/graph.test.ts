import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { graphLayoutPath, readGraphLayout, writeGraphLayout } from "./graph.js";

test("graph layout read/write roundtrip stores kb-local pins", async () => {
	const kbPath = await tempKb();
	try {
		const written = await writeGraphLayout(kbPath, {
			pins: {
				"wiki/topics/agent.md": { x: 412.5, y: -88.2 },
				"wiki/entities/tool.md": { x: 130, y: 245.7 },
			},
		});
		assert.equal(written.layout.version, 1);
		assert.deepEqual(written.layout.pins["wiki/topics/agent.md"], { x: 412.5, y: -88.2 });
		assert.ok(written.layout.updatedAt);

		const stored = JSON.parse(await readFile(graphLayoutPath(kbPath), "utf8"));
		assert.equal(stored.version, 1);
		assert.deepEqual(stored.pins, written.layout.pins);

		const readBack = await readGraphLayout(kbPath);
		assert.deepEqual(readBack.layout.pins, written.layout.pins);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout treats missing or damaged files as empty", async () => {
	const kbPath = await tempKb();
	try {
		assert.deepEqual((await readGraphLayout(kbPath)).layout.pins, {});

		await writeFile(graphLayoutPath(kbPath), "{not-json", "utf8");
		assert.deepEqual((await readGraphLayout(kbPath)).layout.pins, {});
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout filters unsafe keys and invalid positions", async () => {
	const kbPath = await tempKb();
	try {
		const result = await writeGraphLayout(kbPath, {
			pins: {
				"wiki/valid.md": { x: 1, y: 2 },
				"/absolute.md": { x: 3, y: 4 },
				"wiki/../escape.md": { x: 5, y: 6 },
				"raw/not-wiki.md": { x: 7, y: 8 },
				"wiki/bad.md": { x: Number.NaN, y: 9 },
			},
		});
		assert.deepEqual(result.layout.pins, {
			"wiki/valid.md": { x: 1, y: 2 },
		});
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

async function tempKb(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-layout-"));
}
