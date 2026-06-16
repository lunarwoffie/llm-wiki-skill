import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRenderableGraph,
  edgeOpacity,
  edgeRelationClass,
  edgeStrokeWidth,
  edgeVisualOpacity,
  edgeVisualStrokeWidth,
  makeEdgePath,
  nodeDisplayModeForDensity,
  screenEffectiveDensityMode
} from "../src/render";
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
      { id: "e1", from: "topic", to: "entity", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "实现", weight: 1 },
      { id: "e2", from: "topic", to: "source", type: "INFERRED", confidence: "INFERRED", relation_type: "对比", weight: 0.5 },
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

function outlierCommunityGraph(): GraphData {
  const nodes = [
    { id: "core-a", label: "Core A", type: "entity", community: "c1", source_path: "wiki/core-a.md", weight: 70, x: 20, y: 40 },
    { id: "core-b", label: "Core B", type: "entity", community: "c1", source_path: "wiki/core-b.md", weight: 65, x: 22, y: 42 },
    { id: "core-c", label: "Core C", type: "topic", community: "c1", source_path: "wiki/core-c.md", weight: 80, x: 24, y: 39 },
    { id: "core-d", label: "Core D", type: "source", community: "c1", source_path: "wiki/core-d.md", weight: 55, x: 26, y: 41 },
    { id: "outlier", label: "Outlier", type: "entity", community: "c1", source_path: "wiki/outlier.md", weight: 35, x: 92, y: 78 }
  ];
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Outlier Fixture",
      total_nodes: nodes.length,
      total_edges: 0
    },
    nodes,
    edges: [],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "core-c", recommended_start_reason: "community_hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: nodes.map((node) => node.id), degraded: false }
      },
      communities: [
        { id: "c1", label: "Cluster", node_count: nodes.length, color_index: 0, recommended_start_node_id: "core-c" }
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
    assert.equal(graph.edges[0].confidence, "extracted");
    assert.equal(graph.edges[0].relationType, "实现");
    assert.equal(graph.edges[0].relationClass, "relation-implementation");
    assert.equal(graph.edges[1].confidence, "inferred");
    assert.equal(graph.edges[1].relationType, "对比");
    assert.equal(graph.edges[1].relationClass, "relation-contrast");
    assert.match(graph.edges[0].path, /^M \d+ \d+ Q /);
    assert.equal(graph.minimap.path, "M8 40 C34 20 54 36 76 22 C98 8 118 24 150 12");
    assert.equal(graph.minimap.nodes.length, 4);
  });

  it("uses low-weight global edges and fuller focused relation edges", () => {
    const global = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const focused = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      focus: { kind: "community", id: "c1" }
    });

    assert.equal(global.edges.find((edge) => edge.id === "e1")?.relationClass, "relation-implementation");
    assert.equal(global.edges.find((edge) => edge.id === "e2")?.relationClass, "relation-contrast");
    assert.equal(focused.edges[0].relationClass, "relation-implementation");
    assert.ok(focused.edges[0].strokeWidth > global.edges[0].strokeWidth, "focused relation edge should render with a fuller stroke");
    assert.ok(focused.edges[0].opacity > global.edges[0].opacity, "focused relation edge should render with higher opacity");
  });

  it("uses pins as the cold-start coordinates when a node source path matches", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/entity.md": { x: 800, y: 340, coordinateSpace: "world" }
      }
    });

    const pinned = graph.nodes.find((node) => node.id === "entity");
    assert.ok(pinned);
    assert.equal(pinned.x, 80);
    assert.equal(pinned.y, 50);
    assert.deepEqual(pinned.point, { x: 800, y: 340 });
  });

  it("keeps explicit world pins readable even when coordinates look like old percentages", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/entity.md": { x: 80, y: -42.5, coordinateSpace: "world" }
      }
    });

    const pinned = graph.nodes.find((node) => node.id === "entity");
    assert.ok(pinned);
    assert.deepEqual(pinned.point, { x: 80, y: -42.5 });
    assert.ok(graph.worldBounds.minY < 0);
  });

  it("continues to read old percent pins without a coordinate-space marker", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/entity.md": { x: 80, y: 50 }
      }
    });

    const pinned = graph.nodes.find((node) => node.id === "entity");
    assert.ok(pinned);
    assert.deepEqual(pinned.point, { x: 800, y: 340 });
  });

  it("infers wiki-relative source paths for graph data without source_path", () => {
    const data = sampleGraph();
    data.nodes = data.nodes.map(({ source_path: _sourcePath, ...node }) => node);
    const graph = buildRenderableGraph(data, {
      theme: "shan-shui",
      pins: {
        "wiki/topics/topic.md": { x: 900, y: 408, coordinateSpace: "world" }
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

  it("marks shift-style multi-node selections", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      selection: { kind: "nodes", ids: ["topic", "source"] }
    });

    const selected = graph.nodes.filter((node) => node.selected).map((node) => node.id);
    assert.deepEqual(selected, ["topic", "source"]);
    assert.equal(graph.nodes.find((node) => node.id === "topic")?.displayMode, "card");
    assert.equal(graph.nodes.find((node) => node.id === "source")?.visualRole, "cinnabar-note");
    assert.equal(graph.minimap.nodes.filter((node) => node.selected).length, 2);
  });

  it("enters a community focus view by hiding nodes outside the selected community", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      focus: { kind: "community", id: "c1" }
    });

    assert.deepEqual(graph.nodes.map((node) => node.id), ["topic", "entity"]);
    assert.deepEqual(graph.edges.map((edge) => edge.id), ["e1"]);
    assert.equal(graph.counts.visibleNodes, 2);
    assert.equal(graph.counts.totalNodes, 4);
    assert.equal(graph.focus?.kind, "community");
    assert.equal(graph.focus?.id, "c1");
    assert.deepEqual(
      communityWashStates(graph),
      [["c1", true], ["c2", false], ["c3", false]]
    );
  });

  it("filters visible nodes by graph node type and stacks with community focus", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      focus: { kind: "community", id: "c1" },
      typeFilters: {
        entity: true,
        topic: false,
        source: true
      }
    });

    assert.deepEqual(graph.nodes.map((node) => node.id), ["entity"]);
    assert.deepEqual(graph.edges, []);
    assert.equal(graph.counts.visibleNodes, 1);
    assert.equal(graph.typeFilters.topic, false);
  });

  it("preserves community focus and type filters when positions are reapplied", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      focus: { kind: "community", id: "c1" },
      typeFilters: {
        entity: true,
        topic: false,
        source: true
      },
      positions: {
        topic: { x: 500, y: 500 },
        entity: { x: 420, y: 320 },
        source: { x: 900, y: 120 },
        island: { x: 120, y: 120 }
      }
    });

    assert.deepEqual(graph.nodes.map((node) => node.id), ["entity"]);
    assert.deepEqual(graph.edges, []);
    assert.equal(graph.focus?.id, "c1");
    assert.equal(graph.typeFilters.topic, false);
    assert.deepEqual(
      communityWashStates(graph),
      [["c1", true], ["c2", false], ["c3", false]]
    );
  });

  it("keeps community wash around the member cluster instead of chasing an outlier", () => {
    const graph = buildRenderableGraph(outlierCommunityGraph(), { theme: "shan-shui" });
    const community = graph.communities.find((item) => item.id === "c1");

    assert.ok(community?.wash);
    assert.equal(community.nodeCount, 5);
    assert.ok(community.wash.cx > 300, `wash center should respond toward the outlier, got ${community.wash.cx}`);
    assert.ok(community.wash.cx < 430, `wash center should stay near the clustered members, got ${community.wash.cx}`);
    assert.equal(community.wash.rx, 190);
    assert.equal(community.wash.ry, 142.8);
  });

  it("keeps community membership stable when a pinned member is outside the wash cap", () => {
    const graph = buildRenderableGraph(outlierCommunityGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/outlier.md": { x: 980, y: 650 }
      }
    });
    const community = graph.communities.find((item) => item.id === "c1");
    const outlier = graph.nodes.find((node) => node.id === "outlier");

    assert.ok(community?.wash);
    assert.ok(outlier);
    assert.equal(outlier.community, "c1");
    assert.equal(community.nodeCount, 5);
    assert.equal(community.wash.rx, 190);
    assert.equal(community.wash.ry, 142.8);
    assert.ok(outlier.point.x > community.wash.cx + community.wash.rx, "pinned member may sit outside the capped visual wash");
  });

  it("preserves community focus after a member is dragged beyond the wash cap", () => {
    const graph = buildRenderableGraph(outlierCommunityGraph(), {
      theme: "shan-shui",
      focus: { kind: "community", id: "c1" },
      positions: {
        outlier: { x: 980, y: 650 }
      }
    });
    const community = graph.communities.find((item) => item.id === "c1");

    assert.deepEqual(graph.nodes.map((node) => node.id).sort(), ["core-a", "core-b", "core-c", "core-d", "outlier"]);
    assert.ok(community?.wash);
    assert.equal(graph.focus?.id, "c1");
    assert.equal(community.wash.rx, 190);
    assert.equal(community.wash.ry, 142.8);
  });

  it("preserves live drag positions outside the old default world", () => {
    const graph = buildRenderableGraph(outlierCommunityGraph(), {
      theme: "shan-shui",
      positions: {
        outlier: { x: 1240, y: 816 }
      }
    });
    const outlier = graph.nodes.find((node) => node.id === "outlier");

    assert.ok(outlier);
    assert.deepEqual(outlier.point, { x: 1240, y: 816 });
    assert.equal(outlier.x, 93.939);
    assert.equal(outlier.y, 91.071);
    assert.equal(graph.worldBounds.maxX, 1320);
    assert.equal(graph.worldBounds.maxY, 896);
    assert.equal(outlier.community, "c1");
  });

  it("preserves pinned positions outside the old default world by expanding render bounds", () => {
    const graph = buildRenderableGraph(outlierCommunityGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/outlier.md": { x: 1240, y: 816, coordinateSpace: "world" }
      }
    });
    const outlier = graph.nodes.find((node) => node.id === "outlier");

    assert.ok(outlier);
    assert.deepEqual(outlier.point, { x: 1240, y: 816 });
    assert.equal(outlier.x, 93.939);
    assert.equal(outlier.y, 91.071);
    assert.equal(graph.worldBounds.width, 1320);
    assert.equal(graph.worldBounds.height, 896);
  });
});

