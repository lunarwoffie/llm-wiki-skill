import type { RendererPoint, RendererViewport, RendererViewportSize } from "./viewport";

export interface GraphWorldPoint {
  x: number;
  y: number;
}

export interface GraphWorldSize {
  width: number;
  height: number;
}

export interface GraphScreenPoint {
  x: number;
  y: number;
}

export interface GraphLayerPoint {
  x: number;
  y: number;
}

export interface GraphCssPercentPoint {
  x: number;
  y: number;
}

export interface GraphSvgPoint {
  x: number;
  y: number;
}

export interface GraphMinimapPoint {
  x: number;
  y: number;
}

export interface GraphClientPoint {
  x: number;
  y: number;
}

export interface GraphDomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GraphWorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphMinimapViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const GRAPH_WORLD_SIZE = {
  width: 1000,
  height: 680
} as const;

export const GRAPH_MINIMAP_VIEWBOX: GraphMinimapViewBox = {
  x: 5,
  y: 3,
  width: 150,
  height: 48
};

export function rootClientPointToScreenPoint(clientPoint: GraphClientPoint, rootRect: GraphDomRectLike): GraphScreenPoint {
  return {
    x: finiteNumber(clientPoint.x, 0) - finiteNumber(rootRect.left, 0),
    y: finiteNumber(clientPoint.y, 0) - finiteNumber(rootRect.top, 0)
  };
}

export function worldPointToLayerPoint(worldPoint: GraphWorldPoint, viewportSize: RendererViewportSize): GraphLayerPoint {
  const size = normalizeViewportSize(viewportSize);
  return {
    x: finiteNumber(worldPoint.x, 0) / GRAPH_WORLD_SIZE.width * size.width,
    y: finiteNumber(worldPoint.y, 0) / GRAPH_WORLD_SIZE.height * size.height
  };
}

export function worldPointToCssPercentPoint(worldPoint: GraphWorldPoint, worldSize: GraphWorldSize = GRAPH_WORLD_SIZE): GraphCssPercentPoint {
  const size = normalizeWorldSize(worldSize);
  return {
    x: finiteNumber(worldPoint.x, 0) / size.width * 100,
    y: finiteNumber(worldPoint.y, 0) / size.height * 100
  };
}

export function layerPointToWorldPoint(layerPoint: GraphLayerPoint, viewportSize: RendererViewportSize): GraphWorldPoint {
  const size = normalizeViewportSize(viewportSize);
  return {
    x: finiteNumber(layerPoint.x, 0) / size.width * GRAPH_WORLD_SIZE.width,
    y: finiteNumber(layerPoint.y, 0) / size.height * GRAPH_WORLD_SIZE.height
  };
}

export function worldPointToScreenPoint(
  worldPoint: GraphWorldPoint,
  viewport: RendererViewport,
  viewportSize: RendererViewportSize
): GraphScreenPoint {
  const layerPoint = worldPointToLayerPoint(worldPoint, viewportSize);
  const safe = normalizeViewport(viewport);
  return {
    x: safe.x + safe.scale * layerPoint.x,
    y: safe.y + safe.scale * layerPoint.y
  };
}

export function screenPointToWorldPoint(
  screenPoint: GraphScreenPoint,
  viewport: RendererViewport,
  viewportSize: RendererViewportSize
): GraphWorldPoint {
  const safe = normalizeViewport(viewport);
  const scale = Math.max(0.000001, safe.scale);
  return layerPointToWorldPoint({
    x: (finiteNumber(screenPoint.x, 0) - safe.x) / scale,
    y: (finiteNumber(screenPoint.y, 0) - safe.y) / scale
  }, viewportSize);
}

export function worldDeltaToLayerDelta(worldDelta: GraphWorldPoint, viewportSize: RendererViewportSize): GraphLayerPoint {
  const size = normalizeViewportSize(viewportSize);
  return {
    x: finiteNumber(worldDelta.x, 0) / GRAPH_WORLD_SIZE.width * size.width,
    y: finiteNumber(worldDelta.y, 0) / GRAPH_WORLD_SIZE.height * size.height
  };
}

export function worldPointDeltaToLayerDelta(
  previousWorldPoint: GraphWorldPoint,
  nextWorldPoint: GraphWorldPoint,
  viewportSize: RendererViewportSize
): GraphLayerPoint {
  return worldDeltaToLayerDelta({
    x: finiteNumber(nextWorldPoint.x, 0) - finiteNumber(previousWorldPoint.x, 0),
    y: finiteNumber(nextWorldPoint.y, 0) - finiteNumber(previousWorldPoint.y, 0)
  }, viewportSize);
}

export function layerDeltaToWorldDelta(layerDelta: GraphLayerPoint, viewportSize: RendererViewportSize): GraphWorldPoint {
  const size = normalizeViewportSize(viewportSize);
  return {
    x: finiteNumber(layerDelta.x, 0) / size.width * GRAPH_WORLD_SIZE.width,
    y: finiteNumber(layerDelta.y, 0) / size.height * GRAPH_WORLD_SIZE.height
  };
}

export function worldPointToSvgPoint(worldPoint: GraphWorldPoint): GraphSvgPoint {
  return {
    x: finiteNumber(worldPoint.x, 0),
    y: finiteNumber(worldPoint.y, 0)
  };
}

