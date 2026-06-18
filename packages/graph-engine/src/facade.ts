import type {
  GraphNode,
  GraphDiff,
  GraphEngine,
  GraphEngineOptions,
  GraphData,
  GraphOpenPagePayload,
  GraphSummaryObjectRef,
  GraphSummaryOptions,
  Selection,
  SelectionInput,
  ThemeId
} from "./types";
import { createGraphRenderer } from "./render";
import { resolveSelectionForCapabilities } from "./select";
import { graphNodeTypeLabel, wikiPathForGraphNode } from "./graph-node";
import {
  summarizeExcludedGraphObject,
  summarizeGraphCommunity,
  summarizeGraphGlobal,
  summarizeGraphNode,
  summarizeGraphSearchResults,
  summarizeUnavailableGraphObject
} from "./summary";

export type GraphFacadeHostMode = "workbench" | "offline" | "standalone";

export interface GraphFacadeCapabilityContract {
  mode: GraphFacadeHostMode;
  capabilities: GraphEngineOptions["capabilities"];
}

export function createGraphWorkbenchCapabilities(
  capabilities: NonNullable<GraphEngineOptions["capabilities"]>
): GraphFacadeCapabilityContract {
  return {
    mode: "workbench",
    capabilities: {
      onOpenPage: capabilities.onOpenPage,
      onSelectionChange: capabilities.onSelectionChange,
      onSelectionClear: capabilities.onSelectionClear,
      onViewReset: capabilities.onViewReset,
      onAsk: capabilities.onAsk,
      persistPins: capabilities.persistPins,
      onDragStateChange: capabilities.onDragStateChange,
      onVisibilityStateChange: capabilities.onVisibilityStateChange
    }
  };
}

export function createGraphOfflineCapabilities(
  capabilities: Pick<NonNullable<GraphEngineOptions["capabilities"]>, "persistPins"> = {}
): GraphFacadeCapabilityContract {
  return {
    mode: "offline",
    capabilities: {
      persistPins: capabilities.persistPins
    }
  };
}

export function createGraphStandaloneCapabilities(): GraphFacadeCapabilityContract {
  return {
    mode: "standalone",
    capabilities: undefined
  };
}

export interface GraphFacadeRenderer {
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
  setData(data: GraphEngineOptions["data"], pins?: GraphEngineOptions["pins"]): void;
  focusNode(path: string): void;
  focusCommunity(id: string): void;
  setTypeFilters(filters: NonNullable<GraphEngineOptions["typeFilters"]>): void;
  showTemporaryObject(object: GraphSummaryObjectRef): void;
  clearTemporaryObjectDisplay(): void;
  resetView(): void;
  select(selection: SelectionInput): void;
  previewNode(id: string | null): void;
  clearSelection(): void;
  clearInteraction(): void;
  setNodeFixed(id: string, mode: "fix" | "unfix"): boolean;
  setTheme(theme: ThemeId): void;
  setPins(pins: NonNullable<GraphEngineOptions["pins"]>): void;
  resetLayout(): void;
  destroy(): void;
}

interface GraphFacadeContainer {
  dataset: Record<string, string | undefined>;
}

interface GraphFacadeState {
  data: GraphData;
  pins: NonNullable<GraphEngineOptions["pins"]>;
}

export function createGraphFacade(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  if (!container) {
    throw new Error("createGraphEngine requires a container element");
  }

  const capabilities = options.capabilities;
  const facadeState: GraphFacadeState = { data: options.data, pins: options.pins || {} };
  const renderer = createGraphRenderer(container, {
    data: options.data,
    pins: options.pins || {},
    theme: options.theme,
    toolbarContainer: options.toolbarContainer,
    focus: options.focus,
    typeFilters: options.typeFilters,
    onNodeOpen: capabilities?.onOpenPage
      ? (nodeId) => capabilities.onOpenPage?.(openPagePayloadForNode(facadeState.data, nodeId))
      : undefined,
    onSelectionInput: shouldResolveSelection(capabilities)
      ? (input) => {
          const selection = resolveSelectionForCapabilities(facadeState.data, input, {
            canAsk: Boolean(capabilities?.onAsk)
          });
          capabilities?.onSelectionChange?.(selection);
          if (!capabilities?.onSelectionChange) capabilities?.onAsk?.(selection);
        }
      : undefined,
    onPinsChanged: capabilities?.persistPins ? (pins) => void capabilities.persistPins?.(pins) : undefined,
    onSelectionClearRequested: capabilities?.onSelectionClear,
    onViewReset: () => {
      delete container.dataset.llmWikiGraphFocus;
      capabilities?.onViewReset?.();
    },
    onDragActiveChange: capabilities?.onDragStateChange,
    onVisibilityStateChange: capabilities?.onVisibilityStateChange
  });

  return createGraphFacadeFromRenderer(container, renderer, options, facadeState);
}

