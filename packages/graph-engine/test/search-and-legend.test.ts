import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGraphSearchState, resolveNextGraphSearchFocus } from "../src/render";
import type { GraphNode } from "../src/types";

describe("graph scoped search", () => {
  it("matches nodes through the shared search helpers and marks non-matches faded", () => {
    const nodes = searchNodes();
    const state = resolveGraphSearchState(nodes, "attention");

    assert.equal(state.query, "attention");
    assert.deepEqual(state.matchIds, ["A"]);
    assert.deepEqual(
      state.nodes.map((node) => [node.id, node.searchState]),
      [["A", "match"], ["B", "faded"], ["C", "faded"]]
    );
  });

  it("restores all nodes for an empty query and reuses a cached index", () => {
    const nodes = searchNodes();
    const first = resolveGraphSearchState(nodes, "source");
    const second = resolveGraphSearchState(nodes, "", first.searchIndex);

    assert.equal(second.searchIndex, first.searchIndex);
    assert.deepEqual(second.matchIds, ["A", "B", "C"]);
    assert.deepEqual(second.nodes.map((node) => node.searchState), ["none", "none", "none"]);
  });

  it("cycles focus through search matches and handles empty results", () => {
    assert.deepEqual(resolveNextGraphSearchFocus(["A", "B", "C"], null), { id: "A", index: 0 });
    assert.deepEqual(resolveNextGraphSearchFocus(["A", "B", "C"], "A"), { id: "B", index: 1 });
    assert.deepEqual(resolveNextGraphSearchFocus(["A", "B", "C"], "C"), { id: "A", index: 0 });
    assert.deepEqual(resolveNextGraphSearchFocus([], "A"), { id: null, index: -1 });
  });
});

function searchNodes(): GraphNode[] {
  return [
    { id: "A", label: "Attention", type: "topic", content: "Transformer attention notes." },
    { id: "B", label: "Embeddings", type: "entity", content: "Vector source material." },
    { id: "C", label: "Retrieval", type: "source", content: "Indexing and recall." }
  ];
}
