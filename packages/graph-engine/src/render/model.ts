import type { GraphData, NodeId, PinMap, SelectionInput, ThemeId, WikiPath } from "../types";
import {
  atlasNodePoint,
  atlasPointToMinimap,
  buildAtlasModel,
  deriveAtlasLayout,
  getAtlasDensityMode,
  resolveAtlasVisibleSnapshot
} from "../model";
import { getCommunityColor } from "../themes";

export type DensityMode = "card" | "compact-card" | "point-plus-focus" | "overview";
export type NodeDisplayMode = "card" | "compact-card" | "point" | "overview";
export type NodeVisualRole = "landmark" | "index-slip" | "cinnabar-note" | "map-pin";

export interface RenderableGraph {
  model: Record<string, unknown>;
  layout: Record<string, unknown>;
  selectedNodeId: string | null;
  densityMode: DensityMode;
  counts: {
    visibleNodes: number;
    visibleEdges: number;
    totalNodes: number;
    totalEdges: number;
    totalCommunities: number;
  };
  nodes: RenderableNode[];
  edges: RenderableEdge[];
  communities: RenderableCommunity[];
  minimap: RenderableMinimap;
}

export interface RenderableNode {
  id: string;
  label: string;
  type: string;
  kind: string;
  community: string;
  sourcePath: string;
  x: number;
  y: number;
  point: { x: number; y: number };
  displayMode: NodeDisplayMode;
  visualRole: NodeVisualRole;
  priority: number;
  weight: number;
  unavailable: boolean;
  selected: boolean;
  startNode: boolean;
  previewStart: boolean;
  labelVisible: boolean;
}

export interface RenderableEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  path: string;
  curveOffset: number;
  strokeWidth: number;
  opacity: number;
}

export interface RenderableCommunity {
  id: string;
  label: string;
  color: string;
  nodeCount: number;
  wash: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    opacity: number;
  } | null;
}

export interface RenderableMinimap {
  path: string;
  nodes: Array<{ id: string; x: number; y: number; r: number; fill: string; selected: boolean }>;
}

interface BuildRenderableGraphOptions {
  pins?: PinMap;
  theme?: ThemeId;
  selectedNodeId?: string | null;
  selection?: SelectionInput | null;
  positions?: RenderPositionMap;
  pathCache?: RenderPathCache;
}

type AtlasNode = {
  id: string;
  label: string;
  type: string;
  kind: string;
  community: string;
  source_path?: string;
  x: number;
  y: number;
  priority?: number;
  weight?: number;
  unavailable?: boolean;
};

type AtlasEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight?: number;
};

type AtlasCommunity = {
  id: string;
  label?: string;
  node_count?: number;
  color_index?: number;
};

export interface RenderPosition {
  x: number;
  y: number;
}

export type RenderPositionMap = Record<NodeId, RenderPosition>;

export interface RenderPathCache {
  getEdgeCurve(edge: { id: string; source: string; target: string; weight?: number }, source: RenderPosition, target: RenderPosition): number;
  clear(): void;
}

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 680;
const MINIMAP_PATH = "M8 40 C34 20 54 36 76 22 C98 8 118 24 150 12";

export function createRenderPathCache(): RenderPathCache {
  const edgeCurves = new Map<string, number>();
  return {
    getEdgeCurve(edge, source, target): number {
      const key = edge.id || `${edge.source}->${edge.target}`;
      const existing = edgeCurves.get(key);
      if (existing != null) return existing;
      const curve = edgeCurveOffset(source, target, edge);
      edgeCurves.set(key, curve);
      return curve;
    },
    clear(): void {
      edgeCurves.clear();
    }
  };
}

