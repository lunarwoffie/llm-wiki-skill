import type { CommunityId, NodeId } from "../types";

export type GraphGestureTargetKind =
  | "graph-blank"
  | "node"
  | "community-wash"
  | "edge"
  | "minimap"
  | "toolbar"
  | "search"
  | "legend"
  | "drawer"
  | "text-control"
  | "unknown";

export type GraphOwnedTargetKind = "graph-blank" | "node" | "community-wash" | "edge";
export type GraphGestureBlockerTargetKind = Exclude<GraphGestureTargetKind, GraphOwnedTargetKind>;
export type GraphGestureTargetOwnership = "graph-owned" | "graph-blocker";

export interface GraphGestureTargetLike {
  closest?: (selector: string) => GraphGestureTargetLike | null;
  dataset?: Record<string, string | undefined>;
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

export type GraphGestureTarget =
  | { kind: "graph-blank" }
  | { kind: "node"; id: NodeId | null }
  | { kind: "community-wash"; id: CommunityId | null }
  | { kind: "edge"; id: string | null }
  | { kind: "minimap" }
  | { kind: "toolbar" }
  | { kind: "search" }
  | { kind: "legend" }
  | { kind: "drawer" }
  | { kind: "text-control" }
  | { kind: "unknown" };

export const GRAPH_OWNED_TARGET_KINDS = ["graph-blank", "node", "community-wash", "edge"] as const satisfies readonly GraphOwnedTargetKind[];
export const GRAPH_GESTURE_BLOCKER_TARGET_KINDS = [
  "minimap",
  "toolbar",
  "search",
  "legend",
  "drawer",
  "text-control",
  "unknown"
] as const satisfies readonly GraphGestureBlockerTargetKind[];

export const GRAPH_GESTURE_SELECTORS = {
  textControl: "textarea, select, [contenteditable=\"true\"], [data-graph-text-control=\"true\"]",
  search: ".graph-search",
  toolbar: ".graph-toolbar",
  legend: ".community-legend",
  drawer: ".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]",
  minimap: ".mini-map",
  node: ".node",
  communityWash: ".community-wash",
  edge: ".edge"
} as const;

export type GraphWheelTargetDecision =
  | { intent: "zoom"; target: GraphGestureTarget }
  | { intent: "blocked"; target: GraphGestureTarget };

export type GraphPointerDownTargetDecision =
  | { intent: "node-drag-candidate"; target: Extract<GraphGestureTarget, { kind: "node" }> }
  | { intent: "community-click-candidate"; target: Extract<GraphGestureTarget, { kind: "community-wash" }> }
  | { intent: "blank-pan-candidate"; target: Extract<GraphGestureTarget, { kind: "graph-blank" }> }
  | { intent: "blocked"; target: Exclude<GraphGestureTarget, { kind: "node" | "community-wash" | "graph-blank" }> };

export interface GraphWheelEventLike {
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface GraphPointerEventLike {
  pointerId: number;
  screenPoint: { x: number; y: number };
  shiftKey?: boolean;
}

export interface GraphGestureStateMachineOptions {
  dragThreshold?: number;
}

export type GraphGestureActiveState =
  | {
      kind: "node";
      pointerId: number;
      nodeId: NodeId | null;
      startScreenPoint: { x: number; y: number };
      lastScreenPoint: { x: number; y: number };
      additive: boolean;
      locked: boolean;
    }
  | {
      kind: "community-wash";
      pointerId: number;
      communityId: CommunityId | null;
      startScreenPoint: { x: number; y: number };
      lastScreenPoint: { x: number; y: number };
      locked: boolean;
      cancelled: boolean;
    }
  | {
      kind: "blank-pan";
      pointerId: number;
      startScreenPoint: { x: number; y: number };
      lastScreenPoint: { x: number; y: number };
      locked: boolean;
    }
  | null;

export type GraphGestureIntent =
  | { kind: "node-click"; nodeId: NodeId | null; additive: boolean; pointerId: number }
  | { kind: "node-drag-start"; nodeId: NodeId | null; pointerId: number; screenPoint: { x: number; y: number } }
  | {
      kind: "node-drag-move";
      nodeId: NodeId | null;
      pointerId: number;
      screenPoint: { x: number; y: number };
      delta: { x: number; y: number };
    }
  | { kind: "node-drag-end"; nodeId: NodeId | null; pointerId: number; screenPoint: { x: number; y: number } }
  | { kind: "node-drag-cancel"; nodeId: NodeId | null; pointerId: number; reason: "pointercancel" | "lostpointercapture" | "escape" }
  | { kind: "community-click"; communityId: CommunityId | null; pointerId: number }
  | { kind: "community-click-cancelled"; communityId: CommunityId | null; pointerId: number; reason: "moved" | "pointercancel" | "lostpointercapture" | "escape" }
  | { kind: "blank-click"; pointerId: number }
  | { kind: "blank-pan-start"; pointerId: number; screenPoint: { x: number; y: number } }
  | { kind: "blank-pan-move"; pointerId: number; screenPoint: { x: number; y: number }; delta: { x: number; y: number } }
  | { kind: "blank-pan-end"; pointerId: number; screenPoint: { x: number; y: number } }
  | { kind: "blank-pan-cancel"; pointerId: number; reason: "pointercancel" | "lostpointercapture" | "escape" };

export function classifyGraphEventTarget(target: GraphGestureTargetLike | null | undefined): GraphGestureTarget {
  if (!target) return { kind: "unknown" };
  if (isTextEditingTarget(target) || closest(target, GRAPH_GESTURE_SELECTORS.textControl)) return { kind: "text-control" };
  if (closest(target, GRAPH_GESTURE_SELECTORS.search)) return { kind: "search" };
  if (closest(target, GRAPH_GESTURE_SELECTORS.legend)) return { kind: "legend" };
  if (closest(target, GRAPH_GESTURE_SELECTORS.toolbar)) return { kind: "toolbar" };
  if (closest(target, GRAPH_GESTURE_SELECTORS.drawer)) return { kind: "drawer" };
  if (closest(target, GRAPH_GESTURE_SELECTORS.minimap)) return { kind: "minimap" };

  const node = closest(target, GRAPH_GESTURE_SELECTORS.node);
  if (node) return { kind: "node", id: dataValue(node, "id", "nodeId") };

  const communityWash = closest(target, GRAPH_GESTURE_SELECTORS.communityWash);
  if (communityWash) return { kind: "community-wash", id: dataValue(communityWash, "communityId", "id") };

  const edge = closest(target, GRAPH_GESTURE_SELECTORS.edge);
  if (edge) return { kind: "edge", id: dataValue(edge, "edgeId", "id") };

  return { kind: "graph-blank" };
}

export function graphGestureTargetOwnership(target: GraphGestureTarget): GraphGestureTargetOwnership {
  return isGraphOwnedGestureTarget(target) ? "graph-owned" : "graph-blocker";
}

export function isGraphOwnedGestureTarget(target: GraphGestureTarget): target is Extract<GraphGestureTarget, { kind: GraphOwnedTargetKind }> {
  return (GRAPH_OWNED_TARGET_KINDS as readonly GraphGestureTargetKind[]).includes(target.kind);
}

export function isGraphGestureBlockerTarget(target: GraphGestureTarget): target is Extract<GraphGestureTarget, { kind: GraphGestureBlockerTargetKind }> {
  return !isGraphOwnedGestureTarget(target);
}

export function classifyGraphWheelTarget(target: GraphGestureTargetLike | null | undefined, event: GraphWheelEventLike = {}): GraphWheelTargetDecision {
  const graphTarget = classifyGraphEventTarget(target);
  if (event.ctrlKey || event.metaKey) return { intent: "blocked", target: graphTarget };
  return isGraphOwnedGestureTarget(graphTarget)
    ? { intent: "zoom", target: graphTarget }
    : { intent: "blocked", target: graphTarget };
}

export function classifyGraphPointerDownTarget(target: GraphGestureTargetLike | null | undefined): GraphPointerDownTargetDecision {
  const graphTarget = classifyGraphEventTarget(target);
  switch (graphTarget.kind) {
    case "node":
      return { intent: "node-drag-candidate", target: graphTarget };
    case "community-wash":
      return { intent: "community-click-candidate", target: graphTarget };
    case "graph-blank":
      return { intent: "blank-pan-candidate", target: graphTarget };
    default:
      return { intent: "blocked", target: graphTarget };
  }
}

export class GraphGestureStateMachine {
  private readonly dragThreshold: number;
  private active: GraphGestureActiveState = null;

