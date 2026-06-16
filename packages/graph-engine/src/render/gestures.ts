import type { CommunityId, NodeId } from "../types";
import type { GraphSpatialHitTarget } from "../layout";

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

export interface GraphGestureControllerOptions {
  stateMachine?: GraphGestureStateMachine;
  targetFromEventTarget?: (target: EventTarget | null) => GraphGestureTargetLike | null;
  pointerEventFromPointerEvent: (event: PointerEvent) => GraphPointerEventLike;
  onWheelZoom: (event: WheelEvent, decision: Extract<GraphWheelTargetDecision, { intent: "zoom" }>) => void;
  onPointerDown?: (event: PointerEvent, decision: Exclude<GraphPointerDownTargetDecision, { intent: "blocked" }>) => void;
  onGestureIntents: (intents: GraphGestureIntent[], event: PointerEvent | null) => void;
  onActiveStateChange?: (active: GraphGestureActiveState) => void;
  onBlankDoubleClick?: (event: MouseEvent) => void;
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
  return classifyGraphWheelTargetFromGraphTarget(classifyGraphEventTarget(target), event);
}

export function classifyGraphWheelTargetFromGraphTarget(graphTarget: GraphGestureTarget, event: GraphWheelEventLike = {}): GraphWheelTargetDecision {
  return isGraphOwnedGestureTarget(graphTarget)
    ? { intent: "zoom", target: graphTarget }
    : { intent: "blocked", target: graphTarget };
}

export function classifyGraphPointerDownTarget(target: GraphGestureTargetLike | null | undefined): GraphPointerDownTargetDecision {
  return classifyGraphPointerDownTargetFromGraphTarget(classifyGraphEventTarget(target));
}

export function graphSpatialHitToGestureTarget(hit: GraphSpatialHitTarget | null | undefined): GraphGestureTarget {
  if (!hit) return { kind: "unknown" };
  switch (hit.kind) {
    case "node":
      return { kind: "node", id: hit.id };
    case "edge":
      return { kind: "edge", id: hit.id };
    case "community-wash":
      return { kind: "community-wash", id: hit.id };
    case "graph-blank":
      return { kind: "graph-blank" };
    default:
      return { kind: "unknown" };
  }
}

export function classifyGraphPointerDownTargetFromGraphTarget(graphTarget: GraphGestureTarget): GraphPointerDownTargetDecision {
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

export class GraphGestureController {
  private readonly root: HTMLElement;
  private readonly options: GraphGestureControllerOptions;
  private readonly stateMachine: GraphGestureStateMachine;
  private destroyed = false;

  constructor(root: HTMLElement, options: GraphGestureControllerOptions) {
    this.root = root;
    this.options = options;
    this.stateMachine = options.stateMachine || new GraphGestureStateMachine();
    this.root.addEventListener("wheel", this.handleWheel, { passive: false });
    this.root.addEventListener("pointerdown", this.handlePointerDown);
    this.root.addEventListener("pointermove", this.handlePointerMove);
    this.root.addEventListener("pointerup", this.handlePointerUp);
    this.root.addEventListener("pointercancel", this.handlePointerCancel);
    this.root.addEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.root.addEventListener("dblclick", this.handleDoubleClick);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.removeEventListener("wheel", this.handleWheel);
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("pointermove", this.handlePointerMove);
    this.root.removeEventListener("pointerup", this.handlePointerUp);
    this.root.removeEventListener("pointercancel", this.handlePointerCancel);
    this.root.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.root.removeEventListener("dblclick", this.handleDoubleClick);
  }

  snapshot(): GraphGestureActiveState {
    return this.stateMachine.snapshot();
  }

  escape(): GraphGestureIntent[] {
    const intents = this.stateMachine.escape();
    this.emitActiveState();
    return intents;
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    const decision = classifyGraphWheelTarget(this.eventTarget(event.target), event);
    if (decision.intent !== "zoom") return;
    this.options.onWheelZoom(event, decision);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const decision = classifyGraphPointerDownTarget(this.eventTarget(event.target));
    if (decision.intent === "blocked") return;
    event.preventDefault();
    this.options.onPointerDown?.(event, decision);
    this.stateMachine.pointerDown(decision, this.options.pointerEventFromPointerEvent(event));
    this.emitActiveState();
    this.root.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.stateMachine.snapshot()) event.preventDefault();
    this.applyIntents(this.stateMachine.pointerMove(this.options.pointerEventFromPointerEvent(event)), event);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.stateMachine.snapshot()) event.preventDefault();
    this.applyIntents(this.stateMachine.pointerUp(this.options.pointerEventFromPointerEvent(event)), event);
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.stateMachine.snapshot()) event.preventDefault();
    this.applyIntents(this.stateMachine.pointerCancel({ pointerId: event.pointerId }), event);
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
  };

  private readonly handleLostPointerCapture = (event: PointerEvent): void => {
    const pointerId = Number(event.pointerId);
    if (!Number.isFinite(pointerId)) return;
    this.applyIntents(this.stateMachine.lostPointerCapture({ pointerId }), null);
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    const decision = classifyGraphPointerDownTarget(this.eventTarget(event.target));
    if (decision.intent !== "blank-pan-candidate") return;
    this.options.onBlankDoubleClick?.(event);
  };

  private applyIntents(intents: GraphGestureIntent[], event: PointerEvent | null): void {
    this.options.onGestureIntents(intents, event);
    this.emitActiveState();
  }

  private emitActiveState(): void {
    this.options.onActiveStateChange?.(this.stateMachine.snapshot());
  }

  private eventTarget(target: EventTarget | null): GraphGestureTargetLike | null {
    return this.options.targetFromEventTarget ? this.options.targetFromEventTarget(target) : target as GraphGestureTargetLike | null;
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