export function buildRenderableGraph(data: GraphData, options: BuildRenderableGraphOptions = {}): RenderableGraph {
  const theme = options.theme || "shan-shui";
  const dataWithPins = applyPinsToGraphData(data, options.pins || {});
  const model = buildAtlasModel(dataWithPins) as {
    nodes: AtlasNode[];
    edges: AtlasEdge[];
    byId: Record<string, AtlasNode>;
    communities: AtlasCommunity[];
    communityById: Record<string, AtlasCommunity>;
  };
  const layout = deriveAtlasLayout(model) as Record<string, unknown>;
  const selectedNodeIds = resolveSelectedNodeIds(model, options);
  const selectedNodeSet = new Set(selectedNodeIds);
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const visible = resolveAtlasVisibleSnapshot(model, layout, { selectedNodeId }) as {
    nodes: AtlasNode[];
    edges: AtlasEdge[];
    densityMode: DensityMode;
    labelNodeIds: Record<string, boolean>;
    importantNodeIds: Record<string, boolean>;
    startNodeIds: Record<string, boolean>;
    starts: Array<{ node: AtlasNode }>;
    counts: {
      visible_nodes: number;
      visible_edges: number;
      total_nodes: number;
      total_edges: number;
      total_communities: number;
    };
  };
  const previewNodeId = selectedNodeId ? null : firstPreviewNodeId(visible);
  const importantIds = visible.importantNodeIds || {};
  const labelIds = visible.labelNodeIds || {};
  const startIds = visible.startNodeIds || {};

  const nodes = visible.nodes.map((node) => {
    const isSelected = selectedNodeSet.has(node.id);
    const displayMode = isSelected
      ? "card"
      : nodeDisplayMode(node, visible.densityMode, selectedNodeId, previewNodeId, labelIds, importantIds);
    const point = renderPointForNode(node, options.positions);
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      kind: node.kind,
      community: node.community,
      sourcePath: wikiPathForNode(node),
      x: pointToPercentX(point.x),
      y: pointToPercentY(point.y),
      point,
      displayMode,
      visualRole: nodeVisualRole(node, displayMode, isSelected ? node.id : selectedNodeId, previewNodeId, importantIds),
      priority: Number(node.priority || 0),
      weight: Number(node.weight || 0),
      unavailable: node.unavailable === true,
      selected: isSelected,
      startNode: startIds[node.id] === true,
      previewStart: node.id === previewNodeId,
      labelVisible: labelIds[node.id] === true
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = visible.edges.flatMap((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return [];
    const curveOffset = options.pathCache?.getEdgeCurve(edge, source.point, target.point) ?? edgeCurveOffset(source.point, target.point, edge);
    return [{
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: String(edge.type || "EXTRACTED").toLowerCase(),
      path: makeEdgePathFromPoints(source.point, target.point, curveOffset),
      curveOffset,
      strokeWidth: edgeStrokeWidth(edge),
      opacity: edgeOpacity(edge)
    }];
  });

  const communities = model.communities.map((community, index) => {
    const communityNodes = nodes.filter((node) => node.community === community.id);
    return {
      id: community.id,
      label: community.label || community.id,
      color: getCommunityColor(theme, Number(community.color_index ?? index)),
      nodeCount: Number(community.node_count ?? communityNodes.length),
      wash: computeCommunityWash(communityNodes)
    };
  });
  const communityById = new Map(communities.map((community) => [community.id, community]));

  return {
    model,
    layout,
    selectedNodeId,
    densityMode: visible.densityMode,
    counts: {
      visibleNodes: visible.counts.visible_nodes,
      visibleEdges: visible.counts.visible_edges,
      totalNodes: visible.counts.total_nodes,
      totalEdges: visible.counts.total_edges,
      totalCommunities: visible.counts.total_communities
    },
    nodes,
    edges,
    communities: communities.filter((community) => community.wash),
    minimap: {
      path: MINIMAP_PATH,
      nodes: nodes.slice(0, 60).map((node) => {
        const point = atlasPointToMinimap(node.point) as { x: number; y: number };
        return {
          id: node.id,
          x: point.x,
          y: point.y,
          r: node.selected ? 3.2 : 2.2,
          fill: communityById.get(node.community)?.color || getCommunityColor(theme, 0),
          selected: node.selected
        };
      })
    }
  };
}

export function makeEdgePath(source: AtlasNode, target: AtlasNode, edge: { weight?: number }): string {
  const sourcePoint = atlasNodePoint(source) as { x: number; y: number };
  const targetPoint = atlasNodePoint(target) as { x: number; y: number };
  return makeEdgePathFromPoints(sourcePoint, targetPoint, edgeCurveOffset(sourcePoint, targetPoint, edge));
}

export function makeEdgePathFromPoints(sourcePoint: RenderPosition, targetPoint: RenderPosition, curveOffset: number): string {
  const x1 = sourcePoint.x;
  const y1 = sourcePoint.y;
  const x2 = targetPoint.x;
  const y2 = targetPoint.y;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `M ${round(x1)} ${round(y1)} Q ${round(mx + curveOffset)} ${round(my - 22)} ${round(x2)} ${round(y2)}`;
}

export function edgeStrokeWidth(edge: { weight?: number }): number {
  return round(1.1 + clampWeight(edge.weight) * 1.8);
}

export function edgeOpacity(edge: { weight?: number }): number {
  return round(0.32 + clampWeight(edge.weight) * 0.44);
}

export function screenEffectiveDensityMode(visibleNodeCount: number, viewportScale: number): DensityMode {
  const count = Number.isFinite(Number(visibleNodeCount)) ? Math.max(0, Number(visibleNodeCount)) : 0;
  const scale = Number.isFinite(Number(viewportScale)) ? clamp(Number(viewportScale), 0.25, 4) : 1;
  return getAtlasDensityMode(Math.ceil(count / (scale * scale))) as DensityMode;
}

export function nodeDisplayModeForDensity(
  node: Pick<RenderableNode, "selected" | "labelVisible" | "visualRole">,
  densityMode: DensityMode
): NodeDisplayMode {
  if (node.selected) return "card";
  if (densityMode === "card") return "card";
  if (densityMode === "compact-card") return "compact-card";
  const shouldShowLabel = node.labelVisible || node.visualRole !== "map-pin";
  if (densityMode === "point-plus-focus") return shouldShowLabel ? "compact-card" : "point";
  return shouldShowLabel ? "compact-card" : "overview";
}

function applyPinsToGraphData(data: GraphData, pins: PinMap): GraphData {
  if (!Object.keys(pins).length) return data;
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      const pin = pins[pinKeyForNode(node)];
      if (!pin) return node;
      return {
        ...node,
        x: normalizePinnedX(pin.x),
        y: normalizePinnedY(pin.y)
      };
    })
  };
}