  constructor(options: GraphGestureStateMachineOptions = {}) {
    this.dragThreshold = finitePositiveNumber(options.dragThreshold, 4);
  }

  snapshot(): GraphGestureActiveState {
    return cloneActiveState(this.active);
  }

  pointerDown(decision: GraphPointerDownTargetDecision, event: GraphPointerEventLike): GraphGestureIntent[] {
    this.active = null;
    if (decision.intent === "node-drag-candidate") {
      this.active = {
        kind: "node",
        pointerId: event.pointerId,
        nodeId: decision.target.id,
        startScreenPoint: cloneScreenPoint(event.screenPoint),
        lastScreenPoint: cloneScreenPoint(event.screenPoint),
        additive: Boolean(event.shiftKey),
        locked: false
      };
      return [];
    }
    if (decision.intent === "community-click-candidate") {
      this.active = {
        kind: "community-wash",
        pointerId: event.pointerId,
        communityId: decision.target.id,
        startScreenPoint: cloneScreenPoint(event.screenPoint),
        lastScreenPoint: cloneScreenPoint(event.screenPoint),
        locked: false,
        cancelled: false
      };
      return [];
    }
    if (decision.intent === "blank-pan-candidate") {
      this.active = {
        kind: "blank-pan",
        pointerId: event.pointerId,
        startScreenPoint: cloneScreenPoint(event.screenPoint),
        lastScreenPoint: cloneScreenPoint(event.screenPoint),
        locked: false
      };
    }
    return [];
  }

