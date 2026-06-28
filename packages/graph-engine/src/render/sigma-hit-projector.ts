import { createGraphSpatialIndex, type GraphSpatialIndex, type GraphSpatialIndexInput } from "../layout";
import type { GraphRendererAdapterData } from "./adapter";
import { screenPointToWorldPoint, type GraphScreenPoint } from "./geometry";
import { graphSpatialHitToGestureTarget, type GraphGestureTarget } from "./gestures";
import type { RendererViewport, RendererViewportSize } from "./viewport";

export type SigmaGlobalRenderedObject =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "community-wash"; id: string }
  | { kind: "aggregation-container"; id: string; communityId?: string | null };

export interface SigmaGlobalHitInput {
  nodeId?: string | null;
  screenPoint?: GraphScreenPoint | null;
  renderedObject?: SigmaGlobalRenderedObject | null;
}

export interface SigmaGlobalHitProjectorInput {
  adapterData: GraphRendererAdapterData;
  viewport: RendererViewport;
  viewportSize: RendererViewportSize;
  screenPointToWorldPoint?: (point: GraphScreenPoint) => { x: number; y: number };
}

export interface SigmaGlobalHitProjector {
  targetFromSigmaHit(input: SigmaGlobalHitInput): GraphGestureTarget;
  index(): GraphSpatialIndex;
}

export function createSigmaGlobalHitProjector(input: SigmaGlobalHitProjectorInput): SigmaGlobalHitProjector {
  const knownNodeIds = new Set(input.adapterData.nodes.map((node) => node.id));
  const spatialIndex = createGraphSpatialIndex(spatialInputFromAdapterData(input.adapterData));

  return {
    targetFromSigmaHit(hit) {
      if (hit.nodeId && knownNodeIds.has(hit.nodeId)) {
        return { kind: "node", id: hit.nodeId };
      }

      const renderedObjectTarget = hit.renderedObject ? gestureTargetFromSigmaRenderedObject(hit.renderedObject, input.adapterData) : null;
      if (renderedObjectTarget) return renderedObjectTarget;

      if (hit.screenPoint) {
        const worldPoint = input.screenPointToWorldPoint
          ? input.screenPointToWorldPoint(hit.screenPoint)
          : screenPointToWorldPoint(
              hit.screenPoint,
              input.viewport,
              input.viewportSize,
              input.adapterData.renderable.worldBounds
            );
        return graphSpatialHitToGestureTarget(spatialIndex.hitTest(worldPoint));
      }

      return { kind: "graph-blank" };
    },
    index() {
      return spatialIndex;
    }
  };
}

export function sigmaNodeIdFromPayload(payload: unknown): string | null {
  const candidate = payload as { node?: unknown } | null;
  return typeof candidate?.node === "string" ? candidate.node : null;
}

export function sigmaScreenPointFromPayload(payload: unknown): GraphScreenPoint | null {
  const candidate = payload as { event?: { x?: unknown; y?: unknown }; x?: unknown; y?: unknown } | null;
  const x = candidate?.event?.x ?? candidate?.x;
  const y = candidate?.event?.y ?? candidate?.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

export function spatialInputFromAdapterData(adapterData: GraphRendererAdapterData): GraphSpatialIndexInput {
  const renderableEdgeById = new Map(adapterData.renderable.edges.map((edge) => [edge.id, edge]));
  return {
    nodes: adapterData.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      point: node.point,
      displayMode: node.render.displayMode,
      visualRole: node.render.visualRole
    })),
    edges: adapterData.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      curveOffset: renderableEdgeById.get(edge.id)?.curveOffset ?? 0
    })),
    communities: adapterData.renderable.communities.map((community) => ({
      id: community.id,
      wash: community.wash
    })),
    aggregationContainers: adapterData.renderable.aggregationContainers.map((aggregation) => ({
      id: aggregation.id,
      communityId: aggregation.communityId,
      point: aggregation.point,
      radius: aggregation.radius
    }))
  };
}

export function gestureTargetFromSigmaRenderedObject(
  object: SigmaGlobalRenderedObject,
  adapterData: GraphRendererAdapterData
): GraphGestureTarget | null {
  switch (object.kind) {
    case "node":
      return adapterData.nodes.some((node) => node.id === object.id) ? { kind: "node", id: object.id } : null;
    case "edge":
      return adapterData.edges.some((edge) => edge.id === object.id) ? { kind: "edge", id: object.id } : null;
    case "community-wash":
      return adapterData.communities.some((community) => community.id === object.id) ? { kind: "community-wash", id: object.id } : null;
    case "aggregation-container": {
      const aggregation = adapterData.aggregations.find((item) => item.id === object.id);
      if (!aggregation) return null;
      return { kind: "aggregation-container", id: object.id, communityId: object.communityId ?? aggregation.communityId };
    }
    default:
      return null;
  }
}