function communityWashStates(graph: ReturnType<typeof buildRenderableGraph>): Array<[string, boolean]> {
  return graph.communities
    .map((community): [string, boolean] => [community.id, Boolean(community.wash)])
    .sort(([left], [right]) => left.localeCompare(right));
}

describe("screen-effective density", () => {
  it("uses viewport scale to choose the effective density mode", () => {
    assert.equal(screenEffectiveDensityMode(120, 1), "compact-card");
    assert.equal(screenEffectiveDensityMode(120, 2), "card");
    assert.equal(screenEffectiveDensityMode(120, 0.5), "point-plus-focus");
    assert.equal(screenEffectiveDensityMode(30, 0.5), "compact-card");
  });

  it("maps effective density to node display without changing selected cards", () => {
    const node = {
      selected: false,
      labelVisible: false,
      visualRole: "map-pin" as const
    };
    const labeledNode = {
      selected: false,
      labelVisible: true,
      visualRole: "map-pin" as const
    };
    const selectedNode = {
      selected: true,
      labelVisible: false,
      visualRole: "map-pin" as const
    };

    assert.equal(nodeDisplayModeForDensity(node, "card"), "card");
    assert.equal(nodeDisplayModeForDensity(node, "compact-card"), "compact-card");
    assert.equal(nodeDisplayModeForDensity(node, "point-plus-focus"), "point");
    assert.equal(nodeDisplayModeForDensity(labeledNode, "point-plus-focus"), "compact-card");
    assert.equal(nodeDisplayModeForDensity(selectedNode, "overview"), "card");
  });
});

