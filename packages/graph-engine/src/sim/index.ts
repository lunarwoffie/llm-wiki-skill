import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from "d3-force";

import type { NodeId } from "../types";
import type { RenderPositionMap, RenderableGraph, RenderableNode } from "../render";
export { PinState, pinsToPositions } from "./pins";
export type { PinStateSnapshot } from "./pins";

export interface LiveSimulationNode extends SimulationNodeDatum {
  id: NodeId;
  baseX: number;
  baseY: number;
  sourcePath: string;
  fixedByDrag?: boolean;
  savedFx?: number | null;
  savedFy?: number | null;
}

interface LiveSimulationLink extends SimulationLinkDatum<LiveSimulationNode> {
  id: string;
  weight: number;
}

export interface LiveGraphSimulationOptions {
  coldStartAlpha?: number;
  lowHeatAlphaTarget?: number;
  alphaMin?: number;
  alphaDecay?: number;
  velocityDecay?: number;
  onTick?: (snapshot: LiveGraphSimulationSnapshot) => void;
}

export interface LiveGraphSimulationSnapshot {
  alpha: number;
  positions: RenderPositionMap;
}

export interface DragEndOptions {
  keepFixed?: boolean;
}

export class LiveGraphSimulation {
  readonly nodes: LiveSimulationNode[];

  private readonly simulation: Simulation<LiveSimulationNode, LiveSimulationLink>;
  private readonly nodeById: Map<NodeId, LiveSimulationNode>;
  private readonly directNeighbors: Map<NodeId, Set<NodeId>>;
  private readonly onTick?: (snapshot: LiveGraphSimulationSnapshot) => void;
  private draggedNodeId: NodeId | null = null;
  private destroyed = false;

