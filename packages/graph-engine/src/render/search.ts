import { applySearchToNodeIds, buildSearchIndex } from "../model/legacy-helpers";
import type { GraphNode, NodeId } from "../types";

export type GraphSearchNodeState = "none" | "match" | "faded";

export interface GraphSearchNodeView {
  id: NodeId;
  searchState: GraphSearchNodeState;
}

export interface GraphSearchState {
  query: string;
  matchIds: NodeId[];
  nodes: GraphSearchNodeView[];
  searchIndex: Array<{ node: GraphNode; haystack: string }>;
}

export interface GraphSearchFocus {
  id: NodeId | null;
  index: number;
}

export function resolveGraphSearchState(
  nodes: GraphNode[],
  query: string,
  cachedIndex?: Array<{ node: GraphNode; haystack: string }>
): GraphSearchState {
  const searchIndex = cachedIndex ?? buildSearchIndex(nodes);
  const normalizedQuery = query.trim();
  const matchIds = applySearchToNodeIds(searchIndex, normalizedQuery);
  const matches = new Set(matchIds);
  return {
    query: normalizedQuery,
    matchIds,
    nodes: nodes.map((node) => ({
      id: node.id,
      searchState: normalizedQuery ? (matches.has(node.id) ? "match" : "faded") : "none"
    })),
    searchIndex
  };
}

export function resolveNextGraphSearchFocus(matchIds: NodeId[], currentId: NodeId | null | undefined): GraphSearchFocus {
  if (!matchIds.length) return { id: null, index: -1 };
  const currentIndex = currentId ? matchIds.indexOf(currentId) : -1;
  const nextIndex = (currentIndex + 1) % matchIds.length;
  return { id: matchIds[nextIndex], index: nextIndex };
}
