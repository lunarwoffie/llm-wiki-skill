export type NodeId = string;
export type EdgeId = string;
export type CommunityId = string;
export type WikiPath = string;

export type ThemeId = "shan-shui" | "mo-ye";

export type GraphNodeType =
  | "entity"
  | "topic"
  | "source"
  | "comparison"
  | "synthesis"
  | "query"
  | string;

export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS" | "UNVERIFIED" | string;

export interface GraphData {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  insights?: GraphInsights;
  learning?: GraphLearning;
}

export interface GraphMeta {
  build_date: string;
  wiki_title: string;
  total_nodes: number;
  total_edges: number;
  initial_view?: NodeId[];
  degraded?: boolean;
  insights_degraded?: boolean;
}

export interface GraphNode {
  id: NodeId;
  label: string;
  type: GraphNodeType;
  community?: CommunityId | null;
  content?: string;
  source_path?: string;
  source?: string;
  path?: string;
  summary?: string;
  confidence?: Confidence;
  type_confidence?: Confidence;
  weight?: number;
  score?: number;
  x?: number | string | null;
  y?: number | string | null;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  type: Confidence;
  weight?: number;
  source_signal_available?: boolean;
  signals?: GraphEdgeSignals;
  [key: string]: unknown;
}

export interface GraphEdgeSignals {
  co_citation?: number;
  source_overlap?: number | null;
  type_affinity?: number;
  [key: string]: number | boolean | string | null | undefined;
}

export interface GraphInsights {
  surprising_connections: SurprisingConnection[];
  isolated_nodes: IsolatedNodeInsight[];
  bridge_nodes: BridgeNodeInsight[];
  sparse_communities: SparseCommunityInsight[];
  meta: GraphInsightsMeta;
}

export interface GraphInsightsMeta {
  degraded: boolean;
  node_count: number;
  edge_count: number;
  max_insight_nodes: number;
  max_insight_edges: number;
}

export interface SurprisingConnection {
  from: NodeId;
  to: NodeId;
  weight: number;
  from_community: CommunityId | null;
  to_community: CommunityId | null;
}

export interface IsolatedNodeInsight {
  id: NodeId;
  label: string;
  degree: number;
  community: CommunityId | null;
}

export interface BridgeNodeInsight {
  id: NodeId;
  label: string;
  community: CommunityId | null;
  connected_communities: CommunityId[];
  community_count: number;
}

export interface SparseCommunityInsight {
  id: CommunityId;
  label: string;
  node_count: number;
  density: number;
  members: NodeId[];
  internal_edges: number;
}

export interface GraphLearning {
  version?: 1;
  entry: GraphLearningEntry;
  views: GraphLearningViews;
  communities: Community[];
  degraded?: {
    path_to_community: boolean;
    community_to_global: boolean;
  };
}

export interface GraphLearningEntry {
  recommended_start_node_id: NodeId | null;
  recommended_start_reason: string | null;
  default_mode: GraphLearningMode;
}

export type GraphLearningMode = "path" | "community" | "global";

export interface GraphLearningViews {
  path: GraphLearningPathView;
  community: GraphLearningCommunityView;
  global: GraphLearningGlobalView;
}

export interface GraphLearningPathView {
  enabled: boolean;
  start_node_id: NodeId | null;
  node_ids: NodeId[];
  degraded: boolean;
}

export interface GraphLearningCommunityView {
  enabled: boolean;
  community_id: CommunityId | null;
  label: string | null;
  node_ids: NodeId[];
  is_weak: boolean;
  degraded: boolean;
}

export interface GraphLearningGlobalView {
  enabled: boolean;
  node_ids: NodeId[];
  degraded: boolean;
}

export interface Community {
  id: CommunityId;
  label: string;
  node_count: number;
  source_count?: number;
  internal_edge_weight?: number;
  is_primary?: boolean;
  is_weak?: boolean;
  recommended_start_node_id?: NodeId | null;
  color_index?: number;
  members?: NodeId[];
}

export interface PinPosition {
  x: number;
  y: number;
}

export type PinMap = Record<WikiPath, PinPosition>;

export interface GraphLayoutFile {
  version: 1;
  pins: PinMap;
  updatedAt: string;
}

export interface GraphDiff {
  addedNodes: NodeId[];
  removedNodes: NodeId[];
  recoloredNodes: Array<{ id: NodeId; from: CommunityId; to: CommunityId }>;
  addedEdges: EdgeId[];
  removedEdges: EdgeId[];
  newCommunities: CommunityId[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
  };
}

export interface SelectionFacts {
  pageCount: number;
  internalLinkCount: number;
  communityCount: number;
  isolatedCount: number;
}

export type SelectionActionId =
  | "summarize_cluster"
  | "find_knowledge_gaps"
  | "create_topic_page"
  | "why_no_connection"
  | "find_potential_bridges"
  | "compare_communities"
  | "explore_potential_links"
  | "compare_differences"
  | "link_island";

export type SelectionActionTone = "digest" | "lint" | "write" | "bridge" | "compare" | "repair";

export interface SelectionAction {
  id: SelectionActionId;
  label: string;
  tone: SelectionActionTone;
}

export interface Selection {
  id: string;
  nodeIds: NodeId[];
  communityIds: CommunityId[];
  facts: SelectionFacts;
  actions?: SelectionAction[];
}

export type SelectionInput =
  | { kind: "node"; id: NodeId }
  | { kind: "community"; id: CommunityId }
  | { kind: "neighbors"; id: NodeId }
  | { kind: "nodes"; ids: NodeId[] };

export interface GraphEngineCapabilities {
  persistPins?: (pins: PinMap) => Promise<void>;
  onAsk?: (selection: Selection) => void;
  onOpenPage?: (path: WikiPath) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

export interface GraphEngineOptions {
  data: GraphData;
  pins?: PinMap;
  theme: ThemeId;
  capabilities?: GraphEngineCapabilities;
}

export interface GraphEngine {
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
  focusNode(path: WikiPath): void;
  select(selector: SelectionInput): Selection;
  setTheme(theme: ThemeId): void;
  resetLayout(): void;
  destroy(): void;
}
