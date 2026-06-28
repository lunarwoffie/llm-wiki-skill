import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphRendererAdapterData } from "../src";
import {
  createSigmaGlobalHitProjector,
  gestureTargetFromSigmaRenderedObject,
  sigmaNodeIdFromPayload,
  sigmaScreenPointFromPayload
} from "../src/render/sigma-hit-projector";

describe("Sigma hit projector", () => {
  it("projects known Sigma node ids before spatial fallback", () => {
    const projector = createSigmaGlobalHitProjector(projectorInput());

    assert.deepEqual(
      projector.targetFromSigmaHit({ nodeId: "alpha", screenPoint: { x: 50, y: 50 } }),
      { kind: "node", id: "alpha" }
    );
  });

  it("falls back from unknown Sigma node ids to rendered objects and screen points", () => {
    const projector = createSigmaGlobalHitProjector(projectorInput());

    assert.deepEqual(
      projector.targetFromSigmaHit({ nodeId: "missing", renderedObject: { kind: "edge", id: "edge-a" } }),
      { kind: "edge", id: "edge-a" }
    );
    assert.deepEqual(
      projector.targetFromSigmaHit({ nodeId: "missing", screenPoint: { x: 50, y: 30 } }),
      { kind: "community-wash", id: "community-a" }
    );
  });

  it("translates rendered objects into graph gesture targets", () => {
    const adapterData = adapterDataFixture();

    assert.deepEqual(gestureTargetFromSigmaRenderedObject({ kind: "node", id: "alpha" }, adapterData), { kind: "node", id: "alpha" });
    assert.deepEqual(gestureTargetFromSigmaRenderedObject({ kind: "edge", id: "edge-a" }, adapterData), { kind: "edge", id: "edge-a" });
    assert.deepEqual(gestureTargetFromSigmaRenderedObject({ kind: "community-wash", id: "community-a" }, adapterData), { kind: "community-wash", id: "community-a" });
    assert.deepEqual(
      gestureTargetFromSigmaRenderedObject({ kind: "aggregation-container", id: "aggregation-a" }, adapterData),
      { kind: "aggregation-container", id: "aggregation-a", communityId: "community-a" }
    );
  });

  it("returns graph blank for invalid rendered objects through projector fallback", () => {
    const projector = createSigmaGlobalHitProjector(projectorInput());

    assert.deepEqual(
      projector.targetFromSigmaHit({ renderedObject: { kind: "edge", id: "missing" } }),
      { kind: "graph-blank" }
    );
  });

  it("parses Sigma node and screen point payloads defensively", () => {
    assert.equal(sigmaNodeIdFromPayload({ node: "alpha" }), "alpha");
    assert.equal(sigmaNodeIdFromPayload({ node: 42 }), null);
    assert.deepEqual(sigmaScreenPointFromPayload({ x: 10, y: 20 }), { x: 10, y: 20 });
    assert.deepEqual(sigmaScreenPointFromPayload({ event: { x: 30, y: 40 } }), { x: 30, y: 40 });
    assert.equal(sigmaScreenPointFromPayload({ event: { x: "30", y: 40 } }), null);
  });

  it("returns graph blank when no hit input can be projected", () => {
    const projector = createSigmaGlobalHitProjector(projectorInput());

    assert.deepEqual(projector.targetFromSigmaHit({}), { kind: "graph-blank" });
  });
});

function projectorInput() {
  return {
    adapterData: adapterDataFixture(),
    viewport: { x: 0, y: 0, scale: 1 },
    viewportSize: { width: 100, height: 100 },
    screenPointToWorldPoint: (point: { x: number; y: number }) => point
  };
}

