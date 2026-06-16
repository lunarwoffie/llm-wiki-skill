import { quadtree } from "d3-quadtree";
import { cardDims } from "../model/labels";
import type { Quadtree, QuadtreeLeaf, QuadtreeNode } from "d3-quadtree";

export type GraphSpatialHitKind = "node" | "edge" | "community-wash" | "graph-blank";

export interface GraphSpatialPoint {
  x: number;
  y: number;
}

export interface GraphSpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphSpatialNodeLike {
  id: string;
  label?: string;
  type?: string;
  displayMode?: string;
  visualRole?: string;
  point?: GraphSpatialPoint;
  x?: number;
  y?: number;
  hitBounds?: GraphSpatialRect;
}

export interface GraphSpatialEdgeLike {
  id: string;
  source: string;
  target: string;
  curveOffset?: number;
}

export interface GraphSpatialCommunityLike {
  id: string;
  wash?: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  } | null;
}

export type GraphSpatialHitTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "community-wash"; id: string }
  | { kind: "graph-blank" };

export interface GraphSpatialIndexInput {
  nodes?: readonly GraphSpatialNodeLike[];
  edges?: readonly GraphSpatialEdgeLike[];
  communities?: readonly GraphSpatialCommunityLike[];
  edgeHitTolerance?: number;
  nodeFallbackRadius?: number;
}

interface SpatialNodeEntry {
  id: string;
  point: GraphSpatialPoint;
  bounds: GraphSpatialRect;
  radius: number;
  order: number;
}

interface SpatialEdgeEntry {
  id: string;
  source: GraphSpatialPoint;
  target: GraphSpatialPoint;
  curveOffset: number;
  order: number;
}

interface SpatialCommunityEntry {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  order: number;
}

export const DEFAULT_GRAPH_EDGE_HIT_TOLERANCE = 10;
export const DEFAULT_GRAPH_NODE_FALLBACK_RADIUS = 32;

export class GraphSpatialIndex {
  private readonly nodes: SpatialNodeEntry[];
  private readonly edges: SpatialEdgeEntry[];
  private readonly communities: SpatialCommunityEntry[];
  private readonly nodeTree: Quadtree<SpatialNodeEntry>;
  private readonly maxNodeRadius: number;
  private readonly edgeHitTolerance: number;
  private readonly nodeFallbackRadius: number;

  constructor(input: GraphSpatialIndexInput = {}) {
    this.edgeHitTolerance = finitePositiveNumber(input.edgeHitTolerance, DEFAULT_GRAPH_EDGE_HIT_TOLERANCE);
    this.nodeFallbackRadius = finitePositiveNumber(input.nodeFallbackRadius, DEFAULT_GRAPH_NODE_FALLBACK_RADIUS);
    this.nodes = normalizeNodes(input.nodes || [], this.nodeFallbackRadius);
    this.maxNodeRadius = this.nodes.reduce((max, node) => Math.max(max, node.radius), this.nodeFallbackRadius);
    this.nodeTree = quadtree<SpatialNodeEntry>(
      this.nodes,
      (node) => node.point.x,
      (node) => node.point.y
    );

    const nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = normalizeEdges(input.edges || [], nodeById);
    this.communities = normalizeCommunities(input.communities || []);
  }

  rebuild(input: GraphSpatialIndexInput): GraphSpatialIndex {
    return new GraphSpatialIndex(input);
  }

  hitTest(point: GraphSpatialPoint): GraphSpatialHitTarget {
    const safePoint = normalizePoint(point);
    const node = this.findNode(safePoint);
    if (node) return { kind: "node", id: node.id };

    const edge = this.findEdge(safePoint);
    if (edge) return { kind: "edge", id: edge.id };

    const community = this.findCommunity(safePoint);
    if (community) return { kind: "community-wash", id: community.id };

    return { kind: "graph-blank" };
  }

