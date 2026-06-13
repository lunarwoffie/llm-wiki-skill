import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveWikiPagePath } from "./pages.js";

test("resolveWikiPagePath rejects traversal outside the wiki directory", () => {
	const kbPath = path.join("/", "tmp", "kb");
	assert.equal(
		resolveWikiPagePath(kbPath, "wiki/topics/agent.md"),
		path.join(kbPath, "wiki", "topics", "agent.md"),
	);
	assert.throws(() => resolveWikiPagePath(kbPath, "wiki/../purpose.md"), /inside wiki/);
	assert.throws(() => resolveWikiPagePath(kbPath, "raw/source.md"), /inside wiki/);
	assert.throws(() => resolveWikiPagePath(kbPath, "/tmp/kb/wiki/topics/agent.md"), /relative/);
});
