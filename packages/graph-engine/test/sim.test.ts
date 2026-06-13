import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRenderableGraph } from "../src/render";
import { createLiveGraphSimulation, pinsToPositions, PinState } from "../src/sim";
import type { GraphData } from "../src/types";

describe("LiveGraphSimulation", () => {
  it("starts from cold-start graph coordinates and pinned positions", () => {
    const graph = buildRenderableGraph(sampleGraph(), {
      theme: "shan-shui",
      pins: {
        "wiki/near.md": { x: 800, y: 340 }
      }
    });
    const simulation = createLiveGraphSimulation(graph);
    const snapshot = simulation.snapshot();

    assert.deepEqual(snapshot.positions.drag, { x: 200, y: 340 });
    assert.deepEqual(snapshot.positions.near, { x: 800, y: 340 });
    assert.deepEqual(snapshot.positions.far, { x: 850, y: 340 });
    simulation.destroy();
  });

  it("settles to alpha zero instead of moving forever", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph, { coldStartAlpha: 0.09, alphaMin: 0.004 });
    const settled = simulation.settle();

    assert.equal(settled.alpha, 0);
    assert.equal(simulation.alpha, 0);
    simulation.destroy();
  });

  it("moves direct neighbors during low-heat drag while keeping far nodes fixed", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph, { lowHeatAlphaTarget: 0.15 });
    simulation.settle();
    const before = simulation.snapshot();

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 460, y: 340 });
    const during = simulation.tick(36);

    assert.ok(during.positions.near.x > before.positions.near.x + 4, "direct neighbor should slide toward the dragged node");
    assert.deepEqual(during.positions.far, before.positions.far, "far node should remain fixed during the drag");
    assert.equal(during.positions.drag.x, 460);

    simulation.endDrag();
    const settled = simulation.settle();
    assert.equal(settled.alpha, 0);
    simulation.destroy();
  });
});

describe("PinState", () => {
  it("pins, unpins, and resets by wiki-relative node path", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const pins = new PinState(graph);

    const pinned = pins.pin("drag", { x: 412.5, y: -88.2 });
    assert.equal(pins.isPinned("drag"), true);
    assert.deepEqual(pinned.pins, {
      "wiki/drag.md": { x: 412.5, y: -88.2 }
    });
    assert.deepEqual(pinned.pinnedNodeIds, ["drag"]);

    const unpinned = pins.unpin("drag");
    assert.equal(pins.isPinned("drag"), false);
    assert.deepEqual(unpinned.pins, {});

    pins.pin("near", { x: 130, y: 245.7 });
    assert.deepEqual(pins.reset().pins, {});
  });

  it("normalizes initial pins and exposes render positions for known graph nodes only", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const pins = {
      "wiki/near.md": { x: 130, y: 245.7 },
      "wiki/missing.md": { x: 999, y: 999 }
    };
    const state = new PinState(graph, pins).snapshot();

    assert.deepEqual(state.pins, {
      "wiki/near.md": { x: 130, y: 245.7 }
    });
    assert.deepEqual(pinsToPositions(graph, state.pins), {
      near: { x: 130, y: 245.7 }
    });
  });
});

function sampleGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Simulation Fixture",
      total_nodes: 3,
      total_edges: 1
    },
    nodes: [
      { id: "drag", label: "Drag", type: "topic", community: "c1", source_path: "wiki/drag.md", weight: 80, x: 20, y: 50 },
      { id: "near", label: "Near", type: "entity", community: "c1", source_path: "wiki/near.md", weight: 50, x: 32, y: 50 },
      { id: "far", label: "Far", type: "entity", community: "c2", source_path: "wiki/far.md", weight: 20, x: 85, y: 50 }
    ],
    edges: [
      { id: "drag-near", from: "drag", to: "near", type: "EXTRACTED", weight: 1 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "drag", recommended_start_reason: "community_hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["drag", "near", "far"], degraded: false }
      },
      communities: [
        { id: "c1", label: "Core", node_count: 2, color_index: 0, recommended_start_node_id: "drag" },
        { id: "c2", label: "Edge", node_count: 1, color_index: 1 }
      ]
    }
  };
}
