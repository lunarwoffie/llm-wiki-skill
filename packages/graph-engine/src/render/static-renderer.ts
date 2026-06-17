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
import { createLiveGraphSimulation, PinState, pinsToPositions } from "../sim";
import { resolveSelectionForCapabilities } from "../select";
import { getCommunityColor, getThemeTokens, themeTokensToCssVars } from "../themes";
import {
  buildRenderableGraph,
  createRenderPathCache,
  makeEdgePathFromPoints,
  nodeDisplayModeForDensity,
  screenEffectiveDensityMode,
  type RenderableGraph,
  type RenderableNode,
  type RenderPositionMap
} from "./model";
import { buildCommunityLegend } from "./legend";
import {
  DEFAULT_RENDERER_VIEWPORT,
  applyRendererViewportTransform,
  createViewportFrameCommitter,
  rendererViewportToMinimapRect,
  viewportAfterResize,
  type RendererViewport,
  type ViewportFrameCommitOptions
} from "./viewport";
import { createGraphRuntimeState, type GraphRuntimeStateSnapshot } from "./state";
import { buildHoverPreview } from "./preview";
import {
  defaultGraphViewportSize,
  sideExitWorldAnchor,
  worldPointDeltaToLayerDelta
} from "./geometry";
import { graphEdgeHoverAnchor, graphNodeHoverAnchor, resolveGraphHoverPreviewPosition } from "./overlays";
import { applyGraphNodeDisplayMode, createGraphNodeElement, type GraphNodeElementHandlers } from "./nodes";
import { createGraphEdgeElement, type GraphEdgeElementHandlers } from "./edges";
import { createCommunityWashElement } from "./community-washes";
import { createGraphMinimap } from "./minimap";
import { createEdgeHoverPreviewContent, createHoverPreviewContent } from "./hover-card";
import { createCommunityLegend, createGraphToolbar, createSearchControl } from "./controls";
import { renderOfflineReader, renderOfflineSelectionPanel } from "./offline-reader";
import { createGraphRootElement, resetGraphRootScroll } from "./host-dom";
import { createGraphHitTargetResolver } from "./hit-testing";
import {
  GraphGestureStateMachine
} from "./gestures";
import {
  nextToolbarPanelState,
  readToolbarPanelState,
  writeToolbarPanelState
} from "./toolbar";
import type { GraphRenderContext, PaintedGraphDom } from "./render-context";
import { createGraphController, type GraphController } from "./controller";

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

export interface StaticGraphRenderer {
  root: HTMLElement;
  graph: RenderableGraph;
  render(next?: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null }): void;
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

const SVG_NS = "http://www.w3.org/2000/svg";

