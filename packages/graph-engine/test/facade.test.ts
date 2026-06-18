import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type GraphData,
  type GraphTypeFilters,
  type PinMap,
  type SelectionInput,
  type ThemeId
} from "../src";
import {
  createGraphFacadeFromRenderer,
  createGraphOfflineCapabilities,
  createGraphStandaloneCapabilities,
  createGraphWorkbenchCapabilities,
  type GraphFacadeRenderer
} from "../src/facade";

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

    assert.equal(engine.setNodeFixed("a", "fix"), true);
    assert.deepEqual(renderer.calls.at(-1), ["setNodeFixed", "a", "fix"]);

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

  it("keeps return global and reset layout as separate facade commands", () => {
    const container = { dataset: {} as Record<string, string | undefined> };
    const renderer = createFakeRenderer();
    const viewResets: number[] = [];
    const engine = createGraphFacadeFromRenderer(container, renderer, {
      data: DATA,
      theme: "shan-shui",
      capabilities: {
        onViewReset: () => viewResets.push(1)
      }
    });

    engine.focusCommunity("c1");
    assert.equal(container.dataset.llmWikiGraphFocus, "community:c1");

    engine.resetLayout();
    assert.equal(container.dataset.llmWikiGraphFocus, "community:c1");
    assert.deepEqual(renderer.calls.at(-1), ["resetLayout"]);
    assert.deepEqual(viewResets, []);

    engine.resetView();
    assert.equal(container.dataset.llmWikiGraphFocus, undefined);
    assert.deepEqual(renderer.calls.at(-1), ["resetView"]);
    assert.deepEqual(viewResets, [1]);
  });

  it("exposes shared summary payloads from current facade data and pins", () => {
    const container = { dataset: {} as Record<string, string | undefined> };
    const renderer = createFakeRenderer();
    const engine = createGraphFacadeFromRenderer(container, renderer, {
      data: DATA,
      theme: "shan-shui",
      pins: {
        "wiki/a.md": { x: 10, y: 20, coordinateSpace: "world" }
      }
    });

    const node = engine.summarizeNode("a", {
      selection: { kind: "node", id: "a" },
      searchResultIds: ["a"]
    });
    const community = engine.summarizeCommunity("c1", { selection: { kind: "community", id: "c1" } });
    const global = engine.summarizeGlobal({ searchResultIds: ["b"] });
    const search = engine.summarizeSearchResults("beta", ["b", "missing"]);
    const excluded = engine.summarizeExcludedObject({ kind: "node", nodeId: "a" }, "filter", { searchResultIds: ["a"] });

    assert.equal(node.kind, "node-summary");
    assert.equal(node.nodeId, "a");
    assert.equal(node.pinHint.pinned, true);
    assert.equal(node.selection.containsCurrentObject, true);
    assert.deepEqual(node.commands.map((command) => command.kind), ["open-detail-read", "set-fixed-position", "enter-community"]);

    assert.equal(community.kind, "community-summary");
    assert.equal(community.communityId, "c1");
    assert.deepEqual(community.selection.selectedNodeIds, ["a", "b"]);

    assert.equal(global.kind, "global-overview");
    assert.deepEqual(global.searchResultIds, ["b"]);

    assert.equal(search.kind, "search-results");
    assert.deepEqual(search.visibleResultIds, ["b"]);
    assert.deepEqual(search.unavailableResultIds, ["missing"]);

    assert.equal(excluded.kind, "excluded-object");
    assert.deepEqual(excluded.commands.map((command) => command.kind), ["show-this-object", "clear-temporary-object-display"]);

    engine.setPins({ "wiki/b.md": { x: 1, y: 2, coordinateSpace: "world" } });
    const beta = engine.summarizeNode("b");
    assert.equal(beta.kind, "node-summary");
    assert.equal(beta.pinHint.nodeId, "b");
    assert.equal(beta.pinHint.pinned, true);

    engine.setData(DATA);
    const betaAfterRefresh = engine.summarizeNode("b");
    assert.equal(betaAfterRefresh.kind, "node-summary");
    assert.equal(betaAfterRefresh.pinHint.pinned, true);
  });

  it("declares separate workbench, offline, and standalone capability contracts", async () => {
    const persistPins = async (_pins: PinMap) => {};
    const workbench = createGraphWorkbenchCapabilities({
      onOpenPage: () => {},
      onSelectionChange: () => {},
      onSelectionClear: () => {},
      onAsk: () => {},
      persistPins,
      onDragStateChange: () => {}
    });
    const offline = createGraphOfflineCapabilities({ persistPins });
    const standalone = createGraphStandaloneCapabilities();

    assert.equal(workbench.mode, "workbench");
    assert.deepEqual(Object.keys(workbench.capabilities || {}).sort(), [
      "onAsk",
      "onDragStateChange",
      "onOpenPage",
      "onSelectionChange",
      "onSelectionClear",
      "onViewReset",
      "persistPins"
    ]);

    assert.equal(offline.mode, "offline");
    assert.deepEqual(Object.keys(offline.capabilities || {}), ["persistPins"]);
    assert.equal(offline.capabilities?.onOpenPage, undefined);
    assert.equal(offline.capabilities?.onSelectionChange, undefined);
    assert.equal(offline.capabilities?.onAsk, undefined);

    assert.equal(standalone.mode, "standalone");
    assert.equal(standalone.capabilities, undefined);
    await offline.capabilities?.persistPins?.({});
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
    previewNode(id: string | null) {
      calls.push(["previewNode", id]);
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
    setNodeFixed(id: string, mode: "fix" | "unfix") {
      calls.push(["setNodeFixed", id, mode]);
      return true;
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