  findNode(point: GraphSpatialPoint): SpatialNodeEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.collectNodeCandidates(safePoint);
    if (!candidates.length) return null;
    return candidates
      .sort((left, right) => {
        const distanceDelta = pointToRectDistance(safePoint, left.bounds) - pointToRectDistance(safePoint, right.bounds);
        if (distanceDelta !== 0) return distanceDelta;
        return left.order - right.order;
      })[0] || null;
  }

  findEdge(point: GraphSpatialPoint): SpatialEdgeEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.edges
      .map((edge) => ({
        edge,
        distance: distanceToCurvedEdge(safePoint, edge.source, edge.target, edge.curveOffset)
      }))
      .filter((candidate) => candidate.distance <= this.edgeHitTolerance)
      .sort((left, right) => left.distance - right.distance || left.edge.order - right.edge.order);
    return candidates[0]?.edge || null;
  }

  findCommunity(point: GraphSpatialPoint): SpatialCommunityEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.communities
      .map((community) => ({
        community,
        score: ellipseContainmentScore(safePoint, community)
      }))
      .filter((candidate) => candidate.score <= 1)
      .sort((left, right) => left.score - right.score || left.community.order - right.community.order);
    return candidates[0]?.community || null;
  }

  nearestNode(point: GraphSpatialPoint, radius = this.maxNodeRadius): SpatialNodeEntry | null {
    return this.nodeTree.find(finiteNumber(point.x, 0), finiteNumber(point.y, 0), finitePositiveNumber(radius, this.maxNodeRadius)) || null;
  }

  private collectNodeCandidates(point: GraphSpatialPoint): SpatialNodeEntry[] {
    const candidates: SpatialNodeEntry[] = [];
    const radius = this.maxNodeRadius;
    this.nodeTree.visit((quad, x0, y0, x1, y1) => {
      if (x0 > point.x + radius || x1 < point.x - radius || y0 > point.y + radius || y1 < point.y - radius) {
        return true;
      }
      const leaf = asQuadtreeLeaf(quad);
      if (!leaf) return false;
      let current: QuadtreeLeaf<SpatialNodeEntry> | undefined = leaf;
      while (current) {
        if (rectContainsPoint(current.data.bounds, point)) candidates.push(current.data);
        current = current.next;
      }
      return false;
    });
    return candidates;
  }
}

export function createGraphSpatialIndex(input: GraphSpatialIndexInput = {}): GraphSpatialIndex {
  return new GraphSpatialIndex(input);
}

function normalizeNodes(nodes: readonly GraphSpatialNodeLike[], fallbackRadius: number): SpatialNodeEntry[] {
  return nodes.flatMap((node, index) => {
    const point = pointForNode(node);
    if (!point) return [];
    const bounds = node.hitBounds ? normalizeRect(node.hitBounds, point, fallbackRadius) : nodeBounds(node, point, fallbackRadius);
    return [{
      id: String(node.id),
      point,
      bounds,
      radius: rectRadius(bounds, point),
      order: index
    }];
  });
}

function normalizeEdges(edges: readonly GraphSpatialEdgeLike[], nodeById: Map<string, SpatialNodeEntry>): SpatialEdgeEntry[] {
  return edges.flatMap((edge, index) => {
    const source = nodeById.get(String(edge.source));
    const target = nodeById.get(String(edge.target));
    if (!source || !target) return [];
    return [{
      id: String(edge.id),
      source: clonePoint(source.point),
      target: clonePoint(target.point),
      curveOffset: finiteNumber(edge.curveOffset, 0),
      order: index
    }];
  });
}

function normalizeCommunities(communities: readonly GraphSpatialCommunityLike[]): SpatialCommunityEntry[] {
  return communities.flatMap((community, index) => {
    const wash = community.wash;
    if (!wash) return [];
    const rx = finitePositiveNumber(wash.rx, 0);
    const ry = finitePositiveNumber(wash.ry, 0);
    if (rx <= 0 || ry <= 0) return [];
    return [{
      id: String(community.id),
      cx: finiteNumber(wash.cx, 0),
      cy: finiteNumber(wash.cy, 0),
      rx,
      ry,
      order: index
    }];
  });
}

