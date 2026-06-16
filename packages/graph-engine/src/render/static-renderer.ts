import type {
  CommunityId,
  GraphFocusInput,
  GraphTypeFilters,
  GraphData,
  GraphDiff,
  GraphNode,
  GraphOpenPagePayload,
  NodeId,
  PinMap,
  SelectionInput,
  ThemeId,
  WikiPath
} from "../types";
import { createLiveGraphSimulation, PinState, pinsToPositions, type LiveGraphSimulation } from "../sim";
import { resolveSelectionForCapabilities } from "../select";
import { getCommunityColor, getThemeTokens, themeTokensToCssVars } from "../themes";
import {
  buildRenderableGraph,
  createRenderPathCache,
  makeEdgePathFromPoints,
  nodeDisplayModeForDensity,
  screenEffectiveDensityMode,
  type DensityMode,
  type NodeDisplayMode,
  type RenderableGraph,
  type RenderableNode,
  type RenderPositionMap
} from "./model";
import { graphNodeTypeLabel, wikiPathForGraphNode } from "../graph-node";
import { buildCommunityLegend, type CommunityLegendRow } from "./legend";
import {
  DEFAULT_RENDERER_VIEWPORT,
  applyRendererViewportTransform,
  centerRendererViewportOnPoint,
  createViewportFrameCommitter,
  fitRendererViewportToPoints,
  panRendererViewport,
  rendererViewportToMinimapRect,
  viewportAfterResize,
  viewportAfterWheelZoom,
  type RendererViewport
} from "./viewport";
import { createGraphRuntimeState, type GraphRuntimeStateSnapshot } from "./state";
import { resolveGraphSearchState, resolveNextGraphSearchFocus } from "./search";
import { buildHoverPreview, type GraphHoverPreview } from "./preview";
import { GRAPH_WORLD_SIZE, rootClientPointToScreenPoint, worldDeltaToLayerDelta, type GraphWorldPoint } from "./geometry";
import { beginGraphNodeDrag, resolveGraphNodeDragTarget } from "./simulation-bridge";
import { cancelGraphNodeDrag, commitGraphNodeDrag, type GraphNodeDragSession } from "./node-drag-lifecycle";
import { graphEdgeHoverAnchor, graphNodeHoverAnchor, resolveGraphHoverPreviewPosition } from "./overlays";
import {
  GraphGestureController,
  GraphGestureStateMachine,
  type GraphGestureActiveState,
  type GraphGestureIntent,
  type GraphGestureTargetLike
} from "./gestures";
import {
  nextToolbarPanelState,
  readToolbarPanelState,
  shouldBlankClickCloseToolbar,
  toolbarPanelStateAfterBlankClick,
  writeToolbarPanelState,
  type GraphToolbarPanelState
} from "./toolbar";

// 聚焦单个社区时，子集包围盒常很小；用默认 4× fit 会把少量节点放大成糊屏巨卡。
// 聚焦 fit 限制到适度放大，让节点保持可读、社区居中留白（镜头推进而非贴脸）。
// 大社区包围盒大、fit 算出的 scale 本就 < 此上限，不受影响。
const FOCUS_FIT_MAX_SCALE = 1.5;

interface StaticRendererOptions {
  data: GraphData;
  pins?: PinMap;
  theme: ThemeId;
  onOpenPage?: (payload: GraphOpenPagePayload) => void;
  onSelectionChange?: (selection: SelectionInput) => void;
  onSelectionClear?: () => void;
  persistPins?: (pins: PinMap) => Promise<void>;
  onDragStateChange?: (dragging: boolean) => void;
  toolbarContainer?: HTMLElement | null;
  focus?: GraphFocusInput;
  typeFilters?: GraphTypeFilters;
  live?: boolean;
}

export interface StaticGraphRenderer {
  root: HTMLElement;
  graph: RenderableGraph;
  render(next?: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null }): void;
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
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

const SVG_NS = "http://www.w3.org/2000/svg";

interface PaintedGraphDom {
  contentLayer: HTMLElement | null;
  edgeElements: Map<string, SVGPathElement>;
  communityWashElements: Map<string, SVGEllipseElement>;
  nodeElements: Map<string, HTMLButtonElement>;
  miniNodeElements: Map<string, SVGCircleElement>;
  miniViewportElement: SVGRectElement | null;
  basePoints: Map<string, { x: number; y: number }>;
  readerElement: HTMLElement | null;
  selectionElement: HTMLElement | null;
  searchElement: HTMLElement | null;
  searchInput: HTMLInputElement | null;
  searchStatusElement: HTMLElement | null;
  toolbarElement: HTMLElement | null;
  toolbarPanelElement: HTMLElement | null;
  legendElement: HTMLElement | null;
  legendRows: Map<string, HTMLButtonElement>;
  previewElement: HTMLElement | null;
}

interface PendingNodeDragSession extends GraphNodeDragSession {
  grabOffset: GraphWorldPoint;
}

