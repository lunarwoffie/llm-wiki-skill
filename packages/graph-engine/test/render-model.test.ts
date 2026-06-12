import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRenderableGraph, edgeOpacity, edgeStrokeWidth, makeEdgePath } from "../src/render";
import type { GraphData } from "../src/types";

function sampleGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Stage 4 Demo",
      total_nodes: 4,
      total_edges: 3
    },
    nodes: [
      { id: "topic", label: "主题", type: "topic", community: "c1", source_path: "wiki/topic.md", weight: 80, x: 20, y: 30 },
      { id: "entity", label: "实体", type: "entity", community: "c1", source_path: "wiki/entity.md", weight: 50 },
      { id: "source", label: "来源", type: "source", community: "c2", source_path: "wiki/source.md", weight: 40, x: 70, y: 60 },
      { id: "island", label: "孤岛", type: "entity", community: "c3", source_path: "wiki/island.md", weight: 10 }
    ],
    edges: [
      { id: "e1", from: "topic", to: "entity", type: "EXTRACTED", weight: 1 },
      { id: "e2", from: "topic", to: "source", type: "INFERRED", weight: 0.5 },
      { id: "missing", from: "topic", to: "missing", type: "UNVERIFIED", weight: 0.1 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "topic", recommended_start_reason: "community_hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["topic", "entity", "source", "island"], degraded: false }
      },
      communities: [
        { id: "c1", label: "核心", node_count: 2, color_index: 0, recommended_start_node_id: "topic" },
        { id: "c2", label: "来源", node_count: 1, color_index: 1 },
        { id: "c3", label: "孤岛", node_count: 1, color_index: 2 }
      ]
    }
  };
}

describe("buildRenderableGraph", () => {
  it("maps graph data to static renderable nodes, edges, communities, and minimap points", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });

    assert.equal(graph.counts.totalNodes, 4);
    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.communities.length, 3);
    assert.equal(graph.densityMode, "card");
    assert.equal(graph.nodes.find((node) => node.id === "topic")?.visualRole, "index-slip");
    assert.equal(graph.edges[0].type, "extracted");
    assert.match(graph.edges[0].path, /^M \d+ \d+ Q /);
    assert.equal(graph.minimap.path, "M8 40 C34 20 54 36 76 22 C98 8 118 24 150 12");
    assert.equal(graph.minimap.nodes.length, 4);
  });

  it("uses pins as the cold-start coordinates when a node source path matches", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/entity.md": { x: 800, y: 340 }
      }
    });

    const pinned = graph.nodes.find((node) => node.id === "entity");
    assert.ok(pinned);
    assert.equal(pinned.x, 80);
    assert.equal(pinned.y, 50);
    assert.deepEqual(pinned.point, { x: 800, y: 340 });
  });

  it("infers wiki-relative source paths for graph data without source_path", () => {
    const data = sampleGraph();
    data.nodes = data.nodes.map(({ source_path: _sourcePath, ...node }) => node);
    const graph = buildRenderableGraph(data, {
      theme: "shan-shui",
      pins: {
        "wiki/topics/topic.md": { x: 900, y: 408 }
      }
    });

    const topic = graph.nodes.find((node) => node.id === "topic");
    assert.ok(topic);
    assert.equal(topic.sourcePath, "wiki/topics/topic.md");
    assert.deepEqual(topic.point, { x: 900, y: 408 });
  });

  it("marks selected nodes and preserves cinnabar visual role", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "mo-ye",
      selection: { kind: "node", id: "source" }
    });

    const selected = graph.nodes.find((node) => node.id === "source");
    assert.ok(selected);
    assert.equal(selected.selected, true);
    assert.equal(selected.visualRole, "cinnabar-note");
    assert.equal(graph.minimap.nodes.find((node) => node.id === "source")?.selected, true);
  });
});

describe("edge drawing helpers", () => {
  it("keeps graph-wash stroke strength bounds", () => {
    assert.equal(edgeStrokeWidth({ weight: 0 }), 1.1);
    assert.equal(edgeStrokeWidth({ weight: 1 }), 2.9);
    assert.equal(edgeOpacity({ weight: 0 }), 0.32);
    assert.equal(edgeOpacity({ weight: 1 }), 0.76);
  });

  it("builds a curved path from atlas node coordinates", () => {
    const path = makeEdgePath(
      { id: "a", label: "A", type: "entity", kind: "概念", community: "c1", x: 10, y: 20 },
      { id: "b", label: "B", type: "entity", kind: "概念", community: "c1", x: 60, y: 70 },
      { weight: 0.5 }
    );

    assert.equal(path, "M 100 136 Q 274 284 600 476");
  });
});