function pinKeyForNode(node: { source_path?: unknown; path?: unknown; source?: unknown; id: string }): WikiPath {
  return String(node.source_path || node.path || node.source || wikiPathForNode(node));
}

function wikiPathForNode(node: { source_path?: unknown; path?: unknown; source?: unknown; type?: unknown; id: string }): WikiPath {
  const existing = String(node.source_path || node.path || node.source || "");
  if (existing) return existing;
  const id = node.id.endsWith(".md") ? node.id.slice(0, -3) : node.id;
  return `wiki/${wikiDirectoryForType(String(node.type || ""))}/${id}.md`;
}

function wikiDirectoryForType(type: string): string {
  if (type === "topic") return "topics";
  if (type === "source") return "sources";
  if (type === "comparison") return "comparisons";
  if (type === "synthesis") return "synthesis";
  if (type === "query") return "queries";
  return "entities";
}

function renderPointForNode(node: AtlasNode, positions?: RenderPositionMap): RenderPosition {
  const position = positions?.[node.id];
  if (position) {
    return {
      x: clamp(position.x, 0, WORLD_WIDTH),
      y: clamp(position.y, 0, WORLD_HEIGHT)
    };
  }
  return atlasNodePoint(node) as RenderPosition;
}

function pointToPercentX(value: number): number {
  return round(clamp(value, 0, WORLD_WIDTH) / WORLD_WIDTH * 100);
}

function pointToPercentY(value: number): number {
  return round(clamp(value, 0, WORLD_HEIGHT) / WORLD_HEIGHT * 100);
}

function edgeCurveOffset(sourcePoint: RenderPosition, targetPoint: RenderPosition, edge: { weight?: number }): number {
  const sourceYPercent = sourcePoint.y / WORLD_HEIGHT * 100;
  const targetYPercent = targetPoint.y / WORLD_HEIGHT * 100;
  return Math.max(-76, Math.min(76, (sourceYPercent - targetYPercent) * 1.8 + (clampWeight(edge.weight) - 0.5) * 24));
}

function normalizePinnedX(value: number): number {
  return value > 100 ? clamp(value / WORLD_WIDTH * 100, 0, 100) : clamp(value, 0, 100);
}