function adapterDataFixture(): GraphRendererAdapterData {
  return {
    counts: {
      nodes: 2,
      edges: 1,
      communities: 1,
      hidden: 0,
      renderedNodes: 2,
      renderedEdges: 1,
      aggregationContainers: 1
    },
    selection: {
      input: null,
      selectionId: null,
      selectedNodeIds: [],
      selectedCommunityIds: [],
      containsCurrentObject: false
    },
    nodes: [
      nodeFixture("alpha", { x: 10, y: 10 }),
      nodeFixture("beta", { x: 90, y: 10 })
    ],
    edges: [
      {
        id: "edge-a",
        sourceNodeId: "alpha",
        targetNodeId: "beta",
        sourceCommunityId: "community-a",
        targetCommunityId: "community-a",
        relationType: "depends-on",
        confidence: "EXTRACTED",
        weight: 1,
        render: { strokeWidth: 1, opacity: 1 }
      }
    ],
    communities: [
      {
        id: "community-a",
        object: { kind: "community", communityId: "community-a" },
        label: "Community A",
        nodeIds: ["alpha", "beta"],
        nodeCount: 2,
        selected: false,
        searchResultIds: [],
        pinHints: [],
        aggregationIds: ["aggregation-a"],
        drawerTarget: communityDrawerTarget("community-a"),
        commands: [{ kind: "enter-community", communityId: "community-a", label: "进入社区" }]
      }
    ],
    aggregations: [
      {
        id: "aggregation-a",
        object: { kind: "aggregation", aggregationId: "aggregation-a", nodeIds: ["alpha", "beta"], communityId: "community-a" },
        label: "Aggregation A",
        communityId: "community-a",
        nodeIds: ["alpha", "beta"],
        selectedNodeIds: [],
        searchResultIds: [],
        pinnedNodeIds: [],
        totalCount: 2,
        selected: false,
        pinHints: [],
        drawerTarget: communityDrawerTarget("community-a"),
        commands: []
      }
    ],
    renderable: {
      nodes: [],
      edges: [{ id: "edge-a", sourceNodeId: "alpha", targetNodeId: "beta", curveOffset: 0 }],
      communities: [
        {
          id: "community-a",
          role: "community",
          label: "Community A",
          nodeCount: 2,
          selected: false,
          searchHitCount: 0,
          pinnedCount: 0,
          selectedCount: 0,
          color: "#64748b",
          x: 50,
          y: 50,
          radius: 30,
          wash: { cx: 50, cy: 50, rx: 30, ry: 30 },
          drawerTarget: communityDrawerTarget("community-a"),
          commands: [{ kind: "enter-community", communityId: "community-a", label: "进入社区" }]
        }
      ],
      aggregationContainers: [
        {
          id: "aggregation-a",
          role: "aggregation-container",
          label: "Aggregation A",
          communityId: "community-a",
          nodeIds: ["alpha", "beta"],
          nodeCount: 2,
          searchHitCount: 0,
          pinnedCount: 0,
          selectedCount: 0,
          selected: false,
          searchResultIds: [],
          pinnedNodeIds: [],
          selectedNodeIds: [],
          pinHints: [],
          point: { x: 80, y: 80 },
          x: 80,
          y: 80,
          radius: 8,
          color: "#64748b"
        }
      ],
      minimap: { path: "", nodes: [] },
      relationLegend: [],
      selectedNodeId: null,
      selectedCommunityId: null,
      selectedNodeIds: [],
      hiddenNodeIds: new Set(),
      searchResultIds: [],
      worldBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      budgets: {
        limits: {
          maxNodes: 2,
          maxEdges: 1,
          maxLabels: 1,
          maxCards: 1,
          maxInteractionUpdates: 1,
          maxVisibleCommunities: 1
        },
        usage: {
          nodes: 2,
          edges: 1,
          labels: 1,
          cards: 1,
          interactionUpdate: 1,
          activeInteraction: 1,
          communities: 1,
          aggregationContainers: 1
        }
      },
      qualityNotice: null,
      communityFocus: null,
      communityQuality: {
        boundaryCertainty: "high",
        skeletonLabel: "stable",
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
        stableCoreNodeIds: ["alpha"],
        stableSkeletonEdgeIds: ["edge-a"],
        temporaryBoostNodeIds: []
      }
    }
  };
}

function nodeFixture(id: string, point: { x: number; y: number }): GraphRendererAdapterData["nodes"][number] {
  return {
    id,
    object: { kind: "node", nodeId: id },
    label: id,
    type: "topic",
    communityId: "community-a",
    sourcePath: `${id}.md`,
    point,
    selected: false,
    searchHit: false,
    pinHint: {
      nodeId: id,
      wikiPath: `${id}.md`,
      pinned: false,
      position: null
    },
    aggregationIds: ["aggregation-a"],
    drawerTarget: {
      summaryKind: "node-summary",
      object: { kind: "node", nodeId: id }
    },
    render: {
      displayMode: "point",
      visualRole: "landmark",
      priority: 1,
      labelVisible: false
    }
  };
}

function communityDrawerTarget(id: string): GraphRendererAdapterData["communities"][number]["drawerTarget"] {
  return {
    summaryKind: "community-summary",
    object: { kind: "community", communityId: id }
  };
}
