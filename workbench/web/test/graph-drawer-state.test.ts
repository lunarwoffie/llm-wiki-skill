import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphOpenPagePayload, Selection } from "@llm-wiki/graph-engine";
import {
	artifactDrawer,
	closedDrawer,
	graphReaderDrawer,
	graphSelectionDrawer,
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
		assert.deepEqual(graphSelectionDrawer(selectionFixture(), "Alpha", "note"), {
			mode: "graph-selection",
			title: "Alpha",
			selection: selectionFixture(),
			freeText: "note",
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

function selectionFixture(): Selection {
	return {
		id: "selection-test",
		nodeIds: ["a"],
		communityIds: [],
		facts: {
			pageCount: 1,
			internalLinkCount: 0,
			communityCount: 1,
			isolatedCount: 0,
		},
		actions: [
			{ id: "summarize_page", label: "总结这一页", tone: "digest" },
		],
	};
}
