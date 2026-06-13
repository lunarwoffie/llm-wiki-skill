import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphOpenPagePayload } from "@llm-wiki/graph-engine";
import {
	artifactDrawer,
	closedDrawer,
	graphReaderDrawer,
	wikiDrawer,
} from "../src/lib/drawer-state";

describe("drawer state", () => {
	it("creates mutually exclusive closed, wiki, artifact, and graph reader states", () => {
		const payload = graphPayload();

		assert.deepEqual(closedDrawer(), { mode: "closed" });
		assert.deepEqual(wikiDrawer("wiki/topics/a.md", { loading: true }), {
			mode: "wiki",
			path: "wiki/topics/a.md",
			content: "",
			loading: true,
			error: null,
		});
		assert.deepEqual(artifactDrawer([], "artifact-1"), {
			mode: "artifacts",
			artifacts: [],
			activeArtifactId: "artifact-1",
		});
		assert.deepEqual(graphReaderDrawer(payload, { content: "# Alpha" }), {
			mode: "graph-reader",
			payload,
			content: "# Alpha",
			loading: false,
			error: null,
		});
	});
});

function graphPayload(): GraphOpenPagePayload {
	return {
		path: "wiki/topics/a.md",
		node: {
			id: "a",
			title: "Alpha",
			type: "topic",
			typeLabel: "主题",
			sourcePath: "wiki/topics/a.md",
			community: "alpha",
			date: "2026-06-13",
			source: "Archive",
			isolated: false,
		},
	};
}