  pointerMove(event: GraphPointerEventLike): GraphGestureIntent[] {
    if (!this.active || this.active.pointerId !== event.pointerId) return [];
    const active = this.active;
    const distance = screenDistance(active.startScreenPoint, event.screenPoint);
    const delta = screenDelta(active.lastScreenPoint, event.screenPoint);
    active.lastScreenPoint = cloneScreenPoint(event.screenPoint);

    if (active.kind === "node") {
      const intents: GraphGestureIntent[] = [];
      if (!active.locked && distance > this.dragThreshold) {
        active.locked = true;
        intents.push({
          kind: "node-drag-start",
          nodeId: active.nodeId,
          pointerId: active.pointerId,
          screenPoint: cloneScreenPoint(event.screenPoint)
        });
      }
      if (active.locked) {
        intents.push({
          kind: "node-drag-move",
          nodeId: active.nodeId,
          pointerId: active.pointerId,
          screenPoint: cloneScreenPoint(event.screenPoint),
          delta
        });
      }
      return intents;
    }

    if (active.kind === "community-wash") {
      if (!active.locked && distance > this.dragThreshold) {
        active.locked = true;
        active.cancelled = true;
        return [{
          kind: "community-click-cancelled",
          communityId: active.communityId,
          pointerId: active.pointerId,
          reason: "moved"
        }];
      }
      return [];
    }

    const intents: GraphGestureIntent[] = [];
    if (!active.locked && distance > this.dragThreshold) {
      active.locked = true;
      intents.push({
        kind: "blank-pan-start",
        pointerId: active.pointerId,
        screenPoint: cloneScreenPoint(event.screenPoint)
      });
    }
    if (active.locked) {
      intents.push({
        kind: "blank-pan-move",
        pointerId: active.pointerId,
        screenPoint: cloneScreenPoint(event.screenPoint),
        delta
      });
    }
    return intents;
  }