export function createStaticGraphRenderer(container: HTMLElement, options: StaticRendererOptions): StaticGraphRenderer {
  const initialPins = options.pins || {};
  const initialFocus = options.focus || null;
  const pathCache = createRenderPathCache();
  const root = createGraphRootElement(container);
  const toolbarContainer = options.toolbarContainer || root;
  const hasExternalToolbarContainer = toolbarContainer !== root;
  ensureStaticRendererStyles(container.ownerDocument || document);
  const ownerDocument = container.ownerDocument || document;
  let context: GraphRenderContext;
  let controller: GraphController;
  root.addEventListener("scroll", resetRootScroll, { passive: true });
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
    viewportSize
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
    viewportCommitter: createViewportFrameCommitter(commitViewport, root.ownerDocument.defaultView || undefined),
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
    viewportSize,
    setViewportAnimating,
    setGraphHover,
    applyMotionFrame,
    markPinnedNodes,
    focusFitMaxScale: FOCUS_FIT_MAX_SCALE
  });
  context.ownerDocument.addEventListener("keydown", controller.handleDocumentKeydown);
  context.gestureController = controller.bindViewportHandlers();
  bindResizeObserver();

  function render(next: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null } = {}): void {
    assertActive();
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
    const runtimeSnapshot = context.runtimeState.snapshot();
    const renderSelection = rendererSelectionFromRuntimeState(runtimeSnapshot);
    context.graph = buildRenderableGraph(context.data, {
      pins: runtimeSnapshot.pins,
      theme: context.theme,
      selectedNodeId: renderSelection.selectedNodeId,
      selection: renderSelection.selection,
      focus: runtimeSnapshot.focus,
      typeFilters: context.typeFilters,
      pathCache: context.pathCache
    });
    context.runtimeState.setPositions(positionsFromRenderableGraph(context.graph));
    context.availableTypeFilters = context.graph.typeFilters;
    context.searchIndex = undefined;
    context.pinState = new PinState(context.graph, context.runtimeState.snapshot().pins);
    context.hitTargetResolver.refresh();
    applyTheme(context.root, context.theme);
    context.dom = paint(context.root, context.graph, context.theme, Boolean(context.callbacks.onNodeOpen), {
      onNodeClick: (id, additive) => {
        controller.handleNodeClick(id, additive);
      },
      onNodeDoubleClick: (id) => {
        return controller.handleNodeDoubleClick(id);
      },
      onNodePreviewEnter: (id) => {
        scheduleHoverPreview(id);
      },
      onEdgePreviewEnter: (id) => {
        showEdgeHoverPreview(id);
      },
      onEdgePreviewLeave: () => {
        clearHoverPreview();
      },
      onNodePreviewLeave: () => {
        clearHoverPreview();
      }
    });
    context.lastEffectiveDensityMode = null;
    mountSearchControl();
    mountGraphToolbar();
    controller.applySearchQuery(context.searchQuery);
    applyCommunityHover();
    commitViewport(context.runtimeState.snapshot().viewport);
    if (context.activeDiff && context.root.dataset.diffState === "playing") markDiffElements(context.activeDiff);
    renderReader();
    renderSelectionPanel();
    renderHoverPreview();
    restartSimulation();
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
      return animateDiff(diff, animationOptions);
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
      context.runtimeState.setPins(nextPins);
      render();
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
      context.runtimeState.setSelection(nextSelection, "selection-panel");
      render();
    },
    clearSelection(): void {
      controller.retreatFocusedView();
    },
    clearInteraction(): void {
      controller.clearInteractionState();
    },
    resetLayout(): void {
      const nextState = context.pinState.reset();
      context.runtimeState.setPins(nextState.pins);
      render();
      context.callbacks.onPinsChanged?.(nextState.pins);
    },
    destroy(): void {
      if (context.destroyed) return;
      context.destroyed = true;
      context.simulation?.destroy();
      context.simulation = null;
      context.resizeObserver?.disconnect();
      context.resizeObserver = null;
      context.root.removeEventListener("scroll", resetRootScroll);
      context.ownerDocument.removeEventListener("keydown", controller.handleDocumentKeydown);
      context.gestureController?.destroy();
      context.gestureController = null;
      if (context.previewTimer) clearTimeout(context.previewTimer);
      if (context.viewportAnimationTimer) clearTimeout(context.viewportAnimationTimer);
      context.pathCache.clear();
      context.root.remove();
      if (context.hasExternalToolbarContainer && context.dom.toolbarElement && context.toolbarContainer.contains(context.dom.toolbarElement)) {
        context.toolbarContainer.replaceChildren();
      }
    }
  };

  function rendererSelectionFromRuntimeState(snapshot: GraphRuntimeStateSnapshot): { selectedNodeId: NodeId | null; selection: SelectionInput | null } {
    if (snapshot.selectionSurface === "reader" && snapshot.selection?.kind === "node") {
      return { selectedNodeId: snapshot.selection.id, selection: null };
    }
    return { selectedNodeId: null, selection: snapshot.selection };
  }

  function panelSelection(snapshot: GraphRuntimeStateSnapshot = context.runtimeState.snapshot()): SelectionInput | null {
    return snapshot.selectionSurface === "selection-panel" ? snapshot.selection : null;
  }

  function readerNodeId(snapshot: GraphRuntimeStateSnapshot = context.runtimeState.snapshot()): NodeId | null {
    return snapshot.selectionSurface === "reader" && snapshot.selection?.kind === "node" ? snapshot.selection.id : null;
  }

  function assertActive(): void {
    if (context.destroyed) throw new Error("Graph renderer has been destroyed");
  }

  function mountSearchControl(): void {
    const control = createSearchControl(context.ownerDocument, {
      open: context.searchOpen,
      query: context.searchQuery,
      onOpen: () => controller.openSearch(),
      onQuery: (query) => controller.applySearchQuery(query),
      onNext: () => controller.focusNextSearchResult(),
      onClose: () => controller.closeSearch()
    });
    context.dom.searchElement = control.element;
    context.dom.searchInput = control.input;
    context.dom.searchStatusElement = control.status;
    context.root.prepend(control.element);
    context.root.dataset.searchOpen = context.searchOpen ? "true" : "false";
  }

  function mountCommunityLegend(): void {
    const rows = buildCommunityLegend(context.graph.communities, context.graph.nodes);
    const legend = createCommunityLegend(context.ownerDocument, {
      rows,
      collapsed: context.legendCollapsed,
      onToggle: () => {
        context.legendCollapsed = !context.legendCollapsed;
        writeLegendCollapsed(context.ownerDocument, context.legendCollapsed);
        mountCommunityLegend();
      },
      onHover: (id) => {
        setGraphHover(id ? { kind: "community", id } : null);
        applyCommunityHover();
      },
      onSelect: (id) => controller.selectCommunity(id)
    });
    context.dom.legendElement = legend.element;
    context.dom.legendRows = legend.rows;
    context.root.dataset.legendCollapsed = context.legendCollapsed ? "true" : "false";
  }

  function mountGraphToolbar(): void {
    mountCommunityLegend();
    const toolbar = createGraphToolbar(context.ownerDocument, {
      panelState: context.toolbarPanelState,
      typeFilters: context.graph.typeFilters,
      onPanelToggle: (panel) => {
        context.toolbarPanelState = nextToolbarPanelState(context.toolbarPanelState, panel);
        writeToolbarPanelState(context.ownerDocument.defaultView?.localStorage, context.toolbarPanelState);
        render();
      },
      onTypeFilterToggle: (type, enabled) => {
        render({ typeFilters: { ...context.availableTypeFilters, [type]: enabled } });
      },
      onReset: () => {
        controller.resetViewState();
      }
    });
    if (context.dom.legendElement) toolbar.filtersPanel.appendChild(context.dom.legendElement);
    context.dom.toolbarElement = toolbar.element;
    context.dom.toolbarPanelElement = toolbar.panel;
    if (context.hasExternalToolbarContainer) {
      context.toolbarContainer.replaceChildren(toolbar.element);
    } else {
      context.root.prepend(toolbar.element);
    }
    context.root.dataset.toolbarPanel = context.toolbarPanelState;
    context.root.dataset.toolbarOpen = context.toolbarPanelState === "closed" ? "false" : "true";
    context.toolbarContainer.dataset.toolbarPanel = context.toolbarPanelState;
    context.toolbarContainer.dataset.toolbarOpen = context.toolbarPanelState === "closed" ? "false" : "true";
  }

  function applyCommunityHover(): void {
    const hover = context.runtimeState.snapshot().hover;
    const active = hover?.kind === "community" ? hover.id : null;
    context.root.dataset.legendHover = active || "";
    for (const [id, row] of context.dom.legendRows) {
      row.dataset.communityState = active ? (id === active ? "active" : "faded") : "none";
    }
    const nodeCommunity = new Map<string, string>();
    for (const [id, element] of context.dom.nodeElements) {
      const community = element.dataset.community || "";
      nodeCommunity.set(id, community);
      element.dataset.communityState = active ? (community === active ? "active" : "faded") : "none";
    }
    for (const [id, element] of context.dom.communityWashElements) {
      element.dataset.communityState = active ? (id === active ? "active" : "faded") : "none";
    }
    for (const edge of context.graph.edges) {
      const element = context.dom.edgeElements.get(edge.id);
      if (!element) continue;
      const inCommunity = nodeCommunity.get(edge.source) === active && nodeCommunity.get(edge.target) === active;
      element.dataset.communityState = active ? (inCommunity ? "active" : "faded") : "none";
    }
  }

  function restartSimulation(): void {
    context.simulation?.destroy();
    context.simulation = null;
    if (options.live === false || !context.graph.nodes.length) return;
    context.simulation = createLiveGraphSimulation(context.graph, {
      onTick: (snapshot) => applyMotionFrame(snapshot.positions)
    });
    for (const [id, position] of Object.entries(pinsToPositions(context.graph, context.runtimeState.snapshot().pins))) {
      context.simulation.setFixed(id, position);
    }
    context.simulation.startCold();
    markPinnedNodes(context.pinState.snapshot().pinnedNodeIds);
  }

  function applyMotionFrame(positions: RenderPositionMap): void {
    if (context.destroyed) return;
    const snapshot = context.runtimeState.setPositions(positions);
    const renderSelection = rendererSelectionFromRuntimeState(snapshot);
    const previousWorldBounds = context.graph.worldBounds;
    context.graph = buildRenderableGraph(context.data, {
      pins: snapshot.pins,
      theme: context.theme,
      selectedNodeId: renderSelection.selectedNodeId,
      selection: renderSelection.selection,
      focus: snapshot.focus,
      typeFilters: context.typeFilters,
      positions: snapshot.positions,
      pathCache: context.pathCache
    });
    context.hitTargetResolver.refresh();
    const worldBoundsChanged = !sameWorldBounds(previousWorldBounds, context.graph.worldBounds);
    if (worldBoundsChanged && context.dom.svgElement) setGraphSvgViewBox(context.dom.svgElement, context.graph);
    const nodeById = new Map(context.graph.nodes.map((node) => [node.id, node]));
    const size = viewportSize();
    for (const node of context.graph.nodes) {
      const element = context.dom.nodeElements.get(node.id);
      const base = context.dom.basePoints.get(node.id);
      if (!element || !base) continue;
      if (worldBoundsChanged) {
        element.style.left = `${node.x}%`;
        element.style.top = `${node.y}%`;
        element.style.translate = "calc(-50% + 0px) calc(-50% + 0px)";
        context.dom.basePoints.set(node.id, node.point);
      } else {
        const layerDelta = worldPointDeltaToLayerDelta(base, node.point, size, context.graph.worldBounds);
        element.style.translate = `calc(-50% + ${round(layerDelta.x)}px) calc(-50% + ${round(layerDelta.y)}px)`;
      }
      element.dataset.liveX = String(round(node.point.x));
      element.dataset.liveY = String(round(node.point.y));
      element.dataset.worldX = String(round(node.point.x));
      element.dataset.worldY = String(round(node.point.y));
    }
    for (const edge of context.graph.edges) {
      const element = context.dom.edgeElements.get(edge.id);
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!element || !source || !target) continue;
      element.setAttribute("d", makeEdgePathFromPoints(source.point, target.point, edge.curveOffset));
    }
    for (const community of context.graph.communities) {
      const element = context.dom.communityWashElements.get(community.id);
      if (!element || !community.wash) continue;
      element.setAttribute("cx", String(community.wash.cx));
      element.setAttribute("cy", String(community.wash.cy));
      element.setAttribute("rx", String(community.wash.rx));
      element.setAttribute("ry", String(community.wash.ry));
      element.setAttribute("opacity", String(community.wash.opacity));
    }
    for (const miniNode of context.graph.minimap.nodes) {
      const element = context.dom.miniNodeElements.get(miniNode.id);
      if (!element) continue;
      element.setAttribute("cx", String(miniNode.x));
      element.setAttribute("cy", String(miniNode.y));
    }
    renderMotionOverlays();
  }

  function markPinnedNodes(pinnedNodeIds: string[]): void {
    const pinned = new Set(pinnedNodeIds);
    context.root.dataset.pinnedCount = String(pinned.size);
    for (const [id, element] of context.dom.nodeElements) {
      element.classList.toggle("is-pinned", pinned.has(id));
      element.dataset.pinned = pinned.has(id) ? "true" : "false";
    }
  }

  function bindResizeObserver(): void {
    const ViewResizeObserver = context.root.ownerDocument.defaultView?.ResizeObserver;
    if (!ViewResizeObserver) return;
    context.lastViewportSize = viewportSize();
    context.resizeObserver = new ViewResizeObserver(() => {
      const previous = context.lastViewportSize;
      const next = viewportSize();
      if (Math.abs(previous.width - next.width) < 1 && Math.abs(previous.height - next.height) < 1) return;
      context.lastViewportSize = next;
      const selectedReaderNodeId = readerNodeId();
      const anchorPoint = selectedReaderNodeId
        ? context.graph.nodes.find((node) => node.id === selectedReaderNodeId)?.point ?? null
        : null;
      setViewportAnimating(false);
      commitViewport(viewportAfterResize(context.runtimeState.snapshot().viewport, previous, next, { anchorPoint, worldBounds: context.graph.worldBounds }));
    });
    context.resizeObserver.observe(context.root);
  }

  function commitViewport(nextViewport: RendererViewport, options: ViewportFrameCommitOptions = {}): void {
    resetRootScroll();
    const snapshot = context.runtimeState.setViewport(nextViewport);
    const next = snapshot.viewport;
    context.root.dataset.viewportScale = String(round(next.scale));
    if (context.dom.contentLayer) applyRendererViewportTransform(context.dom.contentLayer, next);
    if (!options.lightweight) updateEffectiveDensity();
    updateMinimapViewport();
    if (!options.lightweight) renderMotionOverlays();
  }

  function updateEffectiveDensity(): void {
    const densityMode = screenEffectiveDensityMode(context.graph.counts.visibleNodes, context.runtimeState.snapshot().viewport.scale);
    context.root.dataset.density = densityMode;
    context.root.dataset.effectiveDensity = densityMode;
    if (densityMode === context.lastEffectiveDensityMode) return;
    context.lastEffectiveDensityMode = densityMode;
    for (const node of context.graph.nodes) {
      const element = context.dom.nodeElements.get(node.id);
      if (!element) continue;
      applyGraphNodeDisplayMode(element, nodeDisplayModeForDensity(node, densityMode));
    }
  }

  function renderMotionOverlays(): void {
    if (context.dom.readerElement?.dataset.state === "open") renderReader();
    if (context.dom.selectionElement?.dataset.state === "open") renderSelectionPanel();
    const hover = context.runtimeState.snapshot().hover;
    if (hover?.kind === "node" || hover?.kind === "edge" || context.dom.previewElement?.dataset.state === "open") renderHoverPreview();
  }

  function updateMinimapViewport(): void {
    if (!context.dom.miniViewportElement) return;
    const rect = rendererViewportToMinimapRect(context.runtimeState.snapshot().viewport, viewportSize(), { worldBounds: context.graph.worldBounds });
    context.dom.miniViewportElement.setAttribute("x", String(round(rect.x)));
    context.dom.miniViewportElement.setAttribute("y", String(round(rect.y)));
    context.dom.miniViewportElement.setAttribute("width", String(round(rect.width)));
    context.dom.miniViewportElement.setAttribute("height", String(round(rect.height)));
  }

  function setViewportAnimating(enabled: boolean): void {
    if (context.viewportAnimationTimer) {
      clearTimeout(context.viewportAnimationTimer);
      context.viewportAnimationTimer = null;
    }
    context.root.dataset.viewportAnimating = enabled ? "true" : "false";
    context.dom.contentLayer?.classList.toggle("is-viewport-animating", enabled);
    if (enabled) {
      context.viewportAnimationTimer = setTimeout(() => setViewportAnimating(false), 240);
    }
  }

  function viewportSize(): { width: number; height: number } {
    const rect = context.root.getBoundingClientRect();
    const fallback = defaultGraphViewportSize();
    return {
      width: Math.max(1, rect.width || fallback.width),
      height: Math.max(1, rect.height || fallback.height)
    };
  }

  function resetRootScroll(): void {
    resetGraphRootScroll(context.root);
  }

  async function animateDiff(diff: GraphDiff, animationOptions: { reducedMotion?: boolean; durationMs?: number }): Promise<void> {
    if (context.destroyed) return;
    const reducedMotion = animationOptions.reducedMotion ?? prefersReducedMotion(context.root.ownerDocument || document);
    context.activeDiff = diff;
    context.root.dataset.diffState = reducedMotion ? "settled" : "playing";
    context.root.dataset.diffAddedNodes = String(diff.addedNodes.length);
    context.root.dataset.diffAddedEdges = String(diff.addedEdges.length);
    context.root.dataset.diffRemovedNodes = String(diff.removedNodes.length);
    context.root.dataset.diffNewCommunities = String(diff.newCommunities.length);
    markDiffElements(diff);
    if (reducedMotion) {
      context.root.dataset.diffReducedMotion = "true";
      settleDiffElements();
      return;
    }
    delete context.root.dataset.diffReducedMotion;
    const durationMs = clamp(animationOptions.durationMs ?? animationDurationMs(diff), 420, 3000);
    await wait(durationMs);
    if (!context.destroyed) settleDiffElements();
  }

  function markDiffElements(diff: GraphDiff): void {
    const addedNodes = new Set(diff.addedNodes);
    const removedNodes = new Set(diff.removedNodes);
    const recoloredNodes = new Set(diff.recoloredNodes.map((item) => item.id));
    const addedEdges = new Set(diff.addedEdges);
    const removedEdges = new Set(diff.removedEdges);
    const newCommunities = new Set(diff.newCommunities);
    for (const [id, element] of context.dom.nodeElements) {
      element.classList.toggle("is-diff-added", addedNodes.has(id));
      element.classList.toggle("is-diff-removed", removedNodes.has(id));
      element.classList.toggle("is-diff-recolored", recoloredNodes.has(id));
      const delay = diff.addedNodes.indexOf(id);
      element.style.setProperty("--diff-delay", delay >= 0 ? `${Math.min(delay * 55, 550)}ms` : "0ms");
      const anchor = addedNodes.has(id) ? semanticAnchorForNode(id) : null;
      if (anchor) {
        element.style.setProperty("--diff-anchor-dx", `${round(anchor.x - (context.graph.nodes.find((node) => node.id === id)?.point.x ?? anchor.x))}px`);
        element.style.setProperty("--diff-anchor-dy", `${round(anchor.y - (context.graph.nodes.find((node) => node.id === id)?.point.y ?? anchor.y))}px`);
      } else {
        element.style.removeProperty("--diff-anchor-dx");
        element.style.removeProperty("--diff-anchor-dy");
      }
    }
    for (const [id, element] of context.dom.edgeElements) {
      element.classList.toggle("is-diff-added", addedEdges.has(id));
      element.classList.toggle("is-diff-removed", removedEdges.has(id));
      if (addedEdges.has(id)) {
        const length = Math.max(1, Math.ceil(typeof element.getTotalLength === "function" ? element.getTotalLength() : 180));
        element.style.setProperty("--diff-edge-length", String(length));
      } else {
        element.style.removeProperty("--diff-edge-length");
      }
    }
    for (const [id, element] of context.dom.communityWashElements) {
      element.classList.toggle("is-diff-new-community", newCommunities.has(id));
    }
  }

  function settleDiffElements(): void {
    context.activeDiff = null;
    context.root.dataset.diffState = "settled";
    for (const element of context.dom.nodeElements.values()) {
      element.classList.remove("is-diff-added", "is-diff-removed", "is-diff-recolored");
      element.style.removeProperty("--diff-anchor-dx");
      element.style.removeProperty("--diff-anchor-dy");
      element.style.removeProperty("--diff-delay");
    }
    for (const element of context.dom.edgeElements.values()) {
      element.classList.remove("is-diff-added", "is-diff-removed");
      element.style.removeProperty("--diff-edge-length");
    }
    for (const element of context.dom.communityWashElements.values()) {
      element.classList.remove("is-diff-new-community");
    }
  }

  function semanticAnchorForNode(id: NodeId): { x: number; y: number } | null {
    const node = context.graph.nodes.find((item) => item.id === id);
    if (!node) return null;
    const neighborId = context.graph.edges
      .filter((edge) => edge.source === id || edge.target === id)
      .map((edge) => edge.source === id ? edge.target : edge.source)
      .find((candidate) => candidate !== id);
    const neighbor = neighborId ? context.graph.nodes.find((item) => item.id === neighborId) : null;
    if (neighbor) return neighbor.point;
    return sideExitWorldAnchor(node.point, 80, context.graph.worldBounds);
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
    const size = viewportSize();
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
    const size = viewportSize();
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

interface DragHandlers extends GraphNodeElementHandlers, GraphEdgeElementHandlers {
  onNodeClick: (id: NodeId, additive: boolean) => void;
  onNodeDoubleClick: (id: string) => boolean;
  onNodePreviewEnter: (id: NodeId) => void;
  onEdgePreviewEnter: (id: string) => void;
  onEdgePreviewLeave: () => void;
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
  setGraphSvgViewBox(svg, graph);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  painted.svgElement = svg;

  const washLayer = document.createElementNS(SVG_NS, "g");
  washLayer.setAttribute("class", "community-wash-layer");
  for (const community of graph.communities) {
    const ellipse = createCommunityWashElement(root.ownerDocument, community);
    if (!ellipse) continue;
    washLayer.appendChild(ellipse);
    painted.communityWashElements.set(community.id, ellipse);
  }
  svg.appendChild(washLayer);

  const edgeLayer = document.createElementNS(SVG_NS, "g");
  edgeLayer.setAttribute("class", "edge-layer");
  for (const edge of graph.edges) {
    const path = createGraphEdgeElement(root.ownerDocument, edge, dragHandlers);
    edgeLayer.appendChild(path);
    painted.edgeElements.set(edge.id, path);
  }
  svg.appendChild(edgeLayer);
  contentLayer.appendChild(svg);

  const nodeLayer = document.createElement("div");
  nodeLayer.className = "node-layer";
  for (const node of graph.nodes) {
    const button = createGraphNodeElement(root.ownerDocument, node, dragHandlers);
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

  const minimap = createGraphMinimap(root.ownerDocument, graph.minimap);
  painted.miniViewportElement = minimap.viewportElement;
  painted.miniNodeElements = minimap.nodeElements;
  root.appendChild(minimap.element);
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

function positionsFromRenderableGraph(graph: RenderableGraph): RenderPositionMap {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.point.x, y: node.point.y }]));
}