function normalizePinnedY(value: number): number {
  return value > 100 ? clamp(value / WORLD_HEIGHT * 100, 0, 100) : clamp(value, 0, 100);
}

function resolveSelectedNodeIds(
  model: { byId: Record<string, AtlasNode>; nodes: AtlasNode[] },
  options: BuildRenderableGraphOptions
): string[] {
  if (options.selection?.kind === "node" && model.byId[options.selection.id]) return [options.selection.id];
  if (options.selection?.kind === "nodes") {
    const selected = new Set(options.selection.ids);
    return model.nodes.map((node) => node.id).filter((id) => selected.has(id));
  }
  if (options.selectedNodeId && model.byId[options.selectedNodeId]) return [options.selectedNodeId];
  return [];
}

function firstPreviewNodeId(visible: { starts: Array<{ node: AtlasNode }>; nodes: AtlasNode[] }): string | null {
  const firstStart = visible.starts.find((entry) => entry?.node);
  if (firstStart?.node) return firstStart.node.id;
  const fallback = visible.nodes.slice().sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0];
  return fallback ? fallback.id : null;
}

function nodeDisplayMode(
  node: AtlasNode,
  densityMode: DensityMode,
  selectedNodeId: string | null,
  previewNodeId: string | null,
  labelNodeIds: Record<string, boolean>,
  importantNodeIds: Record<string, boolean>
): NodeDisplayMode {
  if (node.id === selectedNodeId) return "card";
  if (previewNodeId && node.id === previewNodeId && (densityMode === "overview" || densityMode === "point-plus-focus")) return "compact-card";
  if (importantNodeIds[node.id] && (densityMode === "overview" || densityMode === "point-plus-focus")) return "compact-card";
  if (densityMode === "overview") return labelNodeIds[node.id] ? "compact-card" : "overview";
  if (densityMode === "point-plus-focus") return labelNodeIds[node.id] ? "compact-card" : "point";
  return densityMode;
}

function nodeVisualRole(
  node: AtlasNode,
  displayMode: NodeDisplayMode,
  selectedNodeId: string | null,
  previewNodeId: string | null,
  importantNodeIds: Record<string, boolean>
): NodeVisualRole {
  if (node.id === selectedNodeId) return "cinnabar-note";
  if (displayMode === "point" || displayMode === "overview") return "map-pin";
  if (previewNodeId && node.id === previewNodeId) return "index-slip";
  if (importantNodeIds[node.id]) return "index-slip";
  return "landmark";
}

function computeCommunityWash(nodes: RenderableNode[]): RenderableCommunity["wash"] {
  if (!nodes.length) return null;
  const points = communityWashCorePoints(nodes);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    cx: round((minX + maxX) / 2),
    cy: round((minY + maxY) / 2),
    rx: round(Math.max(54, (maxX - minX) / 2 + 46)),
    ry: round(Math.max(36, (maxY - minY) / 2 + 34)),
    opacity: nodes.length > 1 ? 0.11 : 0.06
  };
}

function communityWashCorePoints(nodes: RenderableNode[]): RenderPosition[] {
  const points = nodes.map((node) => node.point);
  if (points.length <= 3) return points;
  const scored = points
    .map((point) => ({
      point,
      neighborScore: nearestNeighborScore(point, points)
    }))
    .sort((left, right) => left.neighborScore - right.neighborScore);
  const coreCount = Math.max(2, Math.ceil(points.length * 0.75));
  const core = scored.slice(0, coreCount);
  const excluded = scored.slice(coreCount);
  const coreMax = Math.max(...core.map((item) => item.neighborScore));
  const excludedMin = Math.min(...excluded.map((item) => item.neighborScore));
  if (!Number.isFinite(excludedMin) || excludedMin <= Math.max(180, coreMax * 2.5)) {
    return points;
  }
  return core.map((item) => item.point);
}

function nearestNeighborScore(point: RenderPosition, points: RenderPosition[]): number {
  const distances = points
    .filter((candidate) => candidate !== point)
    .map((candidate) => distance(point, candidate))
    .sort((left, right) => left - right);
  const nearest = distances.slice(0, Math.min(2, distances.length));
  return nearest.reduce((sum, value) => sum + value, 0) / Math.max(1, nearest.length);
}

function distance(left: RenderPosition, right: RenderPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clampWeight(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return clamp(numeric, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
