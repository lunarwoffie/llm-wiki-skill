import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRenderableGraph,
  centerRendererViewportOnPoint,
  createViewportFrameCommitter,
  fitRendererViewportToPoints,
  normalizeWheelDelta,
  panRendererViewport,
  rendererViewportToMinimapRect,
  rendererViewportToTransform,
  viewportAfterWheelZoom
} from "../src/render";
import type { GraphData, PinMap } from "../src/types";

function sampleGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-13T00:00:00.000Z",
      wiki_title: "Viewport Fixture",
      total_nodes: 2,
      total_edges: 1
    },
    nodes: [
      { id: "a", label: "A", type: "topic", community: "c1", source_path: "wiki/a.md", x: 20, y: 30 },
      { id: "b", label: "B", type: "entity", community: "c1", source_path: "wiki/b.md", x: 60, y: 55 }
    ],
    edges: [{ id: "ab", from: "a", to: "b", type: "EXTRACTED", weight: 1 }]
  };
}

describe("renderer viewport state", () => {
  it("serializes pan and zoom as one content-layer transform", () => {
    assert.equal(
      rendererViewportToTransform({ x: 32.1254, y: -18.8754, scale: 1.4567 }),
      "translate(32.125px, -18.875px) scale(1.457)"
    );
  });

  it("clamps focus-fit zoom so a tiny community does not blow up to fullscreen", () => {
    const size = { width: 1440, height: 900 };
    // 极小包围盒：聚焦一个只有几个聚集节点的小社区
    const tightCluster = [
      { x: 500, y: 400 },
      { x: 520, y: 415 },
      { x: 510, y: 430 }
    ];
    // 默认 fit 会把这么小的簇放大到上限（远超可读尺寸）——这正是"切社区节点爆大"的来源
    const defaultFit = fitRendererViewportToPoints(tightCluster, size);
    assert.ok(defaultFit.scale > 1.5, `sanity: default fit over-zooms a tiny cluster (got ${defaultFit.scale})`);
    // focusCommunity 传保守 maxScale 后，缩放被钳住，节点保持可读、社区居中留白
    const clamped = fitRendererViewportToPoints(tightCluster, size, { maxScale: 1.5 });
    assert.ok(clamped.scale <= 1.5, `focus fit must clamp zoom to <= 1.5 (got ${clamped.scale})`);
  });

  it("keeps pin coordinates separate from viewport transforms", () => {
    const pins: PinMap = {
      "wiki/a.md": { x: 420, y: 210 }
    };
    const beforePins = structuredClone(pins);
    const beforeGraph = buildRenderableGraph(sampleGraph(), { pins });

    rendererViewportToTransform({ x: 120, y: -64, scale: 2.25 });
    const afterGraph = buildRenderableGraph(sampleGraph(), { pins });

    assert.deepEqual(pins, beforePins);
    assert.deepEqual(
      afterGraph.nodes.map((node) => [node.id, node.point]),
      beforeGraph.nodes.map((node) => [node.id, node.point])
    );
    assert.deepEqual(afterGraph.nodes.find((node) => node.id === "a")?.point, { x: 420, y: 210 });
  });

  it("normalizes pixel, line, and page wheel deltas separately", () => {
    assert.equal(normalizeWheelDelta({ deltaY: 12, deltaMode: 0 }), 12);
    assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 }), 36);
    assert.equal(normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }), 720);
  });

  it("zooms around the pointer and pans without changing scale", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    const zoomed = viewportAfterWheelZoom(
      viewport,
      { deltaY: -120, deltaMode: 0 },
      { x: 250, y: 150 },
      { width: 1000, height: 680 }
    );
    const panned = panRendererViewport(zoomed, { x: 40, y: -25 }, { width: 1000, height: 680 });

    assert.ok(zoomed.scale > 1);
    assert.ok(zoomed.x < 0, `zoom should move x around pointer, got ${zoomed.x}`);
    assert.ok(zoomed.y < 0, `zoom should move y around pointer, got ${zoomed.y}`);
    assert.equal(panned.scale, zoomed.scale);
    assert.equal(panned.x, zoomed.x + 40);
    assert.equal(panned.y, zoomed.y - 25);
  });

  it("fits graph points into the viewport", () => {
    const fitted = fitRendererViewportToPoints(
      [{ x: 120, y: 80 }, { x: 880, y: 600 }],
      { width: 1000, height: 680 }
    );

    assert.ok(fitted.scale >= 0.5);
    assert.ok(fitted.scale <= 4);
    assert.notDeepEqual(fitted, { x: 0, y: 0, scale: 1 });
  });

  it("centers a model point while preserving the current zoom scale", () => {
    const centered = centerRendererViewportOnPoint(
      { x: 500, y: 340 },
      { x: -20, y: -30, scale: 2 },
      { width: 1000, height: 680 }
    );

    assert.equal(centered.scale, 2);
    assert.deepEqual(centered, { x: -500, y: -340, scale: 2 });
  });

  it("maps the current viewport to a minimap rectangle", () => {
    const rect = rendererViewportToMinimapRect(
      { x: -250, y: -170, scale: 2 },
      { width: 1000, height: 680 }
    );

    assert.ok(rect.x > 0);
    assert.ok(rect.y > 0);
    assert.ok(rect.width > 2);
    assert.ok(rect.height > 2);
  });

  it("coalesces viewport writes to one requestAnimationFrame callback", () => {
    const callbacks: Array<() => void> = [];
    const writes: Array<{ x: number; y: number; scale: number }> = [];
    const committer = createViewportFrameCommitter((viewport) => writes.push(viewport), {
      requestAnimationFrame(callback) {
        callbacks.push(callback);
        return callbacks.length;
      }
    });

    committer.schedule({ x: 10, y: 0, scale: 1 });
    committer.schedule({ x: 20, y: 0, scale: 1 });
    committer.schedule({ x: 30, y: 0, scale: 1 });

    assert.equal(callbacks.length, 1);
    assert.deepEqual(writes, []);
    callbacks[0]();
    assert.deepEqual(writes, [{ x: 30, y: 0, scale: 1 }]);
  });
});