  pointerUp(event: GraphPointerEventLike): GraphGestureIntent[] {
    if (!this.active || this.active.pointerId !== event.pointerId) return [];
    const active = this.active;
    this.active = null;

    if (active.kind === "node") {
      if (active.locked) {
        return [{
          kind: "node-drag-end",
          nodeId: active.nodeId,
          pointerId: active.pointerId,
          screenPoint: cloneScreenPoint(event.screenPoint)
        }];
      }
      return [{
        kind: "node-click",
        nodeId: active.nodeId,
        additive: active.additive,
        pointerId: active.pointerId
      }];
    }

    if (active.kind === "community-wash") {
      if (active.cancelled || active.locked) return [];
      return [{
        kind: "community-click",
        communityId: active.communityId,
        pointerId: active.pointerId
      }];
    }

    if (active.locked) {
      return [{
        kind: "blank-pan-end",
        pointerId: active.pointerId,
        screenPoint: cloneScreenPoint(event.screenPoint)
      }];
    }
    return [{ kind: "blank-click", pointerId: active.pointerId }];
  }

  pointerCancel(event: Pick<GraphPointerEventLike, "pointerId">): GraphGestureIntent[] {
    return this.cancel(event.pointerId, "pointercancel");
  }

  lostPointerCapture(event: Pick<GraphPointerEventLike, "pointerId">): GraphGestureIntent[] {
    return this.cancel(event.pointerId, "lostpointercapture");
  }

  escape(): GraphGestureIntent[] {
    return this.active ? this.cancel(this.active.pointerId, "escape") : [];
  }

  private cancel(pointerId: number, reason: "pointercancel" | "lostpointercapture" | "escape"): GraphGestureIntent[] {
    if (!this.active || this.active.pointerId !== pointerId) return [];
    const active = this.active;
    this.active = null;
    if (active.kind === "node") {
      return active.locked
        ? [{ kind: "node-drag-cancel", nodeId: active.nodeId, pointerId, reason }]
        : [];
    }
    if (active.kind === "community-wash") {
      return active.cancelled
        ? []
        : [{ kind: "community-click-cancelled", communityId: active.communityId, pointerId, reason }];
    }
    return active.locked ? [{ kind: "blank-pan-cancel", pointerId, reason }] : [];
  }
}

function closest(target: GraphGestureTargetLike, selector: string): GraphGestureTargetLike | null {
  return typeof target.closest === "function" ? target.closest(selector) : null;
}

function dataValue(target: GraphGestureTargetLike, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = target.dataset?.[key];
    if (value) return value;
  }
  return null;
}

function isTextEditingTarget(target: GraphGestureTargetLike): boolean {
  if (target.isContentEditable) return true;
  const tagName = target.tagName?.toLowerCase();
  if (!tagName) return false;
  if (tagName === "textarea" || tagName === "select") return true;
  if (tagName !== "input") return false;
  const type = String(target.type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
}

function cloneActiveState(active: GraphGestureActiveState): GraphGestureActiveState {
  if (!active) return null;
  if (active.kind === "node") {
    return {
      ...active,
      startScreenPoint: cloneScreenPoint(active.startScreenPoint),
      lastScreenPoint: cloneScreenPoint(active.lastScreenPoint)
    };
  }
  if (active.kind === "community-wash") {
    return {
      ...active,
      startScreenPoint: cloneScreenPoint(active.startScreenPoint),
      lastScreenPoint: cloneScreenPoint(active.lastScreenPoint)
    };
  }
  return {
    ...active,
    startScreenPoint: cloneScreenPoint(active.startScreenPoint),
    lastScreenPoint: cloneScreenPoint(active.lastScreenPoint)
  };
}

function cloneScreenPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0)
  };
}

function screenDelta(previous: { x: number; y: number }, next: { x: number; y: number }): { x: number; y: number } {
  return {
    x: finiteNumber(next.x, 0) - finiteNumber(previous.x, 0),
    y: finiteNumber(next.y, 0) - finiteNumber(previous.y, 0)
  };
}

function screenDistance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(finiteNumber(right.x, 0) - finiteNumber(left.x, 0), finiteNumber(right.y, 0) - finiteNumber(left.y, 0));
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  const numeric = finiteNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
