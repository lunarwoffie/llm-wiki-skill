import type {
  CommunityId,
  GraphFocusInput,
  GraphTypeFilters,
  GraphData,
  GraphDiff,
  GraphNode,
  NodeId,
  PinMap,
  SelectionInput,
  ThemeId,
  WikiPath
} from "../types";
import { PinState } from "../sim";
import { resolveSelectionForCapabilities } from "../select";
import {
  buildRenderableGraph,
  createRenderPathCache,
  type RenderableGraph,
  type RenderableNode
} from "./model";
import {
  DEFAULT_RENDERER_VIEWPORT,
  createViewportFrameCommitter
} from "./viewport";
import { createGraphRuntimeState, type GraphRuntimeStateSnapshot } from "./state";
import { buildHoverPreview } from "./preview";
import { graphEdgeHoverAnchor, graphNodeHoverAnchor, resolveGraphHoverPreviewPosition } from "./overlays";
import { createEdgeHoverPreviewContent, createHoverPreviewContent } from "./hover-card";
import { renderOfflineReader, renderOfflineSelectionPanel } from "./offline-reader";
import { createGraphRootElement } from "./host-dom";
import { createGraphHitTargetResolver } from "./hit-testing";
import {
  GraphGestureStateMachine
} from "./gestures";
import { readToolbarPanelState } from "./toolbar";
import type { GraphRenderContext } from "./render-context";
import { createGraphController, type GraphController } from "./controller";
import {
  createGraphRenderPipeline,
  emptyPaintedDom,
  initialViewportSize,
  positionsFromRenderableGraph,
  readLegendCollapsed,
  type GraphRenderPipeline
} from "./render-pipeline";

// 聚焦单个社区时，子集包围盒常很小；用默认 4× fit 会把少量节点放大成糊屏巨卡。
// 聚焦 fit 限制到适度放大，让节点保持可读、社区居中留白（镜头推进而非贴脸）。
// 大社区包围盒大、fit 算出的 scale 本就 < 此上限，不受影响。
const FOCUS_FIT_MAX_SCALE = 1.5;

interface StaticRendererOptions {
  data: GraphData;
  pins?: PinMap;
  theme: ThemeId;
  onNodeOpen?: (nodeId: NodeId) => void;
  onSelectionInput?: (selection: SelectionInput) => void;
  onSelectionClearRequested?: () => void;
  onPinsChanged?: (pins: PinMap) => void;
  onDragActiveChange?: (dragging: boolean) => void;
  toolbarContainer?: HTMLElement | null;
  focus?: GraphFocusInput;
  typeFilters?: GraphTypeFilters;
  live?: boolean;
}

type RenderNextOptions = Partial<StaticRendererOptions> & {
  selectedNodeId?: string | null;
  selection?: SelectionInput | null;
};

export interface StaticGraphRenderer {
  root: HTMLElement;
  graph: RenderableGraph;
  render(next?: RenderNextOptions): void;
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
  setData(data: GraphData, pins?: PinMap): void;
  setTheme(theme: ThemeId): void;
  setPins(pins: PinMap): void;
  focusNode(pathOrId: WikiPath): void;
  focusCommunity(id: CommunityId): void;
  setTypeFilters(filters: GraphTypeFilters): void;
  resetView(): void;
  select(selection: SelectionInput): void;
  clearSelection(): void;
  clearInteraction(): void;
  resetLayout(): void;
  destroy(): void;
}

