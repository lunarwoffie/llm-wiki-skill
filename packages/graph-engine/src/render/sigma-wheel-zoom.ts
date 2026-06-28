import type { GraphScreenPoint } from "./geometry";
import { preventSigmaDefault } from "./sigma-events";
import type { SigmaGlobalSigmaLike } from "./sigma-global-types";
import { sigmaWheelZoomRatio, type SigmaWheelDeltaLike } from "./sigma-zoom";

interface SigmaGlobalWheelPayload {
  x?: unknown;
  y?: unknown;
  delta?: unknown;
  original?: {
    deltaY?: unknown;
    deltaMode?: unknown;
    target?: unknown;
  };
  preventSigmaDefault?: () => void;
}

export interface SigmaWheelZoomController {
  destroy(): void;
}

export interface SigmaWheelZoomControllerInput {
  sigma: SigmaGlobalSigmaLike;
  root: HTMLElement;
  isDestroyed: () => boolean;
  currentRatio: () => number;
  onZoomAtPoint: (point: GraphScreenPoint, nextRatio: number) => void;
  onFatalError?: (error: unknown) => void;
}

export function bindSigmaWheelZoomController(input: SigmaWheelZoomControllerInput): SigmaWheelZoomController {
  const captor = input.sigma.getMouseCaptor?.();
  if (!captor?.on) return { destroy: () => undefined };
  const listener = (payload?: unknown): void => {
    if (input.isDestroyed()) return;
    try {
      const wheel = sigmaWheelInputFromPayload(payload, sigmaViewportCenter(input.root));
      if (!wheel) return;
      preventSigmaDefault(payload);
      if (sigmaWheelTargetIsZoomControl(payload)) return;
      const nextRatio = sigmaWheelZoomRatio(input.currentRatio(), wheel.delta);
      input.onZoomAtPoint(wheel.point, nextRatio);
    } catch (error) {
      input.onFatalError?.(error);
    }
  };
  captor.on("wheel", listener);
  return {
    destroy() {
      captor.off?.("wheel", listener);
    }
  };
}

export function sigmaWheelInputFromPayload(payload: unknown, fallbackPoint: GraphScreenPoint): {
  point: GraphScreenPoint;
  delta: SigmaWheelDeltaLike;
} | null {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const originalDeltaY = wheel?.original?.deltaY;
  const fallbackDelta = wheel?.delta;
  const deltaY = typeof originalDeltaY === "number"
    ? originalDeltaY
    : typeof fallbackDelta === "number"
      ? -fallbackDelta * 120
      : null;
  if (deltaY == null || !Number.isFinite(deltaY)) return null;

  const x = finiteNumber(wheel?.x, Number.NaN);
  const y = finiteNumber(wheel?.y, Number.NaN);
  const point = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallbackPoint;
  const originalDeltaMode = wheel?.original?.deltaMode;
  return {
    point,
    delta: {
      deltaY,
      deltaMode: typeof originalDeltaMode === "number" ? originalDeltaMode : 0
    }
  };
}

export function sigmaWheelTargetIsZoomControl(payload: unknown): boolean {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const target = wheel?.original?.target as {
    closest?: (selector: string) => unknown;
    parentElement?: { closest?: (selector: string) => unknown };
  } | null | undefined;
  return Boolean(
    target?.closest?.("[data-control=\"sigma-zoom\"]") ||
    target?.parentElement?.closest?.("[data-control=\"sigma-zoom\"]")
  );
}

export function sigmaViewportCenter(root: HTMLElement): GraphScreenPoint {
  const rect = typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect() : null;
  const width = finiteNumber(rect?.width, 1000);
  const height = finiteNumber(rect?.height, 680);
  return {
    x: width / 2,
    y: height / 2
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