function pointForNode(node: GraphSpatialNodeLike): GraphSpatialPoint | null {
  if (node.point) return normalizePoint(node.point);
  if (typeof node.x === "number" && typeof node.y === "number") return normalizePoint({ x: node.x, y: node.y });
  return null;
}

function nodeBounds(node: GraphSpatialNodeLike, point: GraphSpatialPoint, fallbackRadius: number): GraphSpatialRect {
  if (node.displayMode === "point" || node.displayMode === "overview" || node.visualRole === "map-pin") {
    return centeredRect(point, 28, 28);
  }
  if (node.displayMode === "compact-card" || node.visualRole === "landmark") {
    return centeredRect(point, 130, 42);
  }
  if (node.label || node.type || node.id) {
    const dims = cardDims({ id: node.id, label: node.label || node.id, type: node.type || "entity" });
    return centeredRect(point, Math.max(72, Math.min(182, dims.w)), Math.max(46, dims.h));
  }
  return centeredRect(point, fallbackRadius * 2, fallbackRadius * 2);
}

function normalizeRect(rect: GraphSpatialRect, fallbackCenter: GraphSpatialPoint, fallbackRadius: number): GraphSpatialRect {
  const width = finitePositiveNumber(rect.width, fallbackRadius * 2);
  const height = finitePositiveNumber(rect.height, fallbackRadius * 2);
  return {
    x: finiteNumber(rect.x, fallbackCenter.x - width / 2),
    y: finiteNumber(rect.y, fallbackCenter.y - height / 2),
    width,
    height
  };
}

function centeredRect(point: GraphSpatialPoint, width: number, height: number): GraphSpatialRect {
  return {
    x: point.x - width / 2,
    y: point.y - height / 2,
    width,
    height
  };
}

function rectContainsPoint(rect: GraphSpatialRect, point: GraphSpatialPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function pointToRectDistance(point: GraphSpatialPoint, rect: GraphSpatialRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function rectRadius(rect: GraphSpatialRect, point: GraphSpatialPoint): number {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ];
  return Math.max(...corners.map((corner) => distance(point, corner)));
}

function distanceToCurvedEdge(point: GraphSpatialPoint, source: GraphSpatialPoint, target: GraphSpatialPoint, curveOffset: number): number {
  const control = {
    x: (source.x + target.x) / 2 + curveOffset,
    y: (source.y + target.y) / 2 - 22
  };
  let previous = source;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= 24; step += 1) {
    const t = step / 24;
    const current = quadraticBezierPoint(source, control, target, t);
    minDistance = Math.min(minDistance, distanceToSegment(point, previous, current));
    previous = current;
  }
  return minDistance;
}

function quadraticBezierPoint(start: GraphSpatialPoint, control: GraphSpatialPoint, end: GraphSpatialPoint, t: number): GraphSpatialPoint {
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
  };
}

function distanceToSegment(point: GraphSpatialPoint, start: GraphSpatialPoint, end: GraphSpatialPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy
  });
}

function ellipseContainmentScore(point: GraphSpatialPoint, community: SpatialCommunityEntry): number {
  const dx = (point.x - community.cx) / community.rx;
  const dy = (point.y - community.cy) / community.ry;
  return dx * dx + dy * dy;
}

function asQuadtreeLeaf<T>(node: QuadtreeNode<T>): QuadtreeLeaf<T> | null {
  return Array.isArray(node) ? null : node;
}

function clonePoint(point: GraphSpatialPoint): GraphSpatialPoint {
  return { x: point.x, y: point.y };
}

function normalizePoint(point: GraphSpatialPoint): GraphSpatialPoint {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0)
  };
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  const numeric = finiteNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function distance(left: GraphSpatialPoint, right: GraphSpatialPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