export function createGraphFacadeFromRenderer(
  container: GraphFacadeContainer,
  renderer: GraphFacadeRenderer,
  options: GraphEngineOptions,
  facadeState: GraphFacadeState = { data: options.data, pins: options.pins || {} }
): GraphEngine {
  let currentTheme: ThemeId = options.theme;
  let destroyed = false;
  const capabilities = options.capabilities;
  const canAsk = Boolean(options.capabilities?.onAsk);
  const resolveForHostCapabilities = (input: SelectionInput): Selection =>
    resolveSelectionForCapabilities(facadeState.data, input, { canAsk });

  container.dataset.llmWikiGraphEngine = "mounted";
  container.dataset.llmWikiGraphTheme = currentTheme;

  return {
    async applyDiff(diff: GraphDiff, animationOptions?: { reducedMotion?: boolean; durationMs?: number }): Promise<void> {
      assertActive();
      await renderer.applyDiff(diff, animationOptions);
    },

    isDragging(): boolean {
      assertActive();
      return renderer.isDragging();
    },

    setData(data, pins): void {
      assertActive();
      facadeState.data = data;
      if (pins) facadeState.pins = pins;
      renderer.setData(data, pins);
    },

    focusNode(path: string): void {
      assertActive();
      container.dataset.llmWikiGraphFocus = path;
      renderer.focusNode(path);
    },

    focusCommunity(id): Selection {
      assertActive();
      container.dataset.llmWikiGraphFocus = `community:${id}`;
      renderer.focusCommunity(id);
      return resolveForHostCapabilities({ kind: "community", id });
    },

    setTypeFilters(filters): void {
      assertActive();
      renderer.setTypeFilters(filters);
    },

    showTemporaryObject(object): void {
      assertActive();
      renderer.showTemporaryObject(object);
    },

    clearTemporaryObjectDisplay(): void {
      assertActive();
      renderer.clearTemporaryObjectDisplay();
    },

    resetView(): void {
      assertActive();
      delete container.dataset.llmWikiGraphFocus;
      renderer.resetView();
      capabilities?.onViewReset?.();
    },

    select(selector: SelectionInput): Selection {
      assertActive();
      renderer.select(selector);
      return resolveForHostCapabilities(selector);
    },

    previewNode(id): void {
      assertActive();
      renderer.previewNode(id);
    },

    summarizeNode(id, summaryOptions) {
      assertActive();
      return summarizeGraphNode(facadeState.data, id, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    summarizeCommunity(id, summaryOptions) {
      assertActive();
      return summarizeGraphCommunity(facadeState.data, id, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    summarizeGlobal(summaryOptions) {
      assertActive();
      return summarizeGraphGlobal(facadeState.data, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    summarizeSearchResults(query, resultIds, summaryOptions) {
      assertActive();
      return summarizeGraphSearchResults(facadeState.data, query, resultIds, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    summarizeExcludedObject(
      object: GraphSummaryObjectRef,
      reason: Parameters<GraphEngine["summarizeExcludedObject"]>[1],
      summaryOptions?: GraphSummaryOptions
    ) {
      assertActive();
      return summarizeExcludedGraphObject(facadeState.data, object, reason, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    summarizeUnavailableObject(
      object: GraphSummaryObjectRef,
      reason: Parameters<GraphEngine["summarizeUnavailableObject"]>[1],
      summaryOptions?: GraphSummaryOptions
    ) {
      assertActive();
      return summarizeUnavailableGraphObject(facadeState.data, object, reason, summaryOptionsWithPins(facadeState, summaryOptions));
    },

    clearSelection(): void {
      assertActive();
      renderer.clearSelection();
    },

    clearInteraction(): void {
      assertActive();
      renderer.clearInteraction();
      delete container.dataset.llmWikiGraphFocus;
    },

    setNodeFixed(id: string, mode: "fix" | "unfix"): boolean {
      assertActive();
      return renderer.setNodeFixed(id, mode);
    },

    setTheme(theme: ThemeId): void {
      assertActive();
      currentTheme = theme;
      container.dataset.llmWikiGraphTheme = currentTheme;
      renderer.setTheme(theme);
    },

    setPins(pins): void {
      assertActive();
      facadeState.pins = pins;
      renderer.setPins(pins);
    },

    resetLayout(): void {
      assertActive();
      renderer.resetLayout();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      renderer.destroy();
      delete container.dataset.llmWikiGraphEngine;
      delete container.dataset.llmWikiGraphTheme;
      delete container.dataset.llmWikiGraphFocus;
    }
  };

  function assertActive(): void {
    if (destroyed) {
      throw new Error("Graph engine has been destroyed");
    }
  }
}

function summaryOptionsWithPins(state: GraphFacadeState, options: GraphSummaryOptions = {}): GraphSummaryOptions {
  return {
    ...options,
    pins: options.pins ?? state.pins
  };
}

function shouldResolveSelection(capabilities: GraphEngineOptions["capabilities"]): boolean {
  return Boolean(capabilities?.onSelectionChange || capabilities?.onAsk);
}

function openPagePayloadForNode(data: GraphData, id: string): GraphOpenPagePayload {
  const node = data.nodes.find((item) => item.id === id);
  if (!node) {
    return {
      path: id,
      node: {
        id,
        title: id,
        type: "entity",
        typeLabel: "实体",
        sourcePath: id,
        community: null,
        date: null,
        source: null,
        isolated: true
      }
    };
  }
  const sourcePath = wikiPathForGraphNode(node);
  return {
    path: sourcePath,
    node: {
      id: node.id,
      title: node.label || node.id,
      type: node.type,
      typeLabel: graphNodeTypeLabel(node.type),
      sourcePath,
      community: node.community ?? null,
      date: dateForNode(node),
      source: sourceForNode(node),
      isolated: isIsolatedNode(data, node.id)
    }
  };
}

function isIsolatedNode(data: GraphData, id: string): boolean {
  return !data.edges.some((edge) => edge.from === id || edge.to === id);
}

function dateForNode(node: GraphNode): string | null {
  const value = node.date || node.updated_at || node.updatedAt || node.created_at || node.createdAt;
  return value == null || value === "" ? null : String(value);
}

function sourceForNode(node: GraphNode): string | null {
  const value = node.source_title || node.source_url || node.url || node.author || node.source_name;
  return value == null || value === "" ? null : String(value);
}