function initialViewportSize(root: HTMLElement): { width: number; height: number } {
  const rect = root.getBoundingClientRect();
  const fallback = defaultGraphViewportSize();
  return { width: rect.width || fallback.width, height: rect.height || fallback.height };
}

function emptyPaintedDom(): PaintedGraphDom {
  return {
    contentLayer: null,
    svgElement: null,
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

function setGraphSvgViewBox(svg: SVGSVGElement, graph: RenderableGraph): void {
  svg.setAttribute(
    "viewBox",
    `${round(graph.worldBounds.minX)} ${round(graph.worldBounds.minY)} ${round(graph.worldBounds.width)} ${round(graph.worldBounds.height)}`
  );
}

function sameWorldBounds(left: RenderableGraph["worldBounds"], right: RenderableGraph["worldBounds"]): boolean {
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY
    && left.width === right.width
    && left.height === right.height;
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
  overscroll-behavior: contain;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
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
  touch-action: auto;
  user-select: text;
  -webkit-user-select: text;
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
  user-select: none;
  -webkit-user-select: none;
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
  touch-action: auto;
  user-select: text;
  -webkit-user-select: text;
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
  touch-action: auto;
  user-select: text;
  -webkit-user-select: text;
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
  touch-action: auto;
  user-select: text;
  -webkit-user-select: text;
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
