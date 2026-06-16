import type { GraphData, GraphFocusInput, GraphTypeFilters, NodeId, PinMap, SelectionInput, ThemeId, WikiPath } from "../types";
import {
  atlasNodePoint,
  buildAtlasModel,
  deriveAtlasLayout,
  getAtlasDensityMode,
  resolveAtlasVisibleSnapshot
} from "../model";
import { wikiPathForGraphNode } from "../graph-node";
import { getCommunityColor } from "../themes";
import { computeCommunityWash } from "./community-wash";
import { GRAPH_WORLD_SIZE, worldBoundsForPoints, worldPointToCssPercentPoint, worldPointToMinimapPoint, type GraphWorldBounds } from "./geometry";
import { pinPositionToWorldPoint } from "./pin-position";

export type DensityMode = "card" | "compact-card" | "point-plus-focus" | "overview";
export type NodeDisplayMode = "card" | "compact-card" | "point" | "overview";
export type NodeVisualRole = "landmark" | "index-slip" | "cinnabar-note" | "map-pin";

export interface RenderableGraph {
  model: Record<string, unknown>;
  layout: Record<string, unknown>;
  worldBounds: GraphWorldBounds;
  selectedNodeId: string | null;
  focus: GraphFocusInput;
  typeFilters: GraphTypeFilters;
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
  confidence: string;
  relationType: string;
  relationClass: string;
  path: string;
  curveOffset: number;
  strokeWidth: number;
  opacity: number;
  simulationWeight: number;
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
  focus?: GraphFocusInput;
  typeFilters?: GraphTypeFilters;
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
  confidence?: string;
  relation_type?: string;
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
  const model = buildAtlasModel(data) as {
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
  const focus = normalizeGraphFocus(options.focus, model);
  const typeFilters = normalizeGraphTypeFilters(options.typeFilters, model.nodes);
  const visible = resolveAtlasVisibleSnapshot(model, layout, {
    activeCommunityId: focus?.kind === "community" ? focus.id : "all",
    selectedNodeId
  }) as {
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

  const filteredVisibleNodes = applyNodeTypeFilters(visible.nodes, typeFilters);
  const filteredVisibleNodeIds = new Set(filteredVisibleNodes.map((node) => node.id));
  const filteredVisibleEdges = visible.edges.filter((edge) => filteredVisibleNodeIds.has(edge.source) && filteredVisibleNodeIds.has(edge.target));
  const filteredDensityMode = getAtlasDensityMode(filteredVisibleNodes.length) as DensityMode;
  const filteredVisibleCounts = {
    visible_nodes: filteredVisibleNodes.length,
    visible_edges: filteredVisibleEdges.length,
    total_nodes: visible.counts.total_nodes,
    total_edges: visible.counts.total_edges,
    total_communities: visible.counts.total_communities
  };

  const allFilteredNodes = applyNodeTypeFilters(model.nodes, typeFilters);
  const pointById = new Map(allFilteredNodes.map((node) => [node.id, renderPointForNode(node, options)]));
  const worldBounds = worldBoundsForPoints([...pointById.values()]);

  const nodes = filteredVisibleNodes.map((node) => {
    const isSelected = selectedNodeSet.has(node.id);
    const displayMode = isSelected
      ? "card"
      : nodeDisplayMode(node, filteredDensityMode, selectedNodeId, previewNodeId, labelIds, importantIds);
    const point = pointById.get(node.id) || renderPointForNode(node, options);
    const cssPoint = worldPointToCssPercentPoint(point, worldBounds);
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      kind: node.kind,
      community: node.community,
      sourcePath: wikiPathForGraphNode(node),
      x: round(cssPoint.x),
      y: round(cssPoint.y),
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
  const isFocusedView = focus?.kind === "community";
  const edges = filteredVisibleEdges.flatMap((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return [];
    const curveOffset = options.pathCache?.getEdgeCurve(edge, source.point, target.point) ?? edgeCurveOffset(source.point, target.point, edge, worldBounds);
    const confidence = normalizeEdgeConfidence(edge);
    const relationType = normalizeEdgeRelationType(edge);
    return [{
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: confidence,
      confidence,
      relationType,
      relationClass: edgeRelationClass(relationType),
      path: makeEdgePathFromPoints(source.point, target.point, curveOffset),
      curveOffset,
      strokeWidth: edgeVisualStrokeWidth(edge, isFocusedView),
      opacity: edgeVisualOpacity(edge, isFocusedView),
      simulationWeight: edgeStrokeWidth(edge)
    }];
  });

  const communities = model.communities.map((community, index) => {
    const communityNodes = nodes.filter((node) => node.community === community.id);
    const allCommunityNodes = allFilteredNodes.filter((node) => node.community === community.id);
    return {
      id: community.id,
      label: community.label || community.id,
      color: getCommunityColor(theme, Number(community.color_index ?? index)),
      nodeCount: Number(community.node_count ?? allCommunityNodes.length),
      wash: computeCommunityWash(communityNodes)
    };
  });
  const communityById = new Map(communities.map((community) => [community.id, community]));

  return {
    model,
    layout,
    worldBounds,
    selectedNodeId,
    focus,
    typeFilters,
    densityMode: filteredDensityMode,
    counts: {
      visibleNodes: filteredVisibleCounts.visible_nodes,
      visibleEdges: filteredVisibleCounts.visible_edges,
      totalNodes: filteredVisibleCounts.total_nodes,
      totalEdges: filteredVisibleCounts.total_edges,
      totalCommunities: filteredVisibleCounts.total_communities
    },
    nodes,
    edges,
    communities,
    minimap: {
      path: MINIMAP_PATH,
      nodes: nodes.slice(0, 60).map((node) => {
        const point = worldPointToMinimapPoint(node.point, undefined, worldBounds);
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

export function edgeVisualStrokeWidth(edge: { weight?: number }, focusedView: boolean): number {
  if (focusedView) return edgeStrokeWidth(edge);
  return round(0.95 + clampWeight(edge.weight) * 0.75);
}

export function edgeVisualOpacity(edge: { weight?: number }, focusedView: boolean): number {
  if (focusedView) return edgeOpacity(edge);
  return round(0.2 + clampWeight(edge.weight) * 0.22);
}

export function edgeRelationClass(relationType: unknown): string {
  switch (normalizeEdgeRelationText(relationType)) {
    case "实现":
      return "relation-implementation";
    case "依赖":
      return "relation-dependency";
    case "衍生":
      return "relation-derivation";
    case "对比":
      return "relation-contrast";
    case "矛盾":
      return "relation-conflict";
    default:
      return "relation-dependency";
  }
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

function normalizeGraphFocus(
  focus: GraphFocusInput | undefined,
  model: { communityById: Record<string, AtlasCommunity> }
): GraphFocusInput {
  if (!focus || focus.kind !== "community") return null;
  const id = String(focus.id || "");
  return id && model.communityById[id] ? { kind: "community", id } : null;
}

function normalizeGraphTypeFilters(filters: GraphTypeFilters | undefined, nodes: AtlasNode[]): GraphTypeFilters {
  const normalized: GraphTypeFilters = {};
  for (const node of nodes) {
    normalized[node.type] = filters?.[node.type] !== false;
  }
  return normalized;
}

function applyNodeTypeFilters(nodes: AtlasNode[], filters: GraphTypeFilters): AtlasNode[] {
  return nodes.filter((node) => filters[node.type] !== false);
}

function normalizeEdgeConfidence(edge: AtlasEdge): string {
  const value = String(edge.confidence || edge.type || "EXTRACTED").toUpperCase();
  if (value === "INFERRED" || value === "AMBIGUOUS" || value === "UNVERIFIED") return value.toLowerCase();
  return "extracted";
}

function normalizeEdgeRelationType(edge: AtlasEdge): string {
  return normalizeEdgeRelationText(edge.relation_type || "依赖");
}

function normalizeEdgeRelationText(relationType: unknown): string {
  const value = String(relationType || "依赖").trim();
  return value || "依赖";
}

function pinKeyForNode(node: { source_path?: unknown; path?: unknown; source?: unknown; id: string }): WikiPath {
  return wikiPathForGraphNode(node);
}

function renderPointForNode(node: AtlasNode, options: Pick<BuildRenderableGraphOptions, "positions" | "pins">): RenderPosition {
  const position = options.positions?.[node.id];
  if (position) {
    return {
      x: finitePositionCoordinate(position.x),
      y: finitePositionCoordinate(position.y)
    };
  }
  const pin = options.pins?.[pinKeyForNode(node)];
  if (pin) {
    return pinPositionToWorldPoint(pin);
  }
  return atlasNodePoint(node) as RenderPosition;
}

function edgeCurveOffset(sourcePoint: RenderPosition, targetPoint: RenderPosition, edge: { weight?: number }, worldBounds: GraphWorldBounds = {
  minX: 0,
  minY: 0,
  maxX: GRAPH_WORLD_SIZE.width,
  maxY: GRAPH_WORLD_SIZE.height,
  width: GRAPH_WORLD_SIZE.width,
  height: GRAPH_WORLD_SIZE.height
}): number {
  const sourceYPercent = (sourcePoint.y - worldBounds.minY) / worldBounds.height * 100;
  const targetYPercent = (targetPoint.y - worldBounds.minY) / worldBounds.height * 100;
  return Math.max(-76, Math.min(76, (sourceYPercent - targetYPercent) * 1.8 + (clampWeight(edge.weight) - 0.5) * 24));
}

function finitePositionCoordinate(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveSelectedNodeIds(
  model: { byId: Record<string, AtlasNode>; nodes: AtlasNode[] },
  options: BuildRenderableGraphOptions
): string[] {
  if (options.selection?.kind === "node" && model.byId[options.selection.id]) return [options.selection.id];
  if (options.selection?.kind === "community") {
    const communityId = options.selection.id;
    return model.nodes.filter((node) => node.community === communityId).map((node) => node.id);
  }
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
