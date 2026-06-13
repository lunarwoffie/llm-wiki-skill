import { atlasViewportToMinimapRect, centerAtlasViewportOnPoint, clampAtlasViewport, fitAtlasViewport, zoomAtlasViewport } from "../model";

export interface RendererViewport {
  x: number;
  y: number;
  scale: number;
}

export interface RendererViewportSize {
  width: number;
  height: number;
}

export interface RendererPoint {
  x: number;
  y: number;
}

export interface WheelDeltaLike {
  deltaY: number;
  deltaMode?: number;
}

export interface RendererViewportOptions {
  minScale?: number;
  maxScale?: number;
}

export interface RafScheduler {
  requestAnimationFrame(callback: () => void): number;
}

export const DEFAULT_RENDERER_VIEWPORT: RendererViewport = {
  x: 0,
  y: 0,
  scale: 1
};

const WHEEL_LINE_HEIGHT_PX = 18;
const WHEEL_PAGE_HEIGHT_PX = 720;
const WHEEL_ZOOM_SPEED = 0.0016;
const DEFAULT_VIEWPORT_OPTIONS: Required<RendererViewportOptions> = {
  minScale: 0.5,
  maxScale: 4
};

export function normalizeRendererViewport(viewport: Partial<RendererViewport> | null | undefined): RendererViewport {
  return {
    x: finiteNumber(viewport?.x, DEFAULT_RENDERER_VIEWPORT.x),
    y: finiteNumber(viewport?.y, DEFAULT_RENDERER_VIEWPORT.y),
    scale: Math.max(0.01, finiteNumber(viewport?.scale, DEFAULT_RENDERER_VIEWPORT.scale))
  };
}

export function rendererViewportToTransform(viewport: Partial<RendererViewport> | null | undefined): string {
  const safe = normalizeRendererViewport(viewport);
  return `translate(${round(safe.x)}px, ${round(safe.y)}px) scale(${round(safe.scale)})`;
}

export function applyRendererViewportTransform(layer: HTMLElement, viewport: Partial<RendererViewport> | null | undefined): void {
  const safe = normalizeRendererViewport(viewport);
  layer.style.transformOrigin = "0 0";
  layer.style.transform = rendererViewportToTransform(safe);
  layer.dataset.viewportX = String(round(safe.x));
  layer.dataset.viewportY = String(round(safe.y));
  layer.dataset.viewportScale = String(round(safe.scale));
}

export function normalizeWheelDelta(delta: WheelDeltaLike): number {
  const value = finiteNumber(delta.deltaY, 0);
  if (delta.deltaMode === 1) return value * WHEEL_LINE_HEIGHT_PX;
  if (delta.deltaMode === 2) return value * WHEEL_PAGE_HEIGHT_PX;
  return value;
}

export function viewportAfterWheelZoom(
  viewport: Partial<RendererViewport> | null | undefined,
  delta: WheelDeltaLike,
  screenPoint: RendererPoint,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const normalizedDelta = normalizeWheelDelta(delta);
  const zoomFactor = Math.exp(-normalizedDelta * WHEEL_ZOOM_SPEED);
  return zoomAtlasViewport(
    normalizeRendererViewport(viewport),
    zoomFactor,
    screenPoint,
    viewportSize,
    viewportOptions(options)
  ) as RendererViewport;
}

export function panRendererViewport(
  viewport: Partial<RendererViewport> | null | undefined,
  delta: RendererPoint,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const safe = normalizeRendererViewport(viewport);
  return clampAtlasViewport(
    {
      x: safe.x + finiteNumber(delta.x, 0),
      y: safe.y + finiteNumber(delta.y, 0),
      scale: safe.scale
    },
    viewportSize,
    viewportOptions(options)
  ) as RendererViewport;
}

export function fitRendererViewportToPoints(
  points: RendererPoint[],
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const bounds = boundsForPoints(points);
  return fitAtlasViewport(bounds, viewportSize, {
    padding: 0.82,
    ...viewportOptions(options)
  }) as RendererViewport;
}

export function centerRendererViewportOnPoint(
  point: RendererPoint,
  viewport: Partial<RendererViewport> | null | undefined,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const safe = normalizeRendererViewport(viewport);
  return centerAtlasViewportOnPoint(point, viewportSize, safe.scale, viewportOptions(options)) as RendererViewport;
}

export function rendererViewportToMinimapRect(
  viewport: Partial<RendererViewport> | null | undefined,
  viewportSize: RendererViewportSize
): { x: number; y: number; width: number; height: number } {
  return atlasViewportToMinimapRect(normalizeRendererViewport(viewport), viewportSize) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function createViewportFrameCommitter(
  commit: (viewport: RendererViewport) => void,
  scheduler: RafScheduler = defaultScheduler()
): { schedule(viewport: Partial<RendererViewport>): void } {
  let queued = false;
  let pending: RendererViewport | null = null;
  return {
    schedule(viewport): void {
      pending = normalizeRendererViewport(viewport);
      if (queued) return;
      queued = true;
      scheduler.requestAnimationFrame(() => {
        queued = false;
        const next = pending;
        pending = null;
        if (next) commit(next);
      });
    }
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function viewportOptions(options: RendererViewportOptions): Required<RendererViewportOptions> {
  return {
    minScale: finiteNumber(options.minScale, DEFAULT_VIEWPORT_OPTIONS.minScale),
    maxScale: finiteNumber(options.maxScale, DEFAULT_VIEWPORT_OPTIONS.maxScale)
  };
}

function boundsForPoints(points: RendererPoint[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 680, width: 1000, height: 680 };
  }
  let minX = 1000;
  let minY = 680;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    const x = finiteNumber(point.x, 0);
    const y = finiteNumber(point.y, 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function defaultScheduler(): RafScheduler {
  const runtime = globalThis as unknown as { requestAnimationFrame?: (callback: () => void) => number };
  return {
    requestAnimationFrame(callback): number {
      if (typeof runtime.requestAnimationFrame === "function") return runtime.requestAnimationFrame(callback);
      return setTimeout(callback, 16) as unknown as number;
    }
  };
}