describe("edge drawing helpers", () => {
  it("keeps graph-wash stroke strength bounds", () => {
    assert.equal(edgeStrokeWidth({ weight: 0 }), 1.1);
    assert.equal(edgeStrokeWidth({ weight: 1 }), 2.9);
    assert.equal(edgeOpacity({ weight: 0 }), 0.32);
    assert.equal(edgeOpacity({ weight: 1 }), 0.76);
  });

  it("maps relation type to a separate visual class from confidence", () => {
    assert.equal(edgeRelationClass("实现"), "relation-implementation");
    assert.equal(edgeRelationClass("依赖"), "relation-dependency");
    assert.equal(edgeRelationClass("衍生"), "relation-derivation");
    assert.equal(edgeRelationClass("对比"), "relation-contrast");
    assert.equal(edgeRelationClass("矛盾"), "relation-conflict");
    assert.equal(edgeRelationClass("未知"), "relation-dependency");
  });

  it("keeps global relation edges subdued and focused edges fuller", () => {
    assert.equal(edgeVisualStrokeWidth({ weight: 1 }, false), 1.7);
    assert.equal(edgeVisualStrokeWidth({ weight: 1 }, true), 2.9);
    assert.equal(edgeVisualOpacity({ weight: 1 }, false), 0.42);
    assert.equal(edgeVisualOpacity({ weight: 1 }, true), 0.76);
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