export function svgPointToWorldPoint(svgPoint: GraphSvgPoint): GraphWorldPoint {
  return {
    x: finiteNumber(svgPoint.x, 0),
    y: finiteNumber(svgPoint.y, 0)
  };
}

export function worldPointToMinimapPoint(
  worldPoint: GraphWorldPoint,
  viewBox: GraphMinimapViewBox = GRAPH_MINIMAP_VIEWBOX
): GraphMinimapPoint {
  const box = normalizeMinimapViewBox(viewBox);
  return {
    x: box.x + clamp(finiteNumber(worldPoint.x, 0), 0, GRAPH_WORLD_SIZE.width) / GRAPH_WORLD_SIZE.width * box.width,
    y: box.y + clamp(finiteNumber(worldPoint.y, 0), 0, GRAPH_WORLD_SIZE.height) / GRAPH_WORLD_SIZE.height * box.height
  };
}

export function minimapPointToWorldPoint(
  minimapPoint: GraphMinimapPoint,
  viewBox: GraphMinimapViewBox = GRAPH_MINIMAP_VIEWBOX
): GraphWorldPoint {
  const box = normalizeMinimapViewBox(viewBox);
  return {
    x: clamp((finiteNumber(minimapPoint.x, box.x) - box.x) / box.width * GRAPH_WORLD_SIZE.width, 0, GRAPH_WORLD_SIZE.width),
    y: clamp((finiteNumber(minimapPoint.y, box.y) - box.y) / box.height * GRAPH_WORLD_SIZE.height, 0, GRAPH_WORLD_SIZE.height)
  };
}

export function visibleWorldRectForViewport(
  viewport: RendererViewport,
  viewportSize: RendererViewportSize
): GraphWorldRect {
  const topLeft = screenPointToWorldPoint({ x: 0, y: 0 }, viewport, viewportSize);
  const size = normalizeViewportSize(viewportSize);
  const bottomRight = screenPointToWorldPoint(
    { x: size.width, y: size.height },
    viewport,
    viewportSize
  );
  return {
    x: clamp(topLeft.x, 0, GRAPH_WORLD_SIZE.width),
    y: clamp(topLeft.y, 0, GRAPH_WORLD_SIZE.height),
    width: Math.max(0, clamp(bottomRight.x, 0, GRAPH_WORLD_SIZE.width) - clamp(topLeft.x, 0, GRAPH_WORLD_SIZE.width)),
    height: Math.max(0, clamp(bottomRight.y, 0, GRAPH_WORLD_SIZE.height) - clamp(topLeft.y, 0, GRAPH_WORLD_SIZE.height))
  };
}

export function visibleWorldRectToMinimapRect(
  worldRect: GraphWorldRect,
  viewBox: GraphMinimapViewBox = GRAPH_MINIMAP_VIEWBOX
): { x: number; y: number; width: number; height: number } {
  const topLeft = worldPointToMinimapPoint({ x: worldRect.x, y: worldRect.y }, viewBox);
  const bottomRight = worldPointToMinimapPoint({
    x: worldRect.x + worldRect.width,
    y: worldRect.y + worldRect.height
  }, viewBox);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y)
  };
}

export function rendererPointToScreenPoint(point: RendererPoint): GraphScreenPoint {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0)
  };
}

export function defaultGraphViewportSize(): RendererViewportSize {
  return {
    width: GRAPH_WORLD_SIZE.width,
    height: GRAPH_WORLD_SIZE.height
  };
}

export function sideExitWorldAnchor(worldPoint: GraphWorldPoint, margin = 80, worldSize: GraphWorldSize = GRAPH_WORLD_SIZE): GraphWorldPoint {
  const size = normalizeWorldSize(worldSize);
  const safeMargin = Math.max(0, finiteNumber(margin, 80));
  return {
    x: finiteNumber(worldPoint.x, 0) < size.width / 2 ? -safeMargin : size.width + safeMargin,
    y: clamp(finiteNumber(worldPoint.y, 0), safeMargin, Math.max(safeMargin, size.height - safeMargin))
  };
}

function normalizeViewport(viewport: RendererViewport): RendererViewport {
  return {
    x: finiteNumber(viewport.x, 0),
    y: finiteNumber(viewport.y, 0),
    scale: Math.max(0.000001, finiteNumber(viewport.scale, 1))
  };
}

function normalizeViewportSize(size: RendererViewportSize): RendererViewportSize {
  return {
    width: Math.max(1, finiteNumber(size.width, GRAPH_WORLD_SIZE.width)),
    height: Math.max(1, finiteNumber(size.height, GRAPH_WORLD_SIZE.height))
  };
}

function normalizeWorldSize(size: GraphWorldSize): GraphWorldSize {
  return {
    width: Math.max(1, finiteNumber(size.width, GRAPH_WORLD_SIZE.width)),
    height: Math.max(1, finiteNumber(size.height, GRAPH_WORLD_SIZE.height))
  };
}

function normalizeMinimapViewBox(viewBox: GraphMinimapViewBox): GraphMinimapViewBox {
  return {
    x: finiteNumber(viewBox.x, GRAPH_MINIMAP_VIEWBOX.x),
    y: finiteNumber(viewBox.y, GRAPH_MINIMAP_VIEWBOX.y),
    width: Math.max(1, finiteNumber(viewBox.width, GRAPH_MINIMAP_VIEWBOX.width)),
    height: Math.max(1, finiteNumber(viewBox.height, GRAPH_MINIMAP_VIEWBOX.height))
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