export function createStaticGraphRenderer(container: HTMLElement, options: StaticRendererOptions): StaticGraphRenderer {
  let data = options.data;
  let pins = options.pins || {};
  let theme = options.theme;
  let selectedNodeId: string | null = null;
  let selection: SelectionInput | null = null;
  let manualNodeIds: NodeId[] = [];
  let destroyed = false;
  let simulation: LiveGraphSimulation | null = null;
  let dom: PaintedGraphDom = emptyPaintedDom();
  let viewport: RendererViewport = DEFAULT_RENDERER_VIEWPORT;
  let activeDiff: GraphDiff | null = null;
  let searchOpen = false;
  let searchQuery = "";
  let searchFocusedNodeId: NodeId | null = null;
  let focus: GraphFocusInput = options.focus || null;
  let typeFilters: GraphTypeFilters = options.typeFilters || {};
  let availableTypeFilters: GraphTypeFilters = {};
  let searchIndex: ReturnType<typeof resolveGraphSearchState>["searchIndex"] | undefined;
  let hoveredCommunityId: string | null = null;
  let previewNodeId: NodeId | null = null;
  let previewEdgeId: string | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const pathCache = createRenderPathCache();
  const root = document.createElement("div");
  root.className = "llm-wiki-graph-engine";
  root.dataset.llmWikiGraphRoot = "true";
  root.tabIndex = 0;
  container.replaceChildren(root);
  const toolbarContainer = options.toolbarContainer || root;
  const hasExternalToolbarContainer = toolbarContainer !== root;
  ensureStaticRendererStyles(container.ownerDocument || document);
  const ownerDocument = container.ownerDocument || document;
  let legendCollapsed = readLegendCollapsed(ownerDocument);
  let toolbarPanelState: GraphToolbarPanelState = readToolbarPanelState(ownerDocument.defaultView?.localStorage);
  root.addEventListener("scroll", resetRootScroll, { passive: true });
  const handleDocumentKeydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "f" && isGraphFocusActive()) {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape" && (searchOpen || searchQuery || searchFocusedNodeId)) {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === "Escape" && shouldBlankClickCloseToolbar(toolbarPanelState)) {
      event.preventDefault();
      event.stopPropagation();
      closeToolbarPanel();
      return;
    }
    if (event.key === "Escape") {
      const intents = gestureMachine.escape();
      if (intents.length) {
        event.preventDefault();
        event.stopPropagation();
        applyGestureIntents(intents, null);
        syncRuntimeGestureState();
        return;
      }
    }
    if (event.key !== "Escape" || !hasInteractionState()) return;
    event.preventDefault();
    event.stopPropagation();
    if (focus) {
      resetViewState();
      return;
    }
    clearInteractionState();
  };
  ownerDocument.addEventListener("keydown", handleDocumentKeydown);
  const viewportCommitter = createViewportFrameCommitter(commitViewport, root.ownerDocument.defaultView || undefined);
  const gestureMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
  let gestureController: GraphGestureController | null = null;
  let pendingNodeDrag: PendingNodeDragSession | null = null;
  let viewportAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEffectiveDensityMode: DensityMode | null = null;
  let lastViewportSize = viewportSize();
  let resizeObserver: ResizeObserver | null = null;

  let graph = buildRenderableGraph(data, { pins, theme, selectedNodeId, selection, focus, typeFilters, pathCache });
  const runtimeState = createGraphRuntimeState({
    viewport,
    positions: positionsFromRenderableGraph(graph),
    pins,
    selection: rendererSelectionInput(),
    focus
  });
  let pinState = new PinState(graph, runtimeState.snapshot().pins);
  gestureController = bindViewportHandlers();
  bindResizeObserver();

  function render(next: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null } = {}): void {
    assertActive();
    data = next.data || data;
    pins = next.pins || pins;
    theme = next.theme || theme;
    if (Object.hasOwn(next, "focus")) focus = next.focus || null;
    if (Object.hasOwn(next, "typeFilters")) typeFilters = next.typeFilters || {};
    if (Object.hasOwn(next, "selectedNodeId")) selectedNodeId = next.selectedNodeId || null;
    if (Object.hasOwn(next, "selection")) selection = next.selection || null;
    const runtimeSnapshot = syncRuntimeInputState();
    const renderSelection = rendererSelectionFromRuntimeState(runtimeSnapshot);
    pins = runtimeSnapshot.pins;
    graph = buildRenderableGraph(data, {
      pins,
      theme,
      selectedNodeId: renderSelection.selectedNodeId,
      selection: renderSelection.selection,
      focus: runtimeSnapshot.focus,
      typeFilters,
      pathCache
    });
    runtimeState.setPositions(positionsFromRenderableGraph(graph));
    availableTypeFilters = graph.typeFilters;
    searchIndex = undefined;
    pinState = new PinState(graph, runtimeState.snapshot().pins);
    applyTheme(root, theme);
    dom = paint(root, graph, theme, Boolean(options.onOpenPage), {
      onNodeClick: (id, additive) => {
        handleNodeClick(id, additive);
      },
      onNodeDoubleClick: (id) => {
        if (!pinState.isPinned(id)) return false;
        const nextState = pinState.unpin(id);
        pins = nextState.pins;
        runtimeState.setPins(pins);
        simulation?.setFixed(id, null);
        markPinnedNodes(nextState.pinnedNodeIds);
        void options.persistPins?.(nextState.pins);
        return true;
      },
      onNodePreviewEnter: (id) => {
        scheduleHoverPreview(id);
      },
      onEdgePreviewEnter: (id) => {
        showEdgeHoverPreview(id);
      },
      onNodePreviewLeave: () => {
        clearHoverPreview();
      }
    });
    lastEffectiveDensityMode = null;
    mountSearchControl();
    mountGraphToolbar();
    applySearchQuery(searchQuery);
    applyCommunityHover();
    commitViewport(runtimeState.snapshot().viewport);
    if (activeDiff && root.dataset.diffState === "playing") markDiffElements(activeDiff);
    renderReader();
    renderSelectionPanel();
    renderHoverPreview();
    restartSimulation();
  }

  render();

  return {
    root,
    get graph() {
      return graph;
    },
    render,
    applyDiff(diff, animationOptions = {}): Promise<void> {
      assertActive();
      return animateDiff(diff, animationOptions);
    },
    isDragging(): boolean {
      return runtimeState.snapshot().activeGesture?.kind === "node-drag";
    },
    setTheme(nextTheme: ThemeId): void {
      render({ theme: nextTheme });
    },
    setPins(nextPins: PinMap): void {
      pins = nextPins;
      runtimeState.setPins(pins);
      render({ pins });
    },
    focusNode(pathOrId: WikiPath): void {
      const node = graph.nodes.find((item) => item.id === pathOrId || item.sourcePath === pathOrId);
      render({ selectedNodeId: node ? node.id : pathOrId });
      root.dataset.focus = pathOrId;
    },
    focusCommunity(id: CommunityId): void {
      focusCommunity(id);
    },
    setTypeFilters(filters: GraphTypeFilters): void {
      render({ typeFilters: filters });
    },
    resetView(): void {
      resetViewState();
    },
    select(nextSelection: SelectionInput): void {
      manualNodeIds = nextSelection.kind === "nodes" ? nextSelection.ids : [];
      render({ selection: nextSelection });
    },
    clearSelection(): void {
      retreatFocusedView();
    },
    clearInteraction(): void {
      clearInteractionState();
    },
    resetLayout(): void {
      const nextState = pinState.reset();
      pins = nextState.pins;
      runtimeState.setPins(pins);
      render({ pins });
      void options.persistPins?.(nextState.pins);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      simulation?.destroy();
      simulation = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      root.removeEventListener("scroll", resetRootScroll);
      ownerDocument.removeEventListener("keydown", handleDocumentKeydown);
      gestureController?.destroy();
      gestureController = null;
      if (previewTimer) clearTimeout(previewTimer);
      if (viewportAnimationTimer) clearTimeout(viewportAnimationTimer);
      pathCache.clear();
      root.remove();
      if (hasExternalToolbarContainer && dom.toolbarElement && toolbarContainer.contains(dom.toolbarElement)) {
        toolbarContainer.replaceChildren();
      }
    }
  };

  function syncRuntimeInputState(): GraphRuntimeStateSnapshot {
    runtimeState.setPins(pins);
    runtimeState.setSelection(rendererSelectionInput());
    runtimeState.setFocus(focus);
    return runtimeState.snapshot();
  }

  function rendererSelectionInput(): SelectionInput | null {
    if (selection) return selection;
    return selectedNodeId ? { kind: "node", id: selectedNodeId } : null;
  }

  function rendererSelectionFromRuntimeState(snapshot: GraphRuntimeStateSnapshot): { selectedNodeId: NodeId | null; selection: SelectionInput | null } {
    if (selection) return { selectedNodeId: null, selection: snapshot.selection };
    if (snapshot.selection?.kind === "node") return { selectedNodeId: snapshot.selection.id, selection: null };
    return { selectedNodeId: null, selection: snapshot.selection };
  }

  function syncHoverState(): GraphRuntimeStateSnapshot {
    if (previewNodeId) return runtimeState.setHover({ kind: "node", id: previewNodeId });
    if (previewEdgeId) return runtimeState.setHover({ kind: "edge", id: previewEdgeId });
    if (hoveredCommunityId) return runtimeState.setHover({ kind: "community", id: hoveredCommunityId });
    return runtimeState.setHover(null);
  }

  function assertActive(): void {
    if (destroyed) throw new Error("Graph renderer has been destroyed");
  }

  function clearInteractionState(): void {
    manualNodeIds = [];
    selection = null;
    selectedNodeId = null;
    focus = null;
    searchFocusedNodeId = null;
    hoveredCommunityId = null;
    previewNodeId = null;
    previewEdgeId = null;
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    runtimeState.clearInteraction();
    delete root.dataset.focus;
    options.onSelectionClear?.();
    render({ selectedNodeId: null, selection: null, focus: null });
  }

  function hasInteractionState(): boolean {
    return Boolean(selectedNodeId || selection || focus || root.dataset.focus);
  }

  function isGraphFocusActive(): boolean {
    const active = ownerDocument.activeElement;
    if (active === root || Boolean(active && root.contains(active))) return true;
    return !isTextEditingElement(active);
  }

  function openSearch(): void {
    searchOpen = true;
    root.dataset.searchOpen = "true";
    if (dom.searchElement) dom.searchElement.dataset.state = "open";
    if (dom.searchInput) {
      dom.searchInput.focus();
      dom.searchInput.select();
    }
  }

  function mountSearchControl(): void {
    const control = createSearchControl(ownerDocument, {
      open: searchOpen,
      query: searchQuery,
      onOpen: () => openSearch(),
      onQuery: (query) => applySearchQuery(query),
      onNext: () => focusNextSearchResult(),
      onClose: () => closeSearch()
    });
    dom.searchElement = control.element;
    dom.searchInput = control.input;
    dom.searchStatusElement = control.status;
    root.prepend(control.element);
    root.dataset.searchOpen = searchOpen ? "true" : "false";
  }

  function applySearchQuery(query: string): void {
    if (query !== searchQuery) searchFocusedNodeId = null;
    searchQuery = query;
    const state = resolveGraphSearchState(data.nodes, searchQuery, searchIndex);
    searchIndex = state.searchIndex;
    root.dataset.searchActive = state.query ? "true" : "false";
    root.dataset.searchQuery = state.query;
    if (!state.matchIds.includes(searchFocusedNodeId || "")) searchFocusedNodeId = null;
    for (const node of state.nodes) {
      const element = dom.nodeElements.get(node.id);
      if (!element) continue;
      element.dataset.searchState = node.searchState;
      element.dataset.searchFocus = node.id === searchFocusedNodeId ? "true" : "false";
    }
    if (dom.searchInput && dom.searchInput.value !== searchQuery) dom.searchInput.value = searchQuery;
    if (dom.searchStatusElement) {
      const focusedIndex = searchFocusedNodeId ? state.matchIds.indexOf(searchFocusedNodeId) : -1;
      dom.searchStatusElement.textContent = state.query
        ? focusedIndex >= 0
          ? `${focusedIndex + 1}/${state.matchIds.length}`
          : `${state.matchIds.length} 个结果`
        : "输入关键词";
    }
  }

  function focusNextSearchResult(): void {
    const state = resolveGraphSearchState(data.nodes, searchQuery, searchIndex);
    searchIndex = state.searchIndex;
    const next = resolveNextGraphSearchFocus(state.matchIds, searchFocusedNodeId);
    searchFocusedNodeId = next.id;
    if (!next.id) {
      applySearchQuery(searchQuery);
      return;
    }
    const node = graph.nodes.find((item) => item.id === next.id);
    if (node) {
      setViewportAnimating(true);
      viewportCommitter.schedule(centerRendererViewportOnPoint(node.point, runtimeState.snapshot().viewport, viewportSize()));
    }
    applySearchQuery(searchQuery);
  }

  function closeSearch(): void {
    searchOpen = false;
    searchFocusedNodeId = null;
    if (dom.searchElement) dom.searchElement.dataset.state = "closed";
    root.dataset.searchOpen = "false";
    applySearchQuery("");
    root.focus({ preventScroll: true });
  }

  function mountCommunityLegend(): void {
    const rows = buildCommunityLegend(graph.communities, graph.nodes);
    const legend = createCommunityLegend(ownerDocument, {
      rows,
      collapsed: legendCollapsed,
      onToggle: () => {
        legendCollapsed = !legendCollapsed;
        writeLegendCollapsed(ownerDocument, legendCollapsed);
        mountCommunityLegend();
      },
      onHover: (id) => {
        hoveredCommunityId = id;
        syncHoverState();
        applyCommunityHover();
      },
      onSelect: (id) => selectCommunity(id)
    });
    dom.legendElement = legend.element;
    dom.legendRows = legend.rows;
    root.dataset.legendCollapsed = legendCollapsed ? "true" : "false";
  }

  function mountGraphToolbar(): void {
    mountCommunityLegend();
    const toolbar = createGraphToolbar(ownerDocument, {
      panelState: toolbarPanelState,
      typeFilters: graph.typeFilters,
      onPanelToggle: (panel) => {
        toolbarPanelState = nextToolbarPanelState(toolbarPanelState, panel);
        writeToolbarPanelState(ownerDocument.defaultView?.localStorage, toolbarPanelState);
        render();
      },
      onTypeFilterToggle: (type, enabled) => {
        render({ typeFilters: { ...availableTypeFilters, [type]: enabled } });
      },
      onReset: () => {
        resetViewState();
      }
    });
    if (dom.legendElement) toolbar.filtersPanel.appendChild(dom.legendElement);
    dom.toolbarElement = toolbar.element;
    dom.toolbarPanelElement = toolbar.panel;
    if (hasExternalToolbarContainer) {
      toolbarContainer.replaceChildren(toolbar.element);
    } else {
      root.prepend(toolbar.element);
    }
    root.dataset.toolbarPanel = toolbarPanelState;
    root.dataset.toolbarOpen = toolbarPanelState === "closed" ? "false" : "true";
    toolbarContainer.dataset.toolbarPanel = toolbarPanelState;
    toolbarContainer.dataset.toolbarOpen = toolbarPanelState === "closed" ? "false" : "true";
  }

  function closeToolbarPanel(): void {
    toolbarPanelState = toolbarPanelStateAfterBlankClick(toolbarPanelState);
    writeToolbarPanelState(ownerDocument.defaultView?.localStorage, toolbarPanelState);
    if (dom.toolbarPanelElement) dom.toolbarPanelElement.dataset.state = toolbarPanelState;
    if (dom.toolbarElement) dom.toolbarElement.dataset.panel = toolbarPanelState;
    root.dataset.toolbarPanel = toolbarPanelState;
    root.dataset.toolbarOpen = "false";
    toolbarContainer.dataset.toolbarPanel = toolbarPanelState;
    toolbarContainer.dataset.toolbarOpen = "false";
  }

  function selectCommunity(id: string): void {
    manualNodeIds = [];
    const nextSelection: SelectionInput = { kind: "community", id };
    selection = nextSelection;
    selectedNodeId = null;
    runtimeState.setSelection(nextSelection);
    options.onSelectionChange?.(nextSelection);
    focusCommunity(id);
  }

  function focusCommunity(id: string): void {
    render({ focus: { kind: "community", id }, selection });
    const points = graph.nodes.map((node) => node.point);
    if (!points.length) return;
    setViewportAnimating(true);
    viewportCommitter.schedule(fitRendererViewportToPoints(points, viewportSize(), { maxScale: FOCUS_FIT_MAX_SCALE }));
  }

  function resetViewState(): void {
    manualNodeIds = [];
    selection = null;
    selectedNodeId = null;
    focus = null;
    searchFocusedNodeId = null;
    hoveredCommunityId = null;
    previewNodeId = null;
    previewEdgeId = null;
    runtimeState.clearInteraction();
    delete root.dataset.focus;
    options.onSelectionClear?.();
    render({ selectedNodeId: null, selection: null, focus: null });
    setViewportAnimating(true);
    viewportCommitter.schedule(fitRendererViewportToPoints(graph.nodes.map((node) => node.point), viewportSize()));
  }

  function retreatFocusedView(): void {
    manualNodeIds = [];
    selection = null;
    selectedNodeId = null;
    searchFocusedNodeId = null;
    hoveredCommunityId = null;
    previewNodeId = null;
    previewEdgeId = null;
    syncRuntimeInputState();
    syncHoverState();
    delete root.dataset.focus;
    options.onSelectionClear?.();
    render({ selectedNodeId: null, selection: null, focus });
  }

  function applyCommunityHover(): void {
    const hover = runtimeState.snapshot().hover;
    const active = hover?.kind === "community" ? hover.id : null;
    hoveredCommunityId = active;
    root.dataset.legendHover = active || "";
    for (const [id, row] of dom.legendRows) {
      row.dataset.communityState = active ? (id === active ? "active" : "faded") : "none";
    }
    const nodeCommunity = new Map<string, string>();
    for (const [id, element] of dom.nodeElements) {
      const community = element.dataset.community || "";
      nodeCommunity.set(id, community);
      element.dataset.communityState = active ? (community === active ? "active" : "faded") : "none";
    }
    for (const [id, element] of dom.communityWashElements) {
      element.dataset.communityState = active ? (id === active ? "active" : "faded") : "none";
    }
    for (const edge of graph.edges) {
      const element = dom.edgeElements.get(edge.id);
      if (!element) continue;
      const inCommunity = nodeCommunity.get(edge.source) === active && nodeCommunity.get(edge.target) === active;
      element.dataset.communityState = active ? (inCommunity ? "active" : "faded") : "none";
    }
  }

  function restartSimulation(): void {
    simulation?.destroy();
    simulation = null;
    if (options.live === false || !graph.nodes.length) return;
    simulation = createLiveGraphSimulation(graph, {
      onTick: (snapshot) => applyMotionFrame(snapshot.positions)
    });
    for (const [id, position] of Object.entries(pinsToPositions(graph, runtimeState.snapshot().pins))) {
      simulation.setFixed(id, position);
    }
    simulation.startCold();
    markPinnedNodes(pinState.snapshot().pinnedNodeIds);
  }

  function applyMotionFrame(positions: RenderPositionMap): void {
    if (destroyed) return;
    const snapshot = runtimeState.setPositions(positions);
    const renderSelection = rendererSelectionFromRuntimeState(snapshot);
    graph = buildRenderableGraph(data, {
      pins: snapshot.pins,
      theme,
      selectedNodeId: renderSelection.selectedNodeId,
      selection: renderSelection.selection,
      focus: snapshot.focus,
      typeFilters,
      positions: snapshot.positions,
      pathCache
    });
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const size = viewportSize();
    for (const node of graph.nodes) {
      const element = dom.nodeElements.get(node.id);
      const base = dom.basePoints.get(node.id);
      if (!element || !base) continue;
      const dx = node.point.x - base.x;
      const dy = node.point.y - base.y;
      const layerDelta = worldDeltaToLayerDelta({ x: dx, y: dy }, size);
      element.style.translate = `calc(-50% + ${round(layerDelta.x)}px) calc(-50% + ${round(layerDelta.y)}px)`;
      element.dataset.liveX = String(round(node.point.x));
      element.dataset.liveY = String(round(node.point.y));
    }
    for (const edge of graph.edges) {
      const element = dom.edgeElements.get(edge.id);
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!element || !source || !target) continue;
      element.setAttribute("d", makeEdgePathFromPoints(source.point, target.point, edge.curveOffset));
    }
    for (const community of graph.communities) {
      const element = dom.communityWashElements.get(community.id);
      if (!element || !community.wash) continue;
      element.setAttribute("cx", String(community.wash.cx));
      element.setAttribute("cy", String(community.wash.cy));
      element.setAttribute("rx", String(community.wash.rx));
      element.setAttribute("ry", String(community.wash.ry));
      element.setAttribute("opacity", String(community.wash.opacity));
    }
    for (const miniNode of graph.minimap.nodes) {
      const element = dom.miniNodeElements.get(miniNode.id);
      if (!element) continue;
      element.setAttribute("cx", String(miniNode.x));
      element.setAttribute("cy", String(miniNode.y));
    }
    renderMotionOverlays();
  }

  function markPinnedNodes(pinnedNodeIds: string[]): void {
    const pinned = new Set(pinnedNodeIds);
    root.dataset.pinnedCount = String(pinned.size);
    for (const [id, element] of dom.nodeElements) {
      element.classList.toggle("is-pinned", pinned.has(id));
      element.dataset.pinned = pinned.has(id) ? "true" : "false";
    }
  }

  function bindViewportHandlers(): GraphGestureController {
    return new GraphGestureController(root, {
      stateMachine: gestureMachine,
      targetFromEventTarget: graphGestureTarget,
      pointerEventFromPointerEvent: graphPointerEvent,
      onWheelZoom: (event) => {
        event.preventDefault();
        setViewportAnimating(false);
        const screenPoint = graphScreenPointFromPointerEvent(event);
        viewportCommitter.schedule(viewportAfterWheelZoom(
          runtimeState.snapshot().viewport,
          { deltaY: event.deltaY, deltaMode: event.deltaMode },
          screenPoint,
          viewportSize()
        ));
      },
      onPointerDown: (event, decision) => {
        pendingNodeDrag = decision.intent === "node-drag-candidate" && decision.target.id
          ? pendingNodeDragFromPointerDown(decision.target.id, event)
          : null;
        if (decision.intent !== "node-drag-candidate") root.focus({ preventScroll: true });
        setViewportAnimating(false);
      },
      onGestureIntents: applyGestureIntents,
      onActiveStateChange: syncRuntimeGestureState,
      onBlankDoubleClick: (event) => {
        event.preventDefault();
        resetViewState();
      }
    });
  }

  function applyGestureIntents(intents: GraphGestureIntent[], event: PointerEvent | null): void {
    for (const intent of intents) {
      switch (intent.kind) {
        case "node-click":
          if (intent.nodeId) dom.nodeElements.get(intent.nodeId)?.focus({ preventScroll: true });
          if (intent.nodeId) handleNodeClick(intent.nodeId, intent.additive);
          break;
        case "node-drag-start":
          if (intent.nodeId && event) handleNodeDragStart(intent.nodeId, event);
          break;
        case "node-drag-move":
          if (intent.nodeId && event) handleNodeDragMove(intent.nodeId, event);
          break;
        case "node-drag-end":
          if (intent.nodeId && event) handleNodeDragEnd(intent.nodeId, event);
          break;
        case "node-drag-cancel":
          if (intent.nodeId) handleNodeDragCancel(intent.nodeId, intent.pointerId);
          break;
        case "community-click":
          if (intent.communityId) selectCommunity(intent.communityId);
          break;
        case "community-click-cancelled":
          break;
        case "blank-click":
          handleBlankClick();
          break;
        case "blank-pan-start":
          root.dataset.viewportDragging = "true";
          break;
        case "blank-pan-move":
          root.dataset.viewportDragging = "true";
          viewportCommitter.schedule(panRendererViewport(runtimeState.snapshot().viewport, intent.delta, viewportSize()));
          break;
        case "blank-pan-end":
        case "blank-pan-cancel":
          delete root.dataset.viewportDragging;
          break;
      }
    }
  }

  function handleNodeClick(id: NodeId, additive: boolean): void {
    if (!additive) {
      manualNodeIds = [];
      selection = null;
      selectedNodeId = id;
      options.onOpenPage?.(openPagePayloadForNode(data, id));
      render({ selectedNodeId: id, selection: null });
      return;
    }
    const nextSelection = shiftSelection(id, manualNodeIds.length ? manualNodeIds : selectedNodeIds(selection));
    manualNodeIds = nextSelection.kind === "nodes" ? nextSelection.ids : nextSelection.kind === "node" ? [nextSelection.id] : [];
    selection = nextSelection;
    selectedNodeId = null;
    options.onSelectionChange?.(nextSelection);
    render({ selection: nextSelection });
  }

  function handleNodeDragStart(id: NodeId, event: PointerEvent): void {
    if (!simulation) {
      pendingNodeDrag = null;
      return;
    }
    const grabOffset = nodeDragGrabOffset(id, event.pointerId);
    dom.nodeElements.get(id)?.classList.add("is-dragging");
    runtimeState.setActiveGesture({
      kind: "node-drag",
      pointerId: event.pointerId,
      nodeId: id,
      grabOffset,
      locked: true
    });
    simulation.beginDrag(id);
    simulation.dragTo(id, nodeDragTargetFromPointer(event, grabOffset));
    root.dataset.dragging = id;
    options.onDragStateChange?.(true);
  }

  function handleNodeDragMove(id: NodeId, event: PointerEvent): void {
    if (!simulation || root.dataset.dragging !== id) return;
    simulation.dragTo(id, nodeDragTargetFromPointer(event, nodeDragGrabOffset(id, event.pointerId)));
  }

  function handleNodeDragEnd(id: NodeId, _event: PointerEvent): void {
    if (!simulation || root.dataset.dragging !== id) return;
    const result = commitGraphNodeDrag({ nodeId: id, simulation, pinState });
    pins = result.pins;
    runtimeState.setPins(pins);
    applyMotionFrame(result.positions);
    markPinnedNodes(result.pinnedNodeIds);
    void options.persistPins?.(result.pins);
    dom.nodeElements.get(id)?.classList.remove("is-dragging");
    pendingNodeDrag = null;
    delete root.dataset.dragging;
    runtimeState.setActiveGesture(null);
    options.onDragStateChange?.(false);
  }

  function handleNodeDragCancel(id: NodeId, pointerId: number): void {
    if (!simulation || root.dataset.dragging !== id) return;
    const session = nodeDragSession(id, pointerId);
    const result = cancelGraphNodeDrag({ session, simulation, pinState });
    pins = result.pins;
    runtimeState.setPins(pins);
    applyMotionFrame(result.positions);
    markPinnedNodes(result.pinnedNodeIds);
    dom.nodeElements.get(id)?.classList.remove("is-dragging");
    pendingNodeDrag = null;
    delete root.dataset.dragging;
    runtimeState.setActiveGesture(null);
    options.onDragStateChange?.(false);
  }

  function handleBlankClick(): void {
    delete root.dataset.viewportDragging;
    // 真·单击空白（按下到抬起没拖动）：关弹层 → 退一层（聚焦态），与拖动平移互不冲突
    if (shouldBlankClickCloseToolbar(toolbarPanelState)) {
      closeToolbarPanel();
      return;
    }
    if (focus) retreatFocusedView();
  }

  function syncRuntimeGestureState(): void {
    const active = gestureMachine.snapshot();
    if (!active || active.kind !== "node") pendingNodeDrag = null;
    if (active?.kind === "node" && pendingNodeDrag && (active.pointerId !== pendingNodeDrag.pointerId || active.nodeId !== pendingNodeDrag.nodeId)) pendingNodeDrag = null;
    runtimeState.setActiveGesture(runtimeGestureFromActiveGesture(active));
  }

  function runtimeGestureFromActiveGesture(active: GraphGestureActiveState): GraphRuntimeStateSnapshot["activeGesture"] {
    if (!active) return null;
    if (active.kind === "node") {
      return active.nodeId
        ? {
            kind: "node-drag",
            pointerId: active.pointerId,
            nodeId: active.nodeId,
            grabOffset: nodeDragGrabOffset(active.nodeId, active.pointerId),
            locked: active.locked
          }
        : null;
    }
    if (active.kind === "community-wash") {
      return active.communityId
        ? {
            kind: "community-click",
            pointerId: active.pointerId,
            communityId: active.communityId,
            locked: active.locked
          }
        : null;
    }
    return {
      kind: "viewport-pan",
      pointerId: active.pointerId,
      lastScreenPoint: active.lastScreenPoint,
      locked: active.locked
    };
  }

  function graphPointerEvent(event: PointerEvent) {
    return {
      pointerId: event.pointerId,
      screenPoint: graphScreenPointFromPointerEvent(event),
      shiftKey: event.shiftKey
    };
  }

  function graphScreenPointFromPointerEvent(event: MouseEvent): { x: number; y: number } {
    return rootClientPointToScreenPoint(
      { x: event.clientX, y: event.clientY },
      root.getBoundingClientRect()
    );
  }

  function graphGestureTarget(target: EventTarget | null): GraphGestureTargetLike | null {
    return target instanceof Element ? target as Element & GraphGestureTargetLike : null;
  }

  function pendingNodeDragFromPointerDown(nodeId: NodeId, event: PointerEvent): PendingNodeDragSession | null {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    const drag = beginGraphNodeDrag({
      nodeWorldPoint: node.point,
      pointerScreenPoint: graphScreenPointFromPointerEvent(event),
      viewport: runtimeState.snapshot().viewport,
      viewportSize: viewportSize()
    });
    const pinnedStartPoint = pinsToPositions(graph, runtimeState.snapshot().pins)[nodeId];
    return {
      pointerId: event.pointerId,
      nodeId,
      startWorldPoint: pinnedStartPoint || drag.targetWorldPoint,
      wasPinned: Boolean(pinnedStartPoint) || pinState.isPinned(nodeId),
      grabOffset: drag.grabOffset
    };
  }

  function nodeDragSession(nodeId: NodeId, pointerId: number): GraphNodeDragSession {
    if (pendingNodeDrag?.nodeId === nodeId && pendingNodeDrag.pointerId === pointerId) {
      return pendingNodeDrag;
    }
    const node = graph.nodes.find((item) => item.id === nodeId);
    return {
      pointerId,
      nodeId,
      startWorldPoint: node?.point || { x: 0, y: 0 },
      wasPinned: pinState.isPinned(nodeId)
    };
  }

  function nodeDragGrabOffset(nodeId: NodeId, pointerId: number): GraphWorldPoint {
    const active = runtimeState.snapshot().activeGesture;
    if (active?.kind === "node-drag" && active.nodeId === nodeId && active.pointerId === pointerId) {
      return active.grabOffset;
    }
    if (pendingNodeDrag?.nodeId === nodeId && pendingNodeDrag.pointerId === pointerId) {
      return pendingNodeDrag.grabOffset;
    }
    return { x: 0, y: 0 };
  }

  function nodeDragTargetFromPointer(event: PointerEvent, grabOffset: GraphWorldPoint): GraphWorldPoint {
    return resolveGraphNodeDragTarget({
      pointerScreenPoint: graphScreenPointFromPointerEvent(event),
      viewport: runtimeState.snapshot().viewport,
      viewportSize: viewportSize(),
      grabOffset
    });
  }

  function bindResizeObserver(): void {
    const ViewResizeObserver = root.ownerDocument.defaultView?.ResizeObserver;
    if (!ViewResizeObserver) return;
    lastViewportSize = viewportSize();
    resizeObserver = new ViewResizeObserver(() => {
      const previous = lastViewportSize;
      const next = viewportSize();
      if (Math.abs(previous.width - next.width) < 1 && Math.abs(previous.height - next.height) < 1) return;
      lastViewportSize = next;
      const anchorPoint = selectedNodeId
        ? graph.nodes.find((node) => node.id === selectedNodeId)?.point ?? null
        : null;
      setViewportAnimating(false);
      commitViewport(viewportAfterResize(runtimeState.snapshot().viewport, previous, next, { anchorPoint }));
    });
    resizeObserver.observe(root);
  }

  function commitViewport(nextViewport: RendererViewport): void {
    resetRootScroll();
    const snapshot = runtimeState.setViewport(nextViewport);
    viewport = snapshot.viewport;
    root.dataset.viewportScale = String(round(viewport.scale));
    if (dom.contentLayer) applyRendererViewportTransform(dom.contentLayer, viewport);
    updateEffectiveDensity();
    updateMinimapViewport();
    renderMotionOverlays();
  }

  function updateEffectiveDensity(): void {
    const densityMode = screenEffectiveDensityMode(graph.counts.visibleNodes, runtimeState.snapshot().viewport.scale);
    root.dataset.density = densityMode;
    root.dataset.effectiveDensity = densityMode;
    if (densityMode === lastEffectiveDensityMode) return;
    lastEffectiveDensityMode = densityMode;
    for (const node of graph.nodes) {
      const element = dom.nodeElements.get(node.id);
      if (!element) continue;
      applyNodeDisplayMode(element, nodeDisplayModeForDensity(node, densityMode));
    }
  }

  function renderMotionOverlays(): void {
    if (dom.readerElement?.dataset.state === "open") renderReader();
    if (dom.selectionElement?.dataset.state === "open") renderSelectionPanel();
    if (previewNodeId || previewEdgeId || dom.previewElement?.dataset.state === "open") renderHoverPreview();
  }

  function updateMinimapViewport(): void {
    if (!dom.miniViewportElement) return;
    const rect = rendererViewportToMinimapRect(runtimeState.snapshot().viewport, viewportSize());
    dom.miniViewportElement.setAttribute("x", String(round(rect.x)));
    dom.miniViewportElement.setAttribute("y", String(round(rect.y)));
    dom.miniViewportElement.setAttribute("width", String(round(rect.width)));
    dom.miniViewportElement.setAttribute("height", String(round(rect.height)));
  }

  function setViewportAnimating(enabled: boolean): void {
    if (viewportAnimationTimer) {
      clearTimeout(viewportAnimationTimer);
      viewportAnimationTimer = null;
    }
    root.dataset.viewportAnimating = enabled ? "true" : "false";
    dom.contentLayer?.classList.toggle("is-viewport-animating", enabled);
    if (enabled) {
      viewportAnimationTimer = setTimeout(() => setViewportAnimating(false), 240);
    }
  }

  function viewportSize(): { width: number; height: number } {
    const rect = root.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width || GRAPH_WORLD_SIZE.width),
      height: Math.max(1, rect.height || GRAPH_WORLD_SIZE.height)
    };
  }

  function resetRootScroll(): void {
    if (root.scrollLeft !== 0) root.scrollLeft = 0;
    if (root.scrollTop !== 0) root.scrollTop = 0;
  }

  async function animateDiff(diff: GraphDiff, animationOptions: { reducedMotion?: boolean; durationMs?: number }): Promise<void> {
    if (destroyed) return;
    const reducedMotion = animationOptions.reducedMotion ?? prefersReducedMotion(root.ownerDocument || document);
    activeDiff = diff;
    root.dataset.diffState = reducedMotion ? "settled" : "playing";
    root.dataset.diffAddedNodes = String(diff.addedNodes.length);
    root.dataset.diffAddedEdges = String(diff.addedEdges.length);
    root.dataset.diffRemovedNodes = String(diff.removedNodes.length);
    root.dataset.diffNewCommunities = String(diff.newCommunities.length);
    markDiffElements(diff);
    if (reducedMotion) {
      root.dataset.diffReducedMotion = "true";
      settleDiffElements();
      return;
    }
    delete root.dataset.diffReducedMotion;
    const durationMs = clamp(animationOptions.durationMs ?? animationDurationMs(diff), 420, 3000);
    await wait(durationMs);
    if (!destroyed) settleDiffElements();
  }

  function markDiffElements(diff: GraphDiff): void {
    const addedNodes = new Set(diff.addedNodes);
    const removedNodes = new Set(diff.removedNodes);
    const recoloredNodes = new Set(diff.recoloredNodes.map((item) => item.id));
    const addedEdges = new Set(diff.addedEdges);
    const removedEdges = new Set(diff.removedEdges);
    const newCommunities = new Set(diff.newCommunities);
    for (const [id, element] of dom.nodeElements) {
      element.classList.toggle("is-diff-added", addedNodes.has(id));
      element.classList.toggle("is-diff-removed", removedNodes.has(id));
      element.classList.toggle("is-diff-recolored", recoloredNodes.has(id));
      const delay = diff.addedNodes.indexOf(id);
      element.style.setProperty("--diff-delay", delay >= 0 ? `${Math.min(delay * 55, 550)}ms` : "0ms");
      const anchor = addedNodes.has(id) ? semanticAnchorForNode(id) : null;
      if (anchor) {
        element.style.setProperty("--diff-anchor-dx", `${round(anchor.x - (graph.nodes.find((node) => node.id === id)?.point.x ?? anchor.x))}px`);
        element.style.setProperty("--diff-anchor-dy", `${round(anchor.y - (graph.nodes.find((node) => node.id === id)?.point.y ?? anchor.y))}px`);
      } else {
        element.style.removeProperty("--diff-anchor-dx");
        element.style.removeProperty("--diff-anchor-dy");
      }
    }
    for (const [id, element] of dom.edgeElements) {
      element.classList.toggle("is-diff-added", addedEdges.has(id));
      element.classList.toggle("is-diff-removed", removedEdges.has(id));
      if (addedEdges.has(id)) {
        const length = Math.max(1, Math.ceil(typeof element.getTotalLength === "function" ? element.getTotalLength() : 180));
        element.style.setProperty("--diff-edge-length", String(length));
      } else {
        element.style.removeProperty("--diff-edge-length");
      }
    }
    for (const [id, element] of dom.communityWashElements) {
      element.classList.toggle("is-diff-new-community", newCommunities.has(id));
    }
  }

  function settleDiffElements(): void {
    activeDiff = null;
    root.dataset.diffState = "settled";
    for (const element of dom.nodeElements.values()) {
      element.classList.remove("is-diff-added", "is-diff-removed", "is-diff-recolored");
      element.style.removeProperty("--diff-anchor-dx");
      element.style.removeProperty("--diff-anchor-dy");
      element.style.removeProperty("--diff-delay");
    }
    for (const element of dom.edgeElements.values()) {
      element.classList.remove("is-diff-added", "is-diff-removed");
      element.style.removeProperty("--diff-edge-length");
    }
    for (const element of dom.communityWashElements.values()) {
      element.classList.remove("is-diff-new-community");
    }
  }

  function semanticAnchorForNode(id: NodeId): { x: number; y: number } | null {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) return null;
    const neighborId = graph.edges
      .filter((edge) => edge.source === id || edge.target === id)
      .map((edge) => edge.source === id ? edge.target : edge.source)
      .find((candidate) => candidate !== id);
    const neighbor = neighborId ? graph.nodes.find((item) => item.id === neighborId) : null;
    if (neighbor) return neighbor.point;
    return {
      x: node.point.x < GRAPH_WORLD_SIZE.width / 2 ? -80 : GRAPH_WORLD_SIZE.width + 80,
      y: clamp(node.point.y, 80, GRAPH_WORLD_SIZE.height - 80)
    };
  }

  function renderReader(): void {
    const reader = dom.readerElement;
    if (!reader) return;
    const selected = graph.selectedNodeId ? graph.nodes.find((node) => node.id === graph.selectedNodeId) : null;
    const rawNode = selected ? data.nodes.find((node) => node.id === selected.id) : null;
    reader.dataset.state = selected ? "open" : "closed";
    reader.replaceChildren();
    if (!selected || !rawNode) {
      const empty = document.createElement("p");
      empty.className = "graph-reader-empty";
      empty.textContent = "选择一个节点查看内容";
      reader.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "graph-reader-header";
    const title = document.createElement("div");
    title.className = "graph-reader-title";
    title.textContent = selected.label;
    const payload = openPagePayloadForNode(data, selected.id);
    const meta = document.createElement("div");
    meta.className = "graph-reader-meta";
    for (const item of graphReaderMetaItems(payload.node)) {
      const tag = document.createElement("span");
      tag.textContent = item;
      meta.appendChild(tag);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "graph-reader-close";
    close.setAttribute("aria-label", "关闭阅读面板");
    close.textContent = "×";
    close.addEventListener("click", () => clearInteractionState());
    header.append(title, meta, close);

    const body = document.createElement("div");
    body.className = "graph-reader-body";
    if (payload.node.type === "source" && payload.node.sourcePath) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "graph-reader-source";
      sourceLink.href = payload.node.sourcePath;
      sourceLink.textContent = payload.node.sourcePath;
      body.appendChild(sourceLink);
    }
    const content = String(rawNode.content || rawNode.summary || selected.label);
    const rendered = renderMarkdown(content);
    if (rendered) {
      const article = document.createElement("article");
      article.className = "graph-reader-markdown";
      article.innerHTML = rendered;
      body.appendChild(article);
    } else {
      const pre = document.createElement("pre");
      pre.textContent = content;
      body.appendChild(pre);
    }
    reader.append(header, body);
  }

  function renderSelectionPanel(): void {
    const panel = dom.selectionElement;
    if (!panel) return;
    panel.replaceChildren();
    panel.dataset.state = selection ? "open" : "closed";
    if (!selection) {
      const empty = document.createElement("p");
      empty.className = "graph-selection-empty";
      empty.textContent = "Shift+点击 可选择多个节点";
      panel.appendChild(empty);
      return;
    }

    const resolved = resolveSelectionForCapabilities(data, selection, { canAsk: false });
    const selectedNodes = resolved.nodeIds
      .map((id) => data.nodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => Boolean(node));

    const header = document.createElement("div");
    header.className = "graph-selection-header";
    const title = document.createElement("div");
    title.className = "graph-selection-title";
    title.textContent = offlineSelectionTitle(selection, selectedNodes.length);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "graph-selection-close";
    close.setAttribute("aria-label", "关闭选区面板");
    close.textContent = "×";
    close.addEventListener("click", () => clearInteractionState());
    header.append(title, close);

    const hint = document.createElement("div");
    hint.className = "graph-selection-hint";
    hint.textContent = "Shift+点击 增删节点";

    const facts = document.createElement("div");
    facts.className = "graph-selection-facts";
    facts.append(
      createSelectionFact("页面", resolved.facts.pageCount),
      createSelectionFact("内部关联", resolved.facts.internalLinkCount),
      createSelectionFact("社区", resolved.facts.communityCount),
      createSelectionFact("孤立页", resolved.facts.isolatedCount)
    );

    const list = document.createElement("ol");
    list.className = "graph-selection-pages";
    for (const node of selectedNodes) {
      const item = document.createElement("li");
      item.className = "graph-selection-page";
      const name = document.createElement("span");
      name.className = "graph-selection-page-title";
      name.textContent = node.label || node.id;
      const path = document.createElement("span");
      path.className = "graph-selection-page-path";
      path.textContent = wikiPathForGraphNode(node);
      item.append(name, path);
      list.appendChild(item);
    }

    panel.append(header, hint, facts, list);
  }

  function scheduleHoverPreview(id: NodeId): void {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      previewNodeId = id;
      previewEdgeId = null;
      syncHoverState();
      renderHoverPreview();
    }, 300);
  }

  function showEdgeHoverPreview(id: string): void {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    previewNodeId = null;
    previewEdgeId = id;
    syncHoverState();
    renderHoverPreview();
  }

  function clearHoverPreview(): void {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (!previewNodeId && !previewEdgeId) return;
    previewNodeId = null;
    previewEdgeId = null;
    syncHoverState();
    renderHoverPreview();
  }

  function renderHoverPreview(): void {
    const preview = dom.previewElement;
    if (!preview) return;
    const hover = runtimeState.snapshot().hover;
    const edge = hover?.kind === "edge" ? graph.edges.find((item) => item.id === hover.id) : null;
    const rawNode = hover?.kind === "node" ? data.nodes.find((node) => node.id === hover.id) : null;
    const renderedNode = hover?.kind === "node" ? graph.nodes.find((node) => node.id === hover.id) : null;
    preview.replaceChildren();
    preview.dataset.kind = edge ? "edge" : "node";
    if (edge) {
      preview.dataset.state = "open";
      preview.append(createEdgeHoverPreviewContent(edge.relationType, edge.confidence));
      positionEdgeHoverPreview(preview, edge);
      return;
    }
    preview.dataset.state = rawNode && renderedNode ? "open" : "closed";
    if (!rawNode || !renderedNode) return;
    const content = buildHoverPreview(rawNode);
    preview.append(createHoverPreviewContent(content));
    positionHoverPreview(preview, renderedNode);
  }

  function positionHoverPreview(preview: HTMLElement, node: RenderableNode): void {
    const previewRect = preview.getBoundingClientRect();
    const size = viewportSize();
    const position = resolveGraphHoverPreviewPosition({
      anchorScreenPoint: graphNodeHoverAnchor(node, runtimeState.snapshot().viewport, size),
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
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    const size = viewportSize();
    const position = resolveGraphHoverPreviewPosition({
      anchorScreenPoint: graphEdgeHoverAnchor({ source, target }, runtimeState.snapshot().viewport, size),
      previewSize: { width: previewRect.width, height: previewRect.height },
      viewportSize: size,
      offset: { x: 16, y: -previewRect.height - 16 },
      margin: 12
    });
    preview.style.left = `${position.x}px`;
    preview.style.top = `${position.y}px`;
  }
}

interface DragHandlers {
  onNodeClick: (id: NodeId, additive: boolean) => void;
  onNodeDoubleClick: (id: string) => boolean;
  onNodePreviewEnter: (id: NodeId) => void;
  onEdgePreviewEnter: (id: string) => void;
  onNodePreviewLeave: () => void;
}

function paint(
  root: HTMLElement,
  graph: RenderableGraph,
  theme: ThemeId,
  hasHostReader: boolean,
  dragHandlers: DragHandlers
): PaintedGraphDom {
  root.replaceChildren();
  root.dataset.theme = theme;
  root.dataset.baseDensity = graph.densityMode;
  const painted = emptyPaintedDom();
  const contentLayer = document.createElement("div");
  contentLayer.className = "graph-content-layer";
  contentLayer.dataset.viewportLayer = "true";
  painted.contentLayer = contentLayer;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "llm-wiki-graph-svg");
  svg.setAttribute("viewBox", "0 0 1000 680");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  const washLayer = document.createElementNS(SVG_NS, "g");
  washLayer.setAttribute("class", "community-wash-layer");
  for (const community of graph.communities) {
    if (!community.wash) continue;
    const ellipse = document.createElementNS(SVG_NS, "ellipse");
    ellipse.setAttribute("class", "community-wash");
    ellipse.setAttribute("cx", String(community.wash.cx));
    ellipse.setAttribute("cy", String(community.wash.cy));
    ellipse.setAttribute("rx", String(community.wash.rx));
    ellipse.setAttribute("ry", String(community.wash.ry));
    ellipse.setAttribute("fill", community.color);
    ellipse.setAttribute("opacity", String(community.wash.opacity));
    ellipse.dataset.communityId = community.id;
    ellipse.style.cursor = "pointer";
    washLayer.appendChild(ellipse);
    painted.communityWashElements.set(community.id, ellipse);
  }
  svg.appendChild(washLayer);

  const edgeLayer = document.createElementNS(SVG_NS, "g");
  edgeLayer.setAttribute("class", "edge-layer");
  for (const edge of graph.edges) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", edge.path);
    path.setAttribute("class", `edge confidence-${edge.confidence} ${edge.relationClass}`);
    path.setAttribute("data-from", edge.source);
    path.setAttribute("data-to", edge.target);
    path.setAttribute("data-edge-id", edge.id);
    path.setAttribute("data-confidence", edge.confidence);
    path.setAttribute("data-relation-type", edge.relationType);
    path.setAttribute("aria-label", `${edge.relationType} · ${edgeConfidenceLabel(edge.confidence)}`);
    path.setAttribute("tabindex", "0");
    path.addEventListener("pointerenter", () => dragHandlers.onEdgePreviewEnter(edge.id));
    path.addEventListener("pointerleave", () => dragHandlers.onNodePreviewLeave());
    path.addEventListener("focus", () => dragHandlers.onEdgePreviewEnter(edge.id));
    path.addEventListener("blur", () => dragHandlers.onNodePreviewLeave());
    path.style.strokeWidth = String(edge.strokeWidth);
    path.style.opacity = String(edge.opacity);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${edge.relationType} · ${edgeConfidenceLabel(edge.confidence)}`;
    path.appendChild(title);
    edgeLayer.appendChild(path);
    painted.edgeElements.set(edge.id, path);
  }
  svg.appendChild(edgeLayer);
  contentLayer.appendChild(svg);

  const nodeLayer = document.createElement("div");
  nodeLayer.className = "node-layer";
  for (const node of graph.nodes) {
    const button = createNodeButton(node, dragHandlers);
    painted.nodeElements.set(node.id, button);
    painted.basePoints.set(node.id, node.point);
    nodeLayer.appendChild(button);
  }
  contentLayer.appendChild(nodeLayer);
  root.appendChild(contentLayer);

  const preview = document.createElement("aside");
  preview.className = "graph-hover-preview";
  preview.dataset.state = "closed";
  preview.setAttribute("aria-live", "polite");
  root.appendChild(preview);
  painted.previewElement = preview;

  const minimap = document.createElement("div");
  minimap.className = "mini-map";
  const miniSvg = document.createElementNS(SVG_NS, "svg");
  miniSvg.setAttribute("viewBox", "0 0 160 54");
  miniSvg.setAttribute("aria-hidden", "true");
  const miniPath = document.createElementNS(SVG_NS, "path");
  miniPath.setAttribute("d", graph.minimap.path);
  miniPath.setAttribute("fill", "none");
  miniPath.setAttribute("stroke", "var(--line)");
  miniPath.setAttribute("stroke-width", "1.4");
  miniSvg.appendChild(miniPath);
  const miniViewport = document.createElementNS(SVG_NS, "rect");
  miniViewport.setAttribute("class", "mini-map-viewport");
  miniViewport.setAttribute("data-mini-map-viewport", "true");
  miniViewport.setAttribute("x", "0");
  miniViewport.setAttribute("y", "0");
  miniViewport.setAttribute("width", "160");
  miniViewport.setAttribute("height", "54");
  miniSvg.appendChild(miniViewport);
  painted.miniViewportElement = miniViewport;
  for (const miniNode of graph.minimap.nodes) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(miniNode.x));
    circle.setAttribute("cy", String(miniNode.y));
    circle.setAttribute("r", String(miniNode.r));
    circle.setAttribute("fill", miniNode.fill);
    if (miniNode.selected) circle.classList.add("is-selected");
    miniSvg.appendChild(circle);
    painted.miniNodeElements.set(miniNode.id, circle);
  }
  minimap.appendChild(miniSvg);
  root.appendChild(minimap);
  if (!hasHostReader) {
    const reader = document.createElement("aside");
    reader.className = "graph-reader";
    reader.dataset.state = graph.selectedNodeId ? "open" : "closed";
    root.appendChild(reader);
    painted.readerElement = reader;

    const selectionPanel = document.createElement("aside");
    selectionPanel.className = "graph-selection-panel";
    selectionPanel.dataset.state = "closed";
    root.appendChild(selectionPanel);
    painted.selectionElement = selectionPanel;
  }
  return painted;
}

function createHoverPreviewContent(preview: GraphHoverPreview): HTMLElement {
  const article = document.createElement("article");
  article.className = "graph-hover-preview-card";
  const type = document.createElement("div");
  type.className = "graph-hover-preview-type";
  type.textContent = preview.typeLabel;
  const title = document.createElement("div");
  title.className = "graph-hover-preview-title";
  title.textContent = preview.title;
  article.append(type, title);
  if (preview.summary) {
    const summary = document.createElement("p");
    summary.className = "graph-hover-preview-summary";
    summary.textContent = preview.summary;
    article.appendChild(summary);
  }
  return article;
}

function createEdgeHoverPreviewContent(relationType: string, confidence: string): HTMLElement {
  const article = document.createElement("article");
  article.className = "graph-hover-preview-card graph-edge-hover-card";
  const type = document.createElement("div");
  type.className = "graph-hover-preview-type";
  type.textContent = "关系";
  const title = document.createElement("div");
  title.className = "graph-hover-preview-title";
  title.textContent = relationType;
  const summary = document.createElement("p");
  summary.className = "graph-hover-preview-summary";
  summary.textContent = `置信度：${edgeConfidenceLabel(confidence)}`;
  article.append(type, title, summary);
  return article;
}

function createSelectionFact(label: string, value: number): HTMLElement {
  const item = document.createElement("div");
  item.className = "graph-selection-fact";
  const number = document.createElement("strong");
  number.textContent = String(value);
  const text = document.createElement("span");
  text.textContent = label;
  item.append(number, text);
  return item;
}

function offlineSelectionTitle(selection: SelectionInput, count: number): string {
  if (selection.kind === "community") return `社区选区 · ${count} 页`;
  if (selection.kind === "neighbors") return `相邻节点 · ${count} 页`;
  if (selection.kind === "node") return "选中页面";
  return `手动选区 · ${count} 页`;
}

function positionsFromRenderableGraph(graph: RenderableGraph): RenderPositionMap {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.point.x, y: node.point.y }]));
}

function createNodeButton(node: RenderableNode, dragHandlers: DragHandlers): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "node";
  if (node.unavailable) button.classList.add("is-disabled");
  applyNodeDisplayMode(button, node.displayMode);
  if (node.previewStart) button.classList.add("is-preview-start");
  if (!node.labelVisible) button.classList.add("is-label-hidden");
  button.type = "button";
  button.dataset.id = node.id;
  button.dataset.type = node.type;
  button.dataset.community = node.community;
  button.dataset.visualRole = node.visualRole;
  button.dataset.startNode = node.startNode ? "true" : "false";
  button.dataset.previewStart = node.previewStart ? "true" : "false";
  button.style.left = `${node.x}%`;
  button.style.top = `${node.y}%`;
  button.title = node.label;
  button.setAttribute("aria-pressed", node.selected ? "true" : "false");
  button.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    dragHandlers.onNodeDoubleClick(node.id);
  });
  button.addEventListener("pointerenter", () => dragHandlers.onNodePreviewEnter(node.id));
  button.addEventListener("pointerleave", () => dragHandlers.onNodePreviewLeave());
  button.addEventListener("focus", () => dragHandlers.onNodePreviewEnter(node.id));
  button.addEventListener("blur", () => dragHandlers.onNodePreviewLeave());
  bindNodeActivationHandlers(button, node.id, dragHandlers);

  const kind = document.createElement("span");
  kind.className = "node-kind";
  kind.textContent = node.kind;
  button.appendChild(kind);

  const name = document.createElement("span");
  name.className = "node-name";
  name.textContent = node.label;
  button.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "node-meta";
  const spark = document.createElement("i");
  spark.className = "spark";
  meta.appendChild(spark);
  meta.append(node.unavailable ? "来源暂不可用" : String(Math.round(node.priority || node.weight || 0)));
  button.appendChild(meta);

  return button;
}

function applyNodeDisplayMode(button: HTMLButtonElement, displayMode: NodeDisplayMode): void {
  button.classList.toggle("is-compact", displayMode === "compact-card");
  button.classList.toggle("is-point", displayMode === "point");
  button.classList.toggle("is-overview", displayMode === "overview");
  button.dataset.densityMode = displayMode;
}

function bindNodeActivationHandlers(button: HTMLButtonElement, nodeId: string, handlers: DragHandlers): void {
  button.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    event.stopPropagation();
    handlers.onNodeClick(nodeId, event.shiftKey);
  });
}

function selectedNodeIds(selection: SelectionInput | null): NodeId[] {
  if (!selection) return [];
  if (selection.kind === "node" || selection.kind === "neighbors") return [selection.id];
  if (selection.kind === "nodes") return selection.ids;
  return [];
}

function shiftSelection(id: NodeId, current: NodeId[]): SelectionInput {
  const selected = new Set(current);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  const ids = Array.from(selected);
  if (ids.length === 1) return { kind: "node", id: ids[0] };
  return { kind: "nodes", ids };
}

function openPagePayloadForNode(data: GraphData, id: NodeId): GraphOpenPagePayload {
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

function isIsolatedNode(data: GraphData, id: NodeId): boolean {
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

function graphReaderMetaItems(node: GraphOpenPagePayload["node"]): string[] {
  const items = [node.typeLabel];
  if (node.date) items.push(node.date);
  if (node.source) items.push(node.source);
  return items;
}

function edgeConfidenceLabel(confidence: string): string {
  switch (confidence) {
    case "inferred":
      return "推断";
    case "ambiguous":
      return "待确认";
    case "unverified":
      return "未验证";
    default:
      return "原文";
  }
}

function isTextEditingElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea") return true;
  if (tagName === "input") {
    const input = element as HTMLInputElement;
    const type = input.type.toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function createGraphToolbar(
  ownerDocument: Document,
  options: {
    panelState: GraphToolbarPanelState;
    typeFilters: GraphTypeFilters;
    onPanelToggle: (panel: Exclude<GraphToolbarPanelState, "closed">) => void;
    onTypeFilterToggle: (type: string, enabled: boolean) => void;
    onReset: () => void;
  }
): { element: HTMLElement; panel: HTMLElement; filtersPanel: HTMLElement } {
  const element = ownerDocument.createElement("nav");
  element.className = "graph-toolbar";
  element.dataset.panel = options.panelState;
  element.setAttribute("aria-label", "图谱控制");
  element.addEventListener("click", (event) => event.stopPropagation());

  const actions = ownerDocument.createElement("div");
  actions.className = "graph-toolbar-actions";
  const filters = createToolbarButton(ownerDocument, "筛选", options.panelState === "filters");
  filters.addEventListener("click", () => options.onPanelToggle("filters"));
  const legend = createToolbarButton(ownerDocument, "图例", options.panelState === "legend");
  legend.addEventListener("click", () => options.onPanelToggle("legend"));
  const reset = createToolbarButton(ownerDocument, "回全图", false);
  reset.addEventListener("click", options.onReset);
  actions.append(filters, legend, reset);

  const panel = ownerDocument.createElement("section");
  panel.className = "graph-toolbar-panel";
  panel.dataset.state = options.panelState;
  const filtersPanel = ownerDocument.createElement("div");
  filtersPanel.className = "graph-toolbar-section graph-toolbar-filters";
  filtersPanel.appendChild(createTypeFilterGroup(ownerDocument, options.typeFilters, options.onTypeFilterToggle));

  const legendPanel = ownerDocument.createElement("div");
  legendPanel.className = "graph-toolbar-section graph-toolbar-legend";
  const legendTitle = ownerDocument.createElement("div");
  legendTitle.className = "graph-toolbar-section-title";
  legendTitle.textContent = "边";
  legendPanel.appendChild(legendTitle);
  legendPanel.appendChild(createEdgeLegend(ownerDocument));

  panel.append(filtersPanel, legendPanel);
  element.append(actions, panel);
  return { element, panel, filtersPanel };
}

function createEdgeLegend(ownerDocument: Document): HTMLElement {
  const legend = ownerDocument.createElement("div");
  legend.className = "graph-edge-legend";
  const relations = ownerDocument.createElement("div");
  relations.className = "graph-edge-legend-group";
  relations.appendChild(createEdgeLegendHeading(ownerDocument, "关系类型"));
  for (const item of [
    { label: "实现 / 依赖 / 衍生", className: "relation-dependency" },
    { label: "对比", className: "relation-contrast" },
    { label: "矛盾", className: "relation-conflict" }
  ]) {
    relations.appendChild(createEdgeLegendRelation(ownerDocument, item.label, item.className));
  }

  const confidences = ownerDocument.createElement("div");
  confidences.className = "graph-edge-legend-group";
  confidences.appendChild(createEdgeLegendHeading(ownerDocument, "置信度"));
  for (const item of [
    { label: "原文", className: "confidence-extracted" },
    { label: "推断", className: "confidence-inferred" },
    { label: "待确认", className: "confidence-ambiguous" }
  ]) {
    confidences.appendChild(createEdgeLegendConfidence(ownerDocument, item.label, item.className));
  }

  legend.append(relations, confidences);
  return legend;
}

function createEdgeLegendHeading(ownerDocument: Document, text: string): HTMLElement {
  const heading = ownerDocument.createElement("div");
  heading.className = "graph-edge-legend-heading";
  heading.textContent = text;
  return heading;
}

function createEdgeLegendRelation(ownerDocument: Document, label: string, className: string): HTMLElement {
  const row = ownerDocument.createElement("div");
  row.className = `graph-edge-legend-row graph-edge-legend-relation ${className}`;
  const swatch = ownerDocument.createElement("span");
  swatch.className = "graph-edge-legend-swatch";
  const text = ownerDocument.createElement("span");
  text.textContent = label;
  row.append(swatch, text);
  return row;
}

function createEdgeLegendConfidence(ownerDocument: Document, label: string, className: string): HTMLElement {
  const row = ownerDocument.createElement("div");
  row.className = `graph-edge-legend-row graph-edge-legend-confidence ${className}`;
  const line = ownerDocument.createElement("span");
  line.className = "graph-edge-legend-line";
  const text = ownerDocument.createElement("span");
  text.textContent = label;
  row.append(line, text);
  return row;
}

function createTypeFilterGroup(
  ownerDocument: Document,
  typeFilters: GraphTypeFilters,
  onToggle: (type: string, enabled: boolean) => void
): HTMLElement {
  const group = ownerDocument.createElement("fieldset");
  group.className = "graph-type-filter";
  const title = ownerDocument.createElement("legend");
  title.className = "graph-toolbar-section-title";
  title.textContent = "类型筛选";
  group.appendChild(title);

  for (const type of orderedGraphNodeTypes(typeFilters)) {
    const label = ownerDocument.createElement("label");
    label.className = "graph-type-filter-option";
    const input = ownerDocument.createElement("input");
    input.type = "checkbox";
    input.checked = typeFilters[type] !== false;
    input.dataset.type = type;
    input.addEventListener("change", () => onToggle(type, input.checked));
    const text = ownerDocument.createElement("span");
    text.textContent = graphNodeTypeLabel(type);
    label.append(input, text);
    group.appendChild(label);
  }

  return group;
}

function orderedGraphNodeTypes(typeFilters: GraphTypeFilters): string[] {
  const preferred = ["entity", "topic", "source"];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const type of preferred) {
    if (Object.hasOwn(typeFilters, type)) {
      ordered.push(type);
      seen.add(type);
    }
  }
  for (const type of Object.keys(typeFilters).sort()) {
    if (!seen.has(type)) ordered.push(type);
  }
  return ordered;
}

function createToolbarButton(ownerDocument: Document, label: string, active: boolean): HTMLButtonElement {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = "graph-toolbar-button";
  button.dataset.active = active ? "true" : "false";
  button.textContent = label;
  return button;
}

function createCommunityLegend(
  ownerDocument: Document,
  options: {
    rows: CommunityLegendRow[];
    collapsed: boolean;
    onToggle: () => void;
    onHover: (id: string | null) => void;
    onSelect: (id: string) => void;
  }
): { element: HTMLElement; rows: Map<string, HTMLButtonElement> } {
  const element = ownerDocument.createElement("aside");
  element.className = "community-legend";
  element.dataset.state = options.collapsed ? "collapsed" : "open";
  const header = ownerDocument.createElement("button");
  header.type = "button";
  header.className = "community-legend-toggle";
  header.setAttribute("aria-expanded", options.collapsed ? "false" : "true");
  header.textContent = options.collapsed ? "社区" : "社区";
  header.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onToggle();
  });
  element.appendChild(header);

  const list = ownerDocument.createElement("div");
  list.className = "community-legend-list";
  const rowMap = new Map<string, HTMLButtonElement>();
  for (const row of options.rows) {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "community-legend-row";
    button.dataset.communityId = row.id;
    button.addEventListener("pointerenter", () => options.onHover(row.id));
    button.addEventListener("pointerleave", () => options.onHover(null));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onSelect(row.id);
    });
    const swatch = ownerDocument.createElement("span");
    swatch.className = "community-legend-swatch";
    swatch.style.background = row.color;
    const label = ownerDocument.createElement("span");
    label.className = "community-legend-label";
    label.textContent = row.label;
    const count = ownerDocument.createElement("span");
    count.className = "community-legend-count";
    count.textContent = `${row.pageCount} 页`;
    button.append(swatch, label, count);
    list.appendChild(button);
    rowMap.set(row.id, button);
  }
  element.appendChild(list);
  return { element, rows: rowMap };
}

function createSearchControl(
  ownerDocument: Document,
  options: {
    open: boolean;
    query: string;
    onOpen: () => void;
    onQuery: (query: string) => void;
    onNext: () => void;
    onClose: () => void;
  }
): { element: HTMLElement; input: HTMLInputElement; status: HTMLElement } {
  const element = ownerDocument.createElement("div");
  element.className = "graph-search";
  element.dataset.state = options.open ? "open" : "closed";
  const input = ownerDocument.createElement("input");
  input.type = "search";
  input.className = "graph-search-input";
  input.placeholder = "搜索图谱";
  input.setAttribute("aria-label", "搜索图谱");
  input.value = options.query;
  input.addEventListener("focus", options.onOpen);
  input.addEventListener("input", () => options.onQuery(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      options.onNext();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.onClose();
    }
  });
  const status = ownerDocument.createElement("span");
  status.className = "graph-search-status";
  status.textContent = options.query ? "0 个结果" : "输入关键词";
  element.append(input, status);
  return { element, input, status };
}

function emptyPaintedDom(): PaintedGraphDom {
  return {
    contentLayer: null,
    edgeElements: new Map(),
    communityWashElements: new Map(),
    nodeElements: new Map(),
    miniNodeElements: new Map(),
    miniViewportElement: null,
    basePoints: new Map(),
    readerElement: null,
    selectionElement: null,
    searchElement: null,
    searchInput: null,
    searchStatusElement: null,
    toolbarElement: null,
    toolbarPanelElement: null,
    legendElement: null,
    legendRows: new Map(),
    previewElement: null
  };
}

const COMMUNITY_LEGEND_COLLAPSED_KEY = "llm-wiki:graph:community-legend:collapsed";

function readLegendCollapsed(ownerDocument: Document): boolean {
  try {
    return ownerDocument.defaultView?.localStorage?.getItem(COMMUNITY_LEGEND_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLegendCollapsed(ownerDocument: Document, collapsed: boolean): void {
  try {
    ownerDocument.defaultView?.localStorage?.setItem(COMMUNITY_LEGEND_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {
    // localStorage can be unavailable in restricted file contexts.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function applyTheme(root: HTMLElement, theme: ThemeId): void {
  root.dataset.theme = theme;
  root.style.colorScheme = getThemeTokens(theme).colorScheme;
  const vars = themeTokensToCssVars(theme);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

function ensureStaticRendererStyles(doc: Document): void {
  if (doc.getElementById("llm-wiki-graph-engine-static-styles")) return;
  const style = doc.createElement("style");
  style.id = "llm-wiki-graph-engine-static-styles";
  style.textContent = STATIC_RENDERER_CSS;
  doc.head.appendChild(style);
}

const STATIC_RENDERER_CSS = `
.llm-wiki-graph-engine {
  position: relative;
  width: 100%;
  min-height: 520px;
  height: 100%;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-ui);
  background:
    radial-gradient(ellipse at 28% 55%, color-mix(in srgb, var(--surface) 56%, transparent), transparent 56%),
    radial-gradient(ellipse at 70% 48%, color-mix(in srgb, var(--mist) 60%, transparent), transparent 58%),
    var(--bg);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 38%, transparent), transparent 34%),
    radial-gradient(ellipse at 28% 56%, color-mix(in srgb, var(--night) 13%, transparent), transparent 58%),
    radial-gradient(ellipse at 76% 38%, color-mix(in srgb, var(--cinnabar) 9%, transparent), transparent 54%),
    var(--bg);
}
.graph-content-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  transform-origin: 0 0;
  will-change: transform;
}
.graph-search {
  position: absolute;
  top: 64px;
  left: 14px;
  z-index: 7;
  display: grid;
  grid-template-columns: minmax(180px, 260px) auto;
  align-items: center;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-6px);
  transition: opacity .16s ease, transform .16s ease;
}
.graph-search[data-state="open"],
.graph-search:focus-within {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.graph-search-input {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  padding: 8px 10px;
  color: var(--ink);
  font: 13px/1.3 var(--font-ui);
  outline: none;
  box-shadow: 0 12px 24px rgba(36, 24, 12, .08);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-search-input {
  background: color-mix(in srgb, var(--surface) 88%, transparent);
}
.graph-search-input:focus {
  border-color: color-mix(in srgb, var(--cinnabar) 70%, transparent);
}
.graph-search-status {
  border: 1px solid color-mix(in srgb, var(--rule) 68%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 84%, transparent);
  padding: 5px 8px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.graph-toolbar {
  position: absolute;
  top: 14px;
  left: 14px;
  right: 14px;
  z-index: 8;
  display: grid;
  justify-items: start;
  pointer-events: none;
}
.graph-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: 1px solid color-mix(in srgb, var(--rule) 62%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 64%, transparent);
  box-shadow: 0 14px 30px rgba(36, 24, 12, .08);
  backdrop-filter: blur(14px);
  padding: 4px;
  pointer-events: auto;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-toolbar-actions {
  background: color-mix(in srgb, var(--surface) 58%, transparent);
}
.graph-toolbar-button {
  min-height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font: 12px/1.2 var(--font-ui);
  padding: 0 10px;
  cursor: pointer;
  white-space: nowrap;
}
.graph-toolbar-button:hover,
.graph-toolbar-button[data-active="true"] {
  background: color-mix(in srgb, var(--cinnabar) 10%, transparent);
  color: var(--ink);
}
.graph-toolbar-panel {
  width: min(320px, calc(100vw - 28px));
  max-height: min(58vh, 420px);
  margin-top: 8px;
  border: 1px solid color-mix(in srgb, var(--rule) 62%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  box-shadow: 0 20px 42px rgba(36, 24, 12, .12);
  backdrop-filter: blur(16px);
  overflow: auto;
  pointer-events: auto;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-toolbar-panel {
  background: color-mix(in srgb, var(--surface) 62%, transparent);
}
.graph-toolbar-panel[data-state="closed"] {
  display: none;
}
.graph-toolbar-section {
  display: none;
}
.graph-toolbar-panel[data-state="filters"] .graph-toolbar-filters,
.graph-toolbar-panel[data-state="legend"] .graph-toolbar-legend {
  display: block;
}
.graph-toolbar-section-title {
  padding: 10px 12px;
  color: var(--muted);
  font: 12px/1.3 var(--font-ui);
}
.graph-type-filter {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--rule) 52%, transparent);
  padding: 0 10px 10px;
}
.graph-type-filter .graph-toolbar-section-title {
  grid-column: 1 / -1;
  padding: 10px 2px 2px;
}
.graph-type-filter-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  border: 1px solid color-mix(in srgb, var(--rule) 52%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 48%, transparent);
  padding: 0 8px;
  color: var(--ink);
  font: 12px/1.2 var(--font-ui);
  cursor: pointer;
}
.graph-type-filter-option input {
  margin: 0;
  accent-color: var(--cinnabar);
}
.graph-type-filter-option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-edge-legend {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
}
.graph-edge-legend-group {
  display: grid;
  gap: 7px;
}
.graph-edge-legend-heading {
  color: var(--muted);
  font: 11px/1.2 var(--font-ui);
}
.graph-edge-legend-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 24px;
  color: var(--ink);
  font: 12px/1.2 var(--font-ui);
}
.graph-edge-legend-swatch,
.graph-edge-legend-line {
  display: block;
  width: 34px;
  height: 0;
  border-top: 2px solid color-mix(in srgb, var(--night) 66%, transparent);
}
.graph-edge-legend-relation.relation-contrast .graph-edge-legend-swatch {
  border-top-color: color-mix(in srgb, var(--amber) 82%, transparent);
}
.graph-edge-legend-relation.relation-conflict .graph-edge-legend-swatch {
  border-top-color: color-mix(in srgb, #d94693 78%, transparent);
}
.graph-edge-legend-confidence.confidence-inferred .graph-edge-legend-line {
  border-top-style: dashed;
}
.graph-edge-legend-confidence.confidence-ambiguous .graph-edge-legend-line {
  border-top-style: dotted;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-edge-legend-swatch,
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-edge-legend-line {
  border-top-color: color-mix(in srgb, var(--line) 70%, transparent);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-edge-legend-relation.relation-contrast .graph-edge-legend-swatch {
  border-top-color: color-mix(in srgb, var(--amber) 76%, transparent);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-edge-legend-relation.relation-conflict .graph-edge-legend-swatch {
  border-top-color: color-mix(in srgb, #f472b6 78%, transparent);
}
.community-legend {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: hidden;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .community-legend {
  background: transparent;
}
.community-legend-toggle {
  width: 100%;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--rule) 64%, transparent);
  background: transparent;
  padding: 8px 10px;
  color: var(--ink);
  font: 12px/1.3 var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.community-legend[data-state="collapsed"] .community-legend-toggle {
  border-bottom: 0;
}
.community-legend-list {
  display: grid;
}
.community-legend[data-state="collapsed"] .community-legend-list {
  display: none;
}
.community-legend-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--rule) 48%, transparent);
  background: transparent;
  padding: 8px 10px;
  color: var(--ink);
  font: 12px/1.3 var(--font-ui);
  cursor: pointer;
  text-align: left;
}
.community-legend-row:first-child {
  border-top: 0;
}
.community-legend-row:hover,
.community-legend-row[data-community-state="active"] {
  background: color-mix(in srgb, var(--cinnabar) 8%, transparent);
}
.community-legend-row[data-community-state="faded"] {
  opacity: .42;
}
.community-legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12);
}
.community-legend-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.community-legend-count {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.graph-selection-panel {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 7;
  display: grid;
  gap: 12px;
  width: min(360px, calc(100% - 32px));
  max-height: min(520px, calc(100% - 32px));
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--rule) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: 0 18px 36px rgba(36, 24, 12, .14);
  padding: 14px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity .16s ease, transform .16s ease;
}
.graph-selection-panel[data-state="open"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-selection-panel {
  background: color-mix(in srgb, var(--surface) 88%, transparent);
}
.graph-selection-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
}
.graph-selection-title {
  overflow: hidden;
  color: var(--ink);
  font: 600 14px/1.35 var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-selection-close {
  width: 28px;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--rule) 72%, transparent);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  font-size: 17px;
  line-height: 1;
}
.graph-selection-hint,
.graph-selection-empty {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}
.graph-selection-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.graph-selection-fact {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--rule) 58%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--mist) 52%, transparent);
  padding: 8px 6px;
}
.graph-selection-fact strong,
.graph-selection-fact span {
  display: block;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-selection-fact strong {
  color: var(--ink);
  font-size: 15px;
}
.graph-selection-fact span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
}
.graph-selection-pages {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.graph-selection-page {
  min-width: 0;
  border-top: 1px solid color-mix(in srgb, var(--rule) 46%, transparent);
  padding-top: 7px;
}
.graph-selection-page:first-child {
  border-top: 0;
  padding-top: 0;
}
.graph-selection-page-title,
.graph-selection-page-path {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-selection-page-title {
  color: var(--ink);
  font-size: 13px;
}
.graph-selection-page-path {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
}
.graph-content-layer.is-viewport-animating {
  transition: transform .2s ease-out;
}
.llm-wiki-graph-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.edge {
  fill: none;
  stroke-linecap: round;
  opacity: .74;
  pointer-events: stroke;
}
.edge.is-diff-added {
  stroke-dasharray: var(--diff-edge-length, 180);
  stroke-dashoffset: var(--diff-edge-length, 180);
  animation: llm-wiki-edge-draw 1.15s ease forwards;
}
.edge.is-diff-removed {
  animation: llm-wiki-fade-out .72s ease forwards;
}
.edge.relation-implementation,
.edge.relation-dependency,
.edge.relation-derivation {
  stroke: color-mix(in srgb, var(--night) 66%, transparent);
}
.edge.relation-contrast {
  stroke: color-mix(in srgb, var(--amber) 82%, transparent);
}
.edge.relation-conflict {
  stroke: color-mix(in srgb, #d94693 78%, transparent);
}
.edge.confidence-inferred { stroke-dasharray: 6 8; }
.edge.confidence-ambiguous { stroke-dasharray: 2 7; }
.edge.confidence-unverified { stroke-dasharray: 1 8; }
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge {
  opacity: .82;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge.relation-implementation,
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge.relation-dependency,
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge.relation-derivation {
  stroke: color-mix(in srgb, var(--line) 70%, transparent);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge.relation-contrast {
  stroke: color-mix(in srgb, var(--amber) 76%, transparent);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .edge.relation-conflict {
  stroke: color-mix(in srgb, #f472b6 78%, transparent);
}
.community-wash {
  transition: opacity .16s ease, cx .24s ease, cy .24s ease, rx .24s ease, ry .24s ease;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .community-wash {
  mix-blend-mode: screen;
  filter: saturate(.9);
}
.community-wash.is-diff-new-community {
  animation: llm-wiki-community-emerge .85s ease both;
}
.llm-wiki-graph-engine[data-dragging] .community-wash {
  opacity: .035;
}
.node-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
.graph-hover-preview {
  position: absolute;
  z-index: 9;
  width: min(300px, calc(100% - 32px));
  pointer-events: none;
  opacity: 0;
  transition: opacity .14s ease;
}
.graph-hover-preview[data-state="open"] {
  opacity: 1;
}
.graph-hover-preview-card {
  border: 1px solid color-mix(in srgb, var(--rule) 74%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: 0 18px 34px rgba(36, 31, 26, .16);
  padding: 11px 12px;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-hover-preview-card {
  border-color: color-mix(in srgb, var(--line) 38%, transparent);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  box-shadow: 0 18px 36px rgba(0, 0, 0, .38);
}
.graph-hover-preview-type {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.2;
}
.graph-hover-preview-title {
  margin-top: 3px;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-hover-preview-summary {
  display: -webkit-box;
  margin: 7px 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.node {
  position: absolute;
  z-index: 3;
  pointer-events: auto;
  min-height: 46px;
  max-width: 178px;
  padding: 8px 11px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--rule) 98%, transparent);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  box-shadow: 0 12px 22px rgba(36, 31, 26, .09), inset 0 0 0 1px rgba(255, 255, 255, .32);
  translate: -50% -50%;
  text-align: left;
  color: var(--ink);
  transition:
    opacity .16s ease,
    width .16s ease,
    height .16s ease,
    min-width .16s ease,
    min-height .16s ease,
    max-width .16s ease,
    padding .16s ease,
    border-radius .16s ease,
    border-color .16s ease,
    background-color .16s ease,
    box-shadow .16s ease;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .node {
  border-color: color-mix(in srgb, var(--rule) 84%, transparent);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  box-shadow: 0 16px 30px rgba(0, 0, 0, .34), inset 0 0 0 1px rgba(245, 240, 230, .07);
}
.node::before {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: 17px;
  background: radial-gradient(circle, color-mix(in srgb, var(--night) 18%, transparent), transparent 66%);
  z-index: -1;
  opacity: .46;
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .node::before {
  background: radial-gradient(circle, color-mix(in srgb, var(--night) 24%, transparent), transparent 68%);
  opacity: .4;
}
.node[data-type="topic"] { border-left: 5px solid var(--cinnabar); }
.node[data-type="entity"] { border-left: 5px solid var(--night); }
.node[data-type="source"] { border-left: 5px solid var(--jade); }
.node[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--cinnabar) 74%, transparent);
  box-shadow: 0 16px 28px color-mix(in srgb, var(--cinnabar) 16%, transparent), 0 0 0 4px color-mix(in srgb, var(--cinnabar) 10%, transparent);
  transform: translateY(-2px);
}
.node[data-search-state="match"] {
  border-color: color-mix(in srgb, var(--cinnabar) 78%, transparent);
  box-shadow: 0 16px 28px color-mix(in srgb, var(--cinnabar) 15%, transparent), 0 0 0 4px color-mix(in srgb, var(--cinnabar) 9%, transparent);
}
.node[data-search-focus="true"] {
  outline: 3px solid color-mix(in srgb, var(--cinnabar) 68%, transparent);
  outline-offset: 4px;
}
.node[data-search-state="faded"] {
  opacity: .28;
}
.node[data-community-state="faded"] {
  opacity: .24;
}
.edge[data-community-state="faded"],
.community-wash[data-community-state="faded"] {
  opacity: .12 !important;
}
.community-wash[data-community-state="active"] {
  opacity: .2;
}
.node.is-dragging {
  cursor: grabbing;
  z-index: 8;
  box-shadow: 0 18px 34px color-mix(in srgb, var(--cinnabar) 18%, transparent), 0 0 0 4px color-mix(in srgb, var(--cinnabar) 10%, transparent);
}
.node.is-pinned::after {
  content: "";
  position: absolute;
  right: -5px;
  top: -5px;
  width: 10px;
  height: 10px;
  border: 2px solid color-mix(in srgb, var(--surface) 92%, transparent);
  border-radius: 99px;
  background: var(--cinnabar);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cinnabar) 13%, transparent);
}
.node-kind {
  display: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.node-name {
  display: block;
  max-width: 146px;
  margin-top: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}
.node-meta {
  display: none;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--faint);
  font-size: 11px;
}
.node:hover .node-kind,
.node[aria-pressed="true"] .node-kind {
  display: block;
}
.node:hover .node-name,
.node[aria-pressed="true"] .node-name {
  margin-top: 3px;
}
.node:hover .node-meta,
.node[aria-pressed="true"] .node-meta {
  display: flex;
}
.spark {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--night);
  box-shadow: 0 0 10px color-mix(in srgb, var(--night) 70%, transparent);
}
.node.is-compact {
  min-height: 34px;
  max-width: 130px;
  padding: 6px 9px;
  border-radius: 10px;
}
.node.is-compact .node-kind,
.node.is-compact .node-meta { display: none; }
.node.is-compact .node-name {
  max-width: 104px;
  font-size: 12px;
}
.node.is-point,
.node.is-overview,
.node[data-visual-role="map-pin"] {
  width: 14px;
  height: 14px;
  min-width: 14px;
  min-height: 14px;
  max-width: 14px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--night);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--night) 14%, transparent);
}
.node.is-point[data-type="topic"],
.node.is-overview[data-type="topic"] { background: var(--cinnabar); }
.node.is-point[data-type="source"],
.node.is-overview[data-type="source"] { background: var(--jade); }
.node.is-point .node-kind,
.node.is-point .node-name,
.node.is-point .node-meta,
.node.is-overview .node-kind,
.node.is-overview .node-name,
.node.is-overview .node-meta { display: none; }
.node.is-label-hidden .node-name { display: none; }
.node[data-visual-role="landmark"] {
  min-height: 30px;
  max-width: 150px;
  padding: 5px 10px 5px 24px;
  border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
  border-radius: 999px 8px 8px 999px;
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  box-shadow: 0 8px 16px rgba(36, 31, 26, .06);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .node[data-visual-role="landmark"] {
  border-color: color-mix(in srgb, var(--line) 38%, transparent);
  background: color-mix(in srgb, var(--surface) 64%, transparent);
  box-shadow: 0 10px 20px rgba(0, 0, 0, .22);
}
.node[data-visual-role="landmark"]::before {
  inset: auto auto auto 9px;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--night);
  opacity: .78;
  translate: 0 -50%;
}
.node[data-visual-role="landmark"][data-type="topic"]::before { background: var(--cinnabar); }
.node[data-visual-role="landmark"][data-type="source"]::before { background: var(--jade); }
.node[data-visual-role="landmark"] .node-kind,
.node[data-visual-role="landmark"] .node-meta { display: none; }
.node[data-visual-role="landmark"] .node-name {
  max-width: 116px;
  margin-top: 0;
  font-size: 12px;
  line-height: 1.2;
}
.node[data-visual-role="index-slip"],
.node[data-visual-role="cinnabar-note"] {
  min-height: 42px;
  max-width: 182px;
  padding: 8px 11px 8px 13px;
  border-radius: 8px 12px 12px 8px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: 0 13px 24px rgba(36, 31, 26, .1), inset 0 0 0 1px rgba(255, 255, 255, .32);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .node[data-visual-role="index-slip"],
.llm-wiki-graph-engine[data-theme="mo-ye"] .node[data-visual-role="cinnabar-note"] {
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  box-shadow: 0 16px 30px rgba(0, 0, 0, .38), inset 0 0 0 1px rgba(245, 240, 230, .09);
}
.node[data-visual-role="cinnabar-note"] {
  border-color: color-mix(in srgb, var(--cinnabar) 78%, transparent);
  box-shadow: 0 17px 30px color-mix(in srgb, var(--cinnabar) 18%, transparent), 0 0 0 4px color-mix(in srgb, var(--cinnabar) 11%, transparent);
}
.node.is-disabled { opacity: .72; }
.node.is-diff-added {
  animation: llm-wiki-node-grow .96s cubic-bezier(.18,.82,.22,1) both;
  animation-delay: var(--diff-delay, 0ms);
}
.node.is-diff-removed {
  animation: llm-wiki-fade-out .72s ease forwards;
}
.node.is-diff-recolored {
  animation: llm-wiki-node-recolor .92s ease both;
}
.mini-map {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 4;
  width: 160px;
  height: 54px;
  border: 1px solid color-mix(in srgb, var(--rule) 86%, transparent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface) 74%, transparent);
  box-shadow: var(--soft-shadow);
}
.llm-wiki-graph-engine[data-theme="mo-ye"] .mini-map,
.llm-wiki-graph-engine[data-theme="mo-ye"] .graph-reader {
  border-color: color-mix(in srgb, var(--line) 34%, transparent);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  box-shadow: var(--soft-shadow), inset 0 0 0 1px rgba(245, 240, 230, .05);
}
.mini-map svg {
  width: 100%;
  height: 100%;
  display: block;
}
.mini-map .is-selected {
  stroke: var(--cinnabar);
  stroke-width: 1.5;
}
.mini-map-viewport {
  fill: color-mix(in srgb, var(--cinnabar) 7%, transparent);
  stroke: color-mix(in srgb, var(--cinnabar) 78%, transparent);
  stroke-width: 1.2;
  rx: 3;
  pointer-events: none;
}
.graph-reader {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100% - 32px));
  max-height: calc(100% - 100px);
  border: 1px solid color-mix(in srgb, var(--rule) 82%, transparent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: var(--soft-shadow);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition: opacity .18s ease, transform .18s ease;
}
.graph-reader[data-state="open"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.graph-reader-header {
  position: relative;
  padding: 14px 42px 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--rule) 72%, transparent);
}
.graph-reader-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
}
.graph-reader-meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
}
.graph-reader-meta span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-reader-close {
  position: absolute;
  top: 9px;
  right: 10px;
  width: 26px;
  height: 26px;
  border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  color: var(--ink);
}
.graph-reader-body {
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 14px;
}
.graph-reader-source {
  display: inline-block;
  max-width: 100%;
  margin-bottom: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: top;
  white-space: nowrap;
  color: var(--cinnabar);
  font-size: 12px;
}
.graph-reader-body pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: 13px;
  line-height: 1.65;
}
.graph-reader-empty {
  margin: 0;
  padding: 12px 14px;
  color: var(--muted);
  font-size: 13px;
}
@keyframes llm-wiki-node-grow {
  0% {
    opacity: 0;
    translate: calc(-50% + var(--diff-anchor-dx, 0px)) calc(-50% + var(--diff-anchor-dy, 0px));
    transform: scale(.68);
  }
  100% {
    opacity: 1;
    translate: -50% -50%;
    transform: scale(1);
  }
}
@keyframes llm-wiki-edge-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes llm-wiki-fade-out {
  to { opacity: 0; transform: scale(.82); }
}
@keyframes llm-wiki-node-recolor {
  0% { filter: saturate(.55) brightness(1.18); }
  100% { filter: saturate(1) brightness(1); }
}
@keyframes llm-wiki-community-emerge {
  0% { opacity: 0; transform: scale(.82); }
  100% { transform: scale(1); }
}
`;

function animationDurationMs(diff: GraphDiff): number {
  const stagger = Math.min(diff.addedNodes.length * 55, 550);
  const complexity = (diff.addedEdges.length + diff.removedEdges.length + diff.recoloredNodes.length + diff.newCommunities.length) * 24;
  return Math.min(3000, 1120 + stagger + complexity);
}

function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderMarkdown(markdown: string): string | null {
  const runtime = globalThis as unknown as {
    marked?: { parse?: (input: string, options?: Record<string, unknown>) => string };
    DOMPurify?: { sanitize?: (input: string, options?: Record<string, unknown>) => string };
  };
  if (typeof runtime.marked?.parse !== "function" || typeof runtime.DOMPurify?.sanitize !== "function") return null;
  const html = runtime.marked.parse(markdown, { breaks: false, gfm: true });
  return runtime.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-target", "tabindex"] });
}