  constructor(graph: RenderableGraph, private readonly options: LiveGraphSimulationOptions = {}) {
    this.nodes = graph.nodes.map((node) => toSimulationNode(node));
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.directNeighbors = buildNeighborMap(graph);
    this.onTick = options.onTick;

    const links: LiveSimulationLink[] = graph.edges
      .filter((edge) => this.nodeById.has(edge.source) && this.nodeById.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        weight: Number.isFinite(Number(edge.strokeWidth)) ? Number(edge.strokeWidth) : 1
      }));

    this.simulation = forceSimulation<LiveSimulationNode, LiveSimulationLink>(this.nodes)
      .force("link", forceLink<LiveSimulationNode, LiveSimulationLink>(links)
        .id((node) => node.id)
        .distance((link) => linkDistance(link))
        .strength((link) => linkStrength(link)))
      .force("charge", forceManyBody<LiveSimulationNode>().strength(-34).distanceMax(220))
      .force("x", forceX<LiveSimulationNode>((node) => node.baseX).strength(0.052))
      .force("y", forceY<LiveSimulationNode>((node) => node.baseY).strength(0.052))
      .force("collide", forceCollide<LiveSimulationNode>((node) => nodeRadius(node)).strength(0.64).iterations(2))
      .alpha(this.coldStartAlpha)
      .alphaMin(this.alphaMin)
      .alphaDecay(this.alphaDecay)
      .velocityDecay(this.velocityDecay)
      .on("tick", () => this.emitTick())
      .stop();
  }

  get alpha(): number {
    return this.simulation.alpha();
  }

  get coldStartAlpha(): number {
    return clampNumber(this.options.coldStartAlpha, 0.08, 0.01, 0.4);
  }

  get lowHeatAlphaTarget(): number {
    return clampNumber(this.options.lowHeatAlphaTarget, 0.15, 0.05, 0.3);
  }

  get alphaMin(): number {
    return clampNumber(this.options.alphaMin, 0.003, 0.0001, 0.02);
  }

  get alphaDecay(): number {
    return clampNumber(this.options.alphaDecay, 0.14, 0.02, 0.6);
  }

  get velocityDecay(): number {
    return clampNumber(this.options.velocityDecay, 0.58, 0.2, 0.9);
  }

  startCold(): void {
    this.assertActive();
    this.simulation.alpha(this.coldStartAlpha).alphaTarget(0).restart();
  }

  tick(count = 1): LiveGraphSimulationSnapshot {
    this.assertActive();
    this.simulation.tick(Math.max(1, Math.floor(count)));
    const snapshot = this.snapshot();
    this.onTick?.(snapshot);
    return snapshot;
  }

  settle(maxTicks = 240): LiveGraphSimulationSnapshot {
    this.assertActive();
    let ticks = 0;
    while (this.simulation.alpha() > this.alphaMin && ticks < maxTicks) {
      this.simulation.tick();
      ticks += 1;
    }
    this.simulation.alpha(0).alphaTarget(0).stop();
    const snapshot = this.snapshot();
    this.onTick?.(snapshot);
    return snapshot;
  }

  beginDrag(id: NodeId): LiveSimulationNode {
    this.assertActive();
    const node = this.requireNode(id);
    this.draggedNodeId = id;
    this.freezeFarNodes(id);
    node.fx = node.x ?? node.baseX;
    node.fy = node.y ?? node.baseY;
    this.simulation.alpha(Math.max(this.simulation.alpha(), this.lowHeatAlphaTarget)).alphaTarget(this.lowHeatAlphaTarget).restart();
    return node;
  }

  dragTo(id: NodeId, position: { x: number; y: number }): LiveSimulationNode {
    this.assertActive();
    const node = this.requireNode(id);
    node.fx = clampNumber(position.x, node.baseX, 0, 1000);
    node.fy = clampNumber(position.y, node.baseY, 0, 680);
    return node;
  }

  setFixed(id: NodeId, position: { x: number; y: number } | null): LiveSimulationNode {
    this.assertActive();
    const node = this.requireNode(id);
    if (position === null) {
      node.fx = null;
      node.fy = null;
      return node;
    }
    node.fx = finiteNumber(position.x, node.baseX);
    node.fy = finiteNumber(position.y, node.baseY);
    node.x = node.fx;
    node.y = node.fy;
    return node;
  }

  endDrag(options: DragEndOptions = {}): LiveGraphSimulationSnapshot {
    this.assertActive();
    const node = this.draggedNodeId ? this.nodeById.get(this.draggedNodeId) : null;
    if (node && !options.keepFixed) {
      node.fx = null;
      node.fy = null;
    }
    this.unfreezeFarNodes();
    this.draggedNodeId = null;
    this.simulation.alphaTarget(0);
    return this.snapshot();
  }

  snapshot(): LiveGraphSimulationSnapshot {
    return {
      alpha: this.simulation.alpha(),
      positions: Object.fromEntries(this.nodes.map((node) => [
        node.id,
        {
          x: round(node.x ?? node.baseX),
          y: round(node.y ?? node.baseY)
        }
      ]))
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.simulation.stop();
    this.simulation.on("tick", null);
  }

  private requireNode(id: NodeId): LiveSimulationNode {
    const node = this.nodeById.get(id);
    if (!node) throw new Error(`Unknown graph node: ${id}`);
    return node;
  }

  private freezeFarNodes(draggedId: NodeId): void {
    const neighbors = this.directNeighbors.get(draggedId) ?? new Set<NodeId>();
    for (const node of this.nodes) {
      if (node.id === draggedId || neighbors.has(node.id)) continue;
      node.fixedByDrag = true;
      node.savedFx = node.fx ?? null;
      node.savedFy = node.fy ?? null;
      node.fx = node.x ?? node.baseX;
      node.fy = node.y ?? node.baseY;
    }
  }

  private unfreezeFarNodes(): void {
    for (const node of this.nodes) {
      if (!node.fixedByDrag) continue;
      node.fx = node.savedFx ?? null;
      node.fy = node.savedFy ?? null;
      delete node.fixedByDrag;
      delete node.savedFx;
      delete node.savedFy;
    }
  }

  private emitTick(): void {
    this.onTick?.(this.snapshot());
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("Graph simulation has been destroyed");
  }
}

export function createLiveGraphSimulation(graph: RenderableGraph, options?: LiveGraphSimulationOptions): LiveGraphSimulation {
  return new LiveGraphSimulation(graph, options);
}

function toSimulationNode(node: RenderableNode): LiveSimulationNode {
  return {
    id: node.id,
    sourcePath: node.sourcePath,
    baseX: node.point.x,
    baseY: node.point.y,
    x: node.point.x,
    y: node.point.y
  };
}

function buildNeighborMap(graph: RenderableGraph): Map<NodeId, Set<NodeId>> {
  const map = new Map<NodeId, Set<NodeId>>();
  for (const node of graph.nodes) map.set(node.id, new Set<NodeId>());
  for (const edge of graph.edges) {
    map.get(edge.source)?.add(edge.target);
    map.get(edge.target)?.add(edge.source);
  }
  return map;
}

function linkDistance(link: LiveSimulationLink): number {
  return 118 - clampNumber(link.weight, 1.6, 0.8, 3.4) * 10;
}

function linkStrength(link: LiveSimulationLink): number {
  return clampNumber(0.032 + link.weight * 0.012, 0.052, 0.02, 0.09);
}

function nodeRadius(node: LiveSimulationNode): number {
  return Math.max(14, Math.min(58, 24 + Math.abs(node.baseX - 500) / 44));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