export function createStaticGraphRenderer(container: HTMLElement, options: StaticRendererOptions): StaticGraphRenderer {
  const initialPins = options.pins || {};
  const initialFocus = options.focus || null;
  const pathCache = createRenderPathCache();
  const root = createGraphRootElement(container);
  const toolbarContainer = options.toolbarContainer || root;
  const hasExternalToolbarContainer = toolbarContainer !== root;
  const ownerDocument = container.ownerDocument || document;
  let context: GraphRenderContext;
  let controller: GraphController;
  let pipeline: GraphRenderPipeline;
  const initialGraph = buildRenderableGraph(options.data, {
    pins: initialPins,
    theme: options.theme,
    selectedNodeId: null,
    selection: null,
    focus: initialFocus,
    typeFilters: options.typeFilters || {},
    pathCache
  });
  const runtimeState = createGraphRuntimeState({
    viewport: DEFAULT_RENDERER_VIEWPORT,
    positions: positionsFromRenderableGraph(initialGraph),
    pins: initialPins,
    selection: null,
    selectionSurface: null,
    focus: initialFocus
  });
  const hitTargetResolver = createGraphHitTargetResolver({
    graph: () => context.graph,
    viewport: () => context.runtimeState.snapshot().viewport,
    viewportSize: () => pipeline.viewportSize()
  });
  context = {
    data: options.data,
    theme: options.theme,
    destroyed: false,
    simulation: null,
    dom: emptyPaintedDom(),
    activeDiff: null,
    searchOpen: false,
    searchQuery: "",
    searchFocusedNodeId: null,
    typeFilters: options.typeFilters || {},
    availableTypeFilters: {},
    searchIndex: undefined,
    previewTimer: null,
    pathCache,
    root,
    toolbarContainer,
    hasExternalToolbarContainer,
    ownerDocument,
    legendCollapsed: readLegendCollapsed(ownerDocument),
    toolbarPanelState: readToolbarPanelState(ownerDocument.defaultView?.localStorage),
    viewportCommitter: createViewportFrameCommitter((next, commitOptions) => {
      pipeline.commitViewport(next, commitOptions);
    }, root.ownerDocument.defaultView || undefined),
    gestureMachine: new GraphGestureStateMachine({ dragThreshold: 4 }),
    gestureController: null,
    viewportAnimationTimer: null,
    lastEffectiveDensityMode: null,
    lastViewportSize: initialViewportSize(root),
    resizeObserver: null,
    graph: initialGraph,
    runtimeState,
    hitTargetResolver,
    pinState: new PinState(initialGraph, runtimeState.snapshot().pins),
    renderEpoch: 0,
    callbacks: {
      onNodeOpen: options.onNodeOpen,
      onSelectionInput: options.onSelectionInput,
      onSelectionClearRequested: options.onSelectionClearRequested,
      onPinsChanged: options.onPinsChanged,
      onDragActiveChange: options.onDragActiveChange
    }
  };
  controller = createGraphController(context, {
    render,
    viewportSize: () => pipeline.viewportSize(),
    setViewportAnimating: (enabled) => pipeline.setViewportAnimating(enabled),
    setGraphHover,
    applyMotionFrame: (positions) => pipeline.applyMotionFrame(positions),
    markPinnedNodes: (pinnedNodeIds) => pipeline.markPinnedNodes(pinnedNodeIds),
    focusFitMaxScale: FOCUS_FIT_MAX_SCALE
  });
  pipeline = createGraphRenderPipeline(context, {
    hasHostReader: Boolean(context.callbacks.onNodeOpen),
    live: options.live !== false,
    commands: {
      render,
      resetViewState: () => controller.resetViewState(),
      openSearch: () => controller.openSearch(),
      applySearchQuery: (query) => controller.applySearchQuery(query),
      focusNextSearchResult: () => controller.focusNextSearchResult(),
      closeSearch: () => controller.closeSearch(),
      selectCommunity: (id) => controller.selectCommunity(id),
      handleNodeClick: (id, additive) => controller.handleNodeClick(id, additive),
      handleNodeDoubleClick: (id) => controller.handleNodeDoubleClick(id),
      scheduleHoverPreview,
      showEdgeHoverPreview,
      clearHoverPreview
    },
    overlays: {
      renderReader,
      renderSelectionPanel,
      renderHoverPreview
    }
  });
  context.root.addEventListener("scroll", pipeline.resetRootScroll, { passive: true });
  context.ownerDocument.addEventListener("keydown", controller.handleDocumentKeydown);
  context.gestureController = controller.bindViewportHandlers();
  pipeline.bindResizeObserver();

  function render(next: RenderNextOptions = {}): void {
    assertActive();
    applyOptionChanges(next);
    pipeline.rebuildAndPaint();
  }

  function applyOptionChanges(next: RenderNextOptions): void {
    context.data = next.data || context.data;
    context.theme = next.theme || context.theme;
    if (Object.hasOwn(next, "typeFilters")) context.typeFilters = next.typeFilters || {};
    if (Object.hasOwn(next, "pins")) context.runtimeState.setPins(next.pins || {});
    if (Object.hasOwn(next, "focus")) context.runtimeState.setFocus(next.focus || null);
    if (Object.hasOwn(next, "selectedNodeId")) {
      const id = next.selectedNodeId || null;
      context.runtimeState.setSelection(id ? { kind: "node", id } : null, id ? "reader" : null);
    }
    if (Object.hasOwn(next, "selection")) {
      context.runtimeState.setSelection(next.selection || null, next.selection ? "selection-panel" : null);
    }
  }

  render();

  return {
    root: context.root,
    get graph() {
      return context.graph;
    },
    render,
    applyDiff(diff, animationOptions = {}): Promise<void> {
      assertActive();
      return pipeline.animateDiff(diff, animationOptions);
    },
    isDragging(): boolean {
      return context.runtimeState.snapshot().activeGesture?.kind === "node-drag";
    },
    setData(nextData: GraphData, nextPins?: PinMap): void {
      controller.clearTransientInteractionForDataRefresh();
      render({ data: nextData, pins: nextPins ?? context.runtimeState.snapshot().pins });
    },
    setTheme(nextTheme: ThemeId): void {
      render({ theme: nextTheme });
    },
    setPins(nextPins: PinMap): void {
      render({ pins: nextPins });
    },
    focusNode(pathOrId: WikiPath): void {
      const node = context.graph.nodes.find((item) => item.id === pathOrId || item.sourcePath === pathOrId);
      render({ selectedNodeId: node ? node.id : null });
      context.root.dataset.focus = pathOrId;
    },
    focusCommunity(id: CommunityId): void {
      controller.focusCommunity(id);
    },
    setTypeFilters(filters: GraphTypeFilters): void {
      render({ typeFilters: filters });
    },
    resetView(): void {
      controller.resetViewState();
    },
    select(nextSelection: SelectionInput): void {
      render({ selection: nextSelection });
    },
    clearSelection(): void {
      controller.retreatFocusedView();
    },
    clearInteraction(): void {
      controller.clearInteractionState();
    },
    resetLayout(): void {
      const nextState = context.pinState.reset();
      render({ pins: nextState.pins });
      context.callbacks.onPinsChanged?.(nextState.pins);
    },
    destroy(): void {
      if (context.destroyed) return;
      context.destroyed = true;
      pipeline.destroy();
      context.root.removeEventListener("scroll", pipeline.resetRootScroll);
      context.ownerDocument.removeEventListener("keydown", controller.handleDocumentKeydown);
      context.gestureController?.destroy();
      context.gestureController = null;
      if (context.previewTimer) clearTimeout(context.previewTimer);
      context.previewTimer = null;
      context.pathCache.clear();
      context.root.remove();
      if (context.hasExternalToolbarContainer && context.dom.toolbarElement && context.toolbarContainer.contains(context.dom.toolbarElement)) {
        context.toolbarContainer.replaceChildren();
      }
    }
  };

  function panelSelection(snapshot: GraphRuntimeStateSnapshot = context.runtimeState.snapshot()): SelectionInput | null {
    return snapshot.selectionSurface === "selection-panel" ? snapshot.selection : null;
  }

  function readerNodeId(snapshot: GraphRuntimeStateSnapshot = context.runtimeState.snapshot()): NodeId | null {
    return snapshot.selectionSurface === "reader" && snapshot.selection?.kind === "node" ? snapshot.selection.id : null;
  }

  function assertActive(): void {
    if (context.destroyed) throw new Error("Graph renderer has been destroyed");
  }

  function renderReader(): void {
    const reader = context.dom.readerElement;
    if (!reader) return;
    const selected = context.graph.selectedNodeId ? context.graph.nodes.find((node) => node.id === context.graph.selectedNodeId) : null;
    const rawNode = selected ? context.data.nodes.find((node) => node.id === selected.id) : null;
    renderOfflineReader(context.ownerDocument, reader, {
      selected: selected
        ? {
            id: selected.id,
            label: selected.label,
            type: selected.type,
            content: rawNode?.content ? String(rawNode.content) : undefined,
            summary: rawNode?.summary ? String(rawNode.summary) : undefined
          }
        : null,
      rawNode: rawNode || null,
      onClose: () => controller.clearInteractionState()
    });
  }

  function renderSelectionPanel(): void {
    const panel = context.dom.selectionElement;
    if (!panel) return;
    const selection = panelSelection();
    const resolved = selection ? resolveSelectionForCapabilities(context.data, selection, { canAsk: false }) : null;
    const selectedNodes = resolved
      ? resolved.nodeIds
      .map((id) => context.data.nodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => Boolean(node))
      : [];
    renderOfflineSelectionPanel(context.ownerDocument, panel, {
      selection,
      selectedNodes,
      facts: resolved?.facts || null,
      onClose: () => controller.clearInteractionState()
    });
  }

  function scheduleHoverPreview(id: NodeId): void {
    if (context.previewTimer) clearTimeout(context.previewTimer);
    context.previewTimer = setTimeout(() => {
      context.previewTimer = null;
      setGraphHover({ kind: "node", id });
      renderHoverPreview();
    }, 300);
  }

  function showEdgeHoverPreview(id: string): void {
    if (context.previewTimer) {
      clearTimeout(context.previewTimer);
      context.previewTimer = null;
    }
    setGraphHover({ kind: "edge", id });
    renderHoverPreview();
  }

  function clearHoverPreview(): void {
    if (context.previewTimer) {
      clearTimeout(context.previewTimer);
      context.previewTimer = null;
    }
    const hover = context.runtimeState.snapshot().hover;
    if (hover?.kind !== "node" && hover?.kind !== "edge") return;
    setGraphHover(null);
    renderHoverPreview();
  }

  function setGraphHover(hover: GraphRuntimeStateSnapshot["hover"]): GraphRuntimeStateSnapshot {
    return context.runtimeState.setHover(hover);
  }

  function renderHoverPreview(): void {
    const preview = context.dom.previewElement;
    if (!preview) return;
    const hover = context.runtimeState.snapshot().hover;
    const edge = hover?.kind === "edge" ? context.graph.edges.find((item) => item.id === hover.id) : null;
    const rawNode = hover?.kind === "node" ? context.data.nodes.find((node) => node.id === hover.id) : null;
    const renderedNode = hover?.kind === "node" ? context.graph.nodes.find((node) => node.id === hover.id) : null;
    preview.replaceChildren();
    preview.dataset.kind = edge ? "edge" : "node";
    if (edge) {
      preview.dataset.state = "open";
      preview.append(createEdgeHoverPreviewContent(context.ownerDocument, edge.relationType, edge.confidence));
      positionEdgeHoverPreview(preview, edge);
      return;
    }
    preview.dataset.state = rawNode && renderedNode ? "open" : "closed";
    if (!rawNode || !renderedNode) return;
    const content = buildHoverPreview(rawNode);
    preview.append(createHoverPreviewContent(context.ownerDocument, content));
    positionHoverPreview(preview, renderedNode);
  }

  function positionHoverPreview(preview: HTMLElement, node: RenderableNode): void {
    const previewRect = preview.getBoundingClientRect();
    const size = pipeline.viewportSize();
    const position = resolveGraphHoverPreviewPosition({
      anchorScreenPoint: graphNodeHoverAnchor(node, context.runtimeState.snapshot().viewport, size, context.graph.worldBounds),
      previewSize: { width: previewRect.width, height: previewRect.height },
      viewportSize: size,
      offset: { x: 18, y: -previewRect.height - 24 },
      margin: 12
    });
    preview.style.left = `${position.x}px`;
    preview.style.top = `${position.y}px`;
  }

  function positionEdgeHoverPreview(preview: HTMLElement, edge: RenderableGraph["edges"][number]): void {
    const previewRect = preview.getBoundingClientRect();
    const source = context.graph.nodes.find((node) => node.id === edge.source);
    const target = context.graph.nodes.find((node) => node.id === edge.target);
    const size = pipeline.viewportSize();
    const position = resolveGraphHoverPreviewPosition({
      anchorScreenPoint: graphEdgeHoverAnchor({ source, target }, context.runtimeState.snapshot().viewport, size, context.graph.worldBounds),
      previewSize: { width: previewRect.width, height: previewRect.height },
      viewportSize: size,
      offset: { x: 16, y: -previewRect.height - 16 },
      margin: 12
    });
    preview.style.left = `${position.x}px`;
    preview.style.top = `${position.y}px`;
  }
}
