import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type GraphData,
  type GraphTypeFilters,
  type PinMap,
  type SelectionInput,
  type ThemeId
} from "../src";
import { createGraphFacadeFromRenderer, type GraphFacadeRenderer } from "../src/facade";

const DATA: GraphData = {
  meta: {
    build_date: "2026-06-16",
    wiki_title: "Facade test graph",
    total_nodes: 2,
    total_edges: 1
  },
  nodes: [
    {
      id: "a",
      label: "Alpha",
      type: "topic",
      community: "c1",
      source_path: "wiki/a.md",
      content: "Alpha content"
    },
    {
      id: "b",
      label: "Beta",
      type: "source",
      community: "c1",
      source_path: "wiki/b.md",
      content: "Beta content"
    }
  ],
  edges: [
    {
      id: "a->b",
      from: "a",
      to: "b",
      type: "EXTRACTED",
      confidence: "EXTRACTED",
      relation_type: "实现",
      weight: 1
    }
  ]
};

describe("GraphFacade", () => {
  it("owns the public engine lifecycle around a renderer", async () => {
    const container = { dataset: {} as Record<string, string | undefined> };
    const renderer = createFakeRenderer();
    const engine = createGraphFacadeFromRenderer(container, renderer, {
      data: DATA,
      theme: "shan-shui"
    });

    assert.equal(container.dataset.llmWikiGraphEngine, "mounted");
    assert.equal(container.dataset.llmWikiGraphTheme, "shan-shui");

    engine.setTheme("mo-ye");
    assert.equal(container.dataset.llmWikiGraphTheme, "mo-ye");
    assert.deepEqual(renderer.calls.at(-1), ["setTheme", "mo-ye"]);

    engine.focusNode("wiki/a.md");
    assert.equal(container.dataset.llmWikiGraphFocus, "wiki/a.md");
    assert.deepEqual(renderer.calls.at(-1), ["focusNode", "wiki/a.md"]);

    engine.clearInteraction();
    assert.equal(container.dataset.llmWikiGraphFocus, undefined);
    assert.deepEqual(renderer.calls.at(-1), ["clearInteraction"]);

    await engine.applyDiff({ addedNodes: ["c"] });
    assert.deepEqual(renderer.calls.at(-1), ["applyDiff", { addedNodes: ["c"] }, undefined]);

    engine.destroy();
    assert.equal(container.dataset.llmWikiGraphEngine, undefined);
    assert.equal(container.dataset.llmWikiGraphTheme, undefined);
    assert.equal(renderer.calls.at(-1)?.[0], "destroy");
    assert.throws(() => engine.resetView(), /Graph engine has been destroyed/);
  });

  it("resolves selections against refreshed data", () => {
    const container = { dataset: {} as Record<string, string | undefined> };
    const renderer = createFakeRenderer();
    const nextData: GraphData = {
      ...DATA,
      nodes: DATA.nodes.map((node) => node.id === "a"
        ? { ...node, community: "c2" }
        : node)
    };
    const engine = createGraphFacadeFromRenderer(container, renderer, {
      data: DATA,
      theme: "shan-shui"
    });

    assert.deepEqual(engine.select({ kind: "node", id: "a" }).communityIds, ["c1"]);

    engine.setData(nextData);
    const selection = engine.select({ kind: "node", id: "a" });

    assert.deepEqual(selection.communityIds, ["c2"]);
    assert.deepEqual(renderer.calls.at(-2), ["setData", nextData, undefined]);
    assert.deepEqual(renderer.calls.at(-1), ["select", { kind: "node", id: "a" }]);
  });
});

function createFakeRenderer(): GraphFacadeRenderer & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async applyDiff(diff, options) {
      calls.push(["applyDiff", diff, options]);
    },
    isDragging() {
      calls.push(["isDragging"]);
      return false;
    },
    setData(data: GraphData, pins?: PinMap) {
      calls.push(["setData", data, pins]);
    },
    focusNode(path: string) {
      calls.push(["focusNode", path]);
    },
    focusCommunity(id: string) {
      calls.push(["focusCommunity", id]);
    },
    setTypeFilters(filters: GraphTypeFilters) {
      calls.push(["setTypeFilters", filters]);
    },
    resetView() {
      calls.push(["resetView"]);
    },
    select(selection: SelectionInput) {
      calls.push(["select", selection]);
    },
    clearSelection() {
      calls.push(["clearSelection"]);
    },
    clearInteraction() {
      calls.push(["clearInteraction"]);
    },
    setTheme(theme: ThemeId) {
      calls.push(["setTheme", theme]);
    },
    setPins(pins: PinMap) {
      calls.push(["setPins", pins]);
    },
    resetLayout() {
      calls.push(["resetLayout"]);
    },
    destroy() {
      calls.push(["destroy"]);
    }
  };
}
