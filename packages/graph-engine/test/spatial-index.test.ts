import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGraphSpatialIndex } from "../src/layout";
import type { GraphSpatialNodeLike } from "../src/layout";

function baseNodes(): GraphSpatialNodeLike[] {
  return [
    { id: "a", label: "Alpha", type: "entity", point: { x: 100, y: 100 }, hitBounds: { x: 70, y: 80, width: 60, height: 40 } },
    { id: "b", label: "Beta", type: "entity", point: { x: 260, y: 100 }, hitBounds: { x: 230, y: 80, width: 60, height: 40 } }
  ];
}

describe("GraphSpatialIndex", () => {
  it("hits nodes through spatial bounds instead of DOM targets", () => {
    const index = createGraphSpatialIndex({ nodes: baseNodes() });

    assert.deepEqual(index.hitTest({ x: 126, y: 118 }), { kind: "node", id: "a" });
    assert.deepEqual(index.hitTest({ x: 131, y: 121 }), { kind: "graph-blank" });
  });

  it("hits edges with a world-space tolerance", () => {
    const index = createGraphSpatialIndex({
      nodes: baseNodes(),
      edges: [{ id: "a-b", source: "a", target: "b", curveOffset: 0 }]
    });

    assert.deepEqual(index.hitTest({ x: 180, y: 88 }), { kind: "edge", id: "a-b" });
    assert.deepEqual(index.hitTest({ x: 180, y: 125 }), { kind: "graph-blank" });
  });

  it("hits community washes with ellipse geometry", () => {
    const index = createGraphSpatialIndex({
      nodes: [],
      communities: [{ id: "c1", wash: { cx: 400, cy: 300, rx: 90, ry: 50 } }]
    });

    assert.deepEqual(index.hitTest({ x: 450, y: 315 }), { kind: "community-wash", id: "c1" });
    assert.deepEqual(index.hitTest({ x: 500, y: 315 }), { kind: "graph-blank" });
  });

  it("keeps node priority above edge and community overlap", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "node", point: { x: 200, y: 200 }, hitBounds: { x: 180, y: 180, width: 40, height: 40 } },
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });

    assert.deepEqual(index.hitTest({ x: 200, y: 200 }), { kind: "node", id: "node" });
  });

  it("keeps edge priority above community overlap when no node is hit", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });

    assert.deepEqual(index.hitTest({ x: 200, y: 188 }), { kind: "edge", id: "left-right" });
  });

  it("returns blank when no graph object owns the point", () => {
    const index = createGraphSpatialIndex({
      nodes: baseNodes(),
      edges: [{ id: "a-b", source: "a", target: "b" }],
      communities: [{ id: "c1", wash: { cx: 180, cy: 100, rx: 120, ry: 45 } }]
    });

    assert.deepEqual(index.hitTest({ x: -120, y: 900 }), { kind: "graph-blank" });
  });

  it("supports nodes outside the old 1000x680 world", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "outlier", point: { x: 1320, y: -180 }, hitBounds: { x: 1280, y: -205, width: 80, height: 50 } }
      ],
      communities: [{ id: "far", wash: { cx: 1320, cy: -180, rx: 110, ry: 70 } }]
    });

    assert.deepEqual(index.hitTest({ x: 1335, y: -170 }), { kind: "node", id: "outlier" });
  });

  it("requires rebuild after drag or pin movement instead of mutating quadtree coordinates in place", () => {
    const nodes = baseNodes();
    const original = createGraphSpatialIndex({ nodes });

    nodes[0] = { ...nodes[0], point: { x: 500, y: 460 }, hitBounds: { x: 470, y: 440, width: 60, height: 40 } };
    assert.deepEqual(original.hitTest({ x: 100, y: 100 }), { kind: "node", id: "a" });
    assert.deepEqual(original.hitTest({ x: 500, y: 460 }), { kind: "graph-blank" });

    const rebuilt = original.rebuild({ nodes });
    assert.deepEqual(rebuilt.hitTest({ x: 500, y: 460 }), { kind: "node", id: "a" });
    assert.deepEqual(rebuilt.hitTest({ x: 100, y: 100 }), { kind: "graph-blank" });
  });
});
