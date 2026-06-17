import type { GraphDiff, NodeId, SelectionInput, ThemeId } from "../types";
import { createLiveGraphSimulation, PinState, pinsToPositions } from "../sim";
import { getThemeTokens, themeTokensToCssVars } from "../themes";
import { buildCommunityLegend } from "./legend";
import {
  applyGraphNodeDisplayMode,
  createGraphNodeElement,
  type GraphNodeElementHandlers
} from "./nodes";
import {
  createGraphEdgeElement,
  type GraphEdgeElementHandlers
} from "./edges";
import { createCommunityWashElement } from "./community-washes";
import { createGraphMinimap } from "./minimap";
import {
  buildRenderableGraph,
  makeEdgePathFromPoints,
  nodeDisplayModeForDensity,
  screenEffectiveDensityMode,
  type RenderableGraph,
  type RenderPositionMap
} from "./model";
import {
  applyRendererViewportTransform,
  rendererViewportToMinimapRect,
  viewportAfterResize,
  type RendererViewport,
  type ViewportFrameCommitOptions
} from "./viewport";
import { defaultGraphViewportSize, sideExitWorldAnchor, worldPointDeltaToLayerDelta } from "./geometry";
import { createCommunityLegend, createGraphToolbar, createSearchControl } from "./controls";
import { nextToolbarPanelState, writeToolbarPanelState } from "./toolbar";
import type { GraphRuntimeStateSnapshot } from "./state";
import type { GraphRenderContext, PaintedGraphDom } from "./render-context";
import { ensureGraphRendererStyles } from "./render-styles";

const SVG_NS = "http://www.w3.org/2000/svg";
const COMMUNITY_LEGEND_COLLAPSED_KEY = "llm-wiki:graph:community-legend:collapsed";

interface PaintHandlers extends GraphNodeElementHandlers, GraphEdgeElementHandlers {
  onNodeClick: (id: NodeId, additive: boolean) => void;
  onNodeDoubleClick: (id: string) => boolean;
  onNodePreviewEnter: (id: NodeId) => void;
  onEdgePreviewEnter: (id: string) => void;
  onEdgePreviewLeave: () => void;
  onNodePreviewLeave: () => void;
}

export interface GraphRenderCommands {
  render(next?: { typeFilters?: Record<string, boolean> }): void;
  resetViewState(): void;
  openSearch(): void;
  applySearchQuery(query: string): void;
  focusNextSearchResult(): void;
  closeSearch(): void;
  selectCommunity(id: string): void;
  handleNodeClick(id: NodeId, additive: boolean): void;
  handleNodeDoubleClick(id: string): boolean;
  scheduleHoverPreview(id: NodeId): void;
  showEdgeHoverPreview(id: string): void;
  clearHoverPreview(): void;
}

export interface GraphRenderOverlayDelegates {
  renderReader(): void;
  renderSelectionPanel(): void;
  renderHoverPreview(): void;
}

export interface GraphRenderPipeline {
  rebuildAndPaint(): void;
  paint(graph: RenderableGraph, options: { hasHostReader: boolean; handlers: PaintHandlers }): PaintedGraphDom;
  mountSearchControl(): void;
  mountGraphToolbar(): void;
  mountCommunityLegend(): void;
  applyCommunityHover(): void;
  bindResizeObserver(): void;
  commitViewport(nextViewport: RendererViewport, options?: ViewportFrameCommitOptions): void;
  resetRootScroll(): void;
  updateEffectiveDensity(): void;
  renderMotionOverlays(): void;
  updateMinimapViewport(): void;
  setViewportAnimating(enabled: boolean): void;
  viewportSize(): { width: number; height: number };
  restartSimulation(): void;
  applyMotionFrame(positions: RenderPositionMap): void;
  markPinnedNodes(pinnedNodeIds: string[]): void;
  animateDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  markDiffElements(diff: GraphDiff): void;
  settleDiffElements(): void;
  semanticAnchorForNode(id: NodeId): { x: number; y: number } | null;
  destroy(): void;
}

export interface GraphRenderPipelineOptions {
  commands: GraphRenderCommands;
  overlays: GraphRenderOverlayDelegates;
  hasHostReader: boolean;
  live: boolean;
}

export function createGraphRenderPipeline(
  context: GraphRenderContext,
  options: GraphRenderPipelineOptions
): GraphRenderPipeline {
  ensureGraphRendererStyles(context.ownerDocument);

  function rebuildAndPaint(): void {
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
    context.dom = paint(context.graph, {
      hasHostReader: options.hasHostReader,
      handlers: {
        onNodeClick: (id, additive) => {
          options.commands.handleNodeClick(id, additive);
        },
        onNodeDoubleClick: (id) => {
          return options.commands.handleNodeDoubleClick(id);
        },
        onNodePreviewEnter: (id) => {
          options.commands.scheduleHoverPreview(id);
        },
        onEdgePreviewEnter: (id) => {
          options.commands.showEdgeHoverPreview(id);
        },
        onEdgePreviewLeave: () => {
          options.commands.clearHoverPreview();
        },
        onNodePreviewLeave: () => {
          options.commands.clearHoverPreview();
        }
      }
    });
    context.lastEffectiveDensityMode = null;
    mountSearchControl();
    mountGraphToolbar();
    options.commands.applySearchQuery(context.searchQuery);
    applyCommunityHover();
    commitViewport(context.runtimeState.snapshot().viewport);
    if (context.activeDiff && context.root.dataset.diffState === "playing") markDiffElements(context.activeDiff);
    options.overlays.renderReader();
    options.overlays.renderSelectionPanel();
    options.overlays.renderHoverPreview();
    restartSimulation();
  }

  function paint(graph: RenderableGraph, paintOptions: { hasHostReader: boolean; handlers: PaintHandlers }): PaintedGraphDom {
    context.root.replaceChildren();
    context.root.dataset.theme = context.theme;
    context.root.dataset.baseDensity = graph.densityMode;
    const painted = emptyPaintedDom();
    const contentLayer = context.ownerDocument.createElement("div");
    contentLayer.className = "graph-content-layer";
    contentLayer.dataset.viewportLayer = "true";
    painted.contentLayer = contentLayer;

    const svg = context.ownerDocument.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "llm-wiki-graph-svg");
    setGraphSvgViewBox(svg, graph);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    painted.svgElement = svg;

    const washLayer = context.ownerDocument.createElementNS(SVG_NS, "g");
    washLayer.setAttribute("class", "community-wash-layer");
    for (const community of graph.communities) {
      const ellipse = createCommunityWashElement(context.ownerDocument, community);
      if (!ellipse) continue;
      washLayer.appendChild(ellipse);
      painted.communityWashElements.set(community.id, ellipse);
    }
    svg.appendChild(washLayer);

    const edgeLayer = context.ownerDocument.createElementNS(SVG_NS, "g");
    edgeLayer.setAttribute("class", "edge-layer");
    for (const edge of graph.edges) {
      const path = createGraphEdgeElement(context.ownerDocument, edge, paintOptions.handlers);
      edgeLayer.appendChild(path);
      painted.edgeElements.set(edge.id, path);
    }
    svg.appendChild(edgeLayer);
    contentLayer.appendChild(svg);

    const nodeLayer = context.ownerDocument.createElement("div");
    nodeLayer.className = "node-layer";
    for (const node of graph.nodes) {
      const button = createGraphNodeElement(context.ownerDocument, node, paintOptions.handlers);
      painted.nodeElements.set(node.id, button);
      painted.basePoints.set(node.id, node.point);
      nodeLayer.appendChild(button);
    }
    contentLayer.appendChild(nodeLayer);
    context.root.appendChild(contentLayer);

    const preview = context.ownerDocument.createElement("aside");
    preview.className = "graph-hover-preview";
    preview.dataset.state = "closed";
    preview.setAttribute("aria-live", "polite");
    context.root.appendChild(preview);
    painted.previewElement = preview;

    const minimap = createGraphMinimap(context.ownerDocument, graph.minimap);
    painted.miniViewportElement = minimap.viewportElement;
    painted.miniNodeElements = minimap.nodeElements;
    context.root.appendChild(minimap.element);
    if (!paintOptions.hasHostReader) {
      const reader = context.ownerDocument.createElement("aside");
      reader.className = "graph-reader";
      reader.dataset.state = graph.selectedNodeId ? "open" : "closed";
      context.root.appendChild(reader);
      painted.readerElement = reader;

      const selectionPanel = context.ownerDocument.createElement("aside");
      selectionPanel.className = "graph-selection-panel";
      selectionPanel.dataset.state = "closed";
      context.root.appendChild(selectionPanel);
      painted.selectionElement = selectionPanel;
    }
    return painted;
  }

  function mountSearchControl(): void {
    const control = createSearchControl(context.ownerDocument, {
      open: context.searchOpen,
      query: context.searchQuery,
      onOpen: () => options.commands.openSearch(),
      onQuery: (query) => options.commands.applySearchQuery(query),
      onNext: () => options.commands.focusNextSearchResult(),
      onClose: () => options.commands.closeSearch()
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
        context.runtimeState.setHover(id ? { kind: "community", id } : null);
        applyCommunityHover();
      },
      onSelect: (id) => options.commands.selectCommunity(id)
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
        options.commands.render();
      },
      onTypeFilterToggle: (type, enabled) => {
        options.commands.render({ typeFilters: { ...context.availableTypeFilters, [type]: enabled } });
      },
      onReset: () => {
        options.commands.resetViewState();
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
    if (!options.live || !context.graph.nodes.length) return;
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
      const selectedReaderNodeId = readerNodeId(context);
      const anchorPoint = selectedReaderNodeId
        ? context.graph.nodes.find((node) => node.id === selectedReaderNodeId)?.point ?? null
        : null;
      setViewportAnimating(false);
      commitViewport(viewportAfterResize(context.runtimeState.snapshot().viewport, previous, next, { anchorPoint, worldBounds: context.graph.worldBounds }));
    });
    context.resizeObserver.observe(context.root);
  }

  function commitViewport(nextViewport: RendererViewport, commitOptions: ViewportFrameCommitOptions = {}): void {
    resetRootScroll();
    const snapshot = context.runtimeState.setViewport(nextViewport);
    const next = snapshot.viewport;
    context.root.dataset.viewportScale = String(round(next.scale));
    if (context.dom.contentLayer) applyRendererViewportTransform(context.dom.contentLayer, next);
    if (!commitOptions.lightweight) updateEffectiveDensity();
    updateMinimapViewport();
    if (!commitOptions.lightweight) renderMotionOverlays();
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
    if (context.dom.readerElement?.dataset.state === "open") options.overlays.renderReader();
    if (context.dom.selectionElement?.dataset.state === "open") options.overlays.renderSelectionPanel();
    const hover = context.runtimeState.snapshot().hover;
    if (hover?.kind === "node" || hover?.kind === "edge" || context.dom.previewElement?.dataset.state === "open") options.overlays.renderHoverPreview();
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
    context.root.scrollLeft = 0;
    context.root.scrollTop = 0;
  }

  async function animateDiff(diff: GraphDiff, animationOptions: { reducedMotion?: boolean; durationMs?: number } = {}): Promise<void> {
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

  function destroy(): void {
    context.simulation?.destroy();
    context.simulation = null;
    context.resizeObserver?.disconnect();
    context.resizeObserver = null;
    if (context.viewportAnimationTimer) clearTimeout(context.viewportAnimationTimer);
    context.viewportAnimationTimer = null;
  }

  return {
    rebuildAndPaint,
    paint,
    mountSearchControl,
    mountGraphToolbar,
    mountCommunityLegend,
    applyCommunityHover,
    bindResizeObserver,
    commitViewport,
    resetRootScroll,
    updateEffectiveDensity,
    renderMotionOverlays,
    updateMinimapViewport,
    setViewportAnimating,
    viewportSize,
    restartSimulation,
    applyMotionFrame,
    markPinnedNodes,
    animateDiff,
    markDiffElements,
    settleDiffElements,
    semanticAnchorForNode,
    destroy
  };
}

function rendererSelectionFromRuntimeState(snapshot: GraphRuntimeStateSnapshot): { selectedNodeId: NodeId | null; selection: SelectionInput | null } {
  if (snapshot.selectionSurface === "reader" && snapshot.selection?.kind === "node") {
    return { selectedNodeId: snapshot.selection.id, selection: null };
  }
  return { selectedNodeId: null, selection: snapshot.selection };
}

function readerNodeId(context: GraphRenderContext): NodeId | null {
  const snapshot = context.runtimeState.snapshot();
  return snapshot.selectionSurface === "reader" && snapshot.selection?.kind === "node" ? snapshot.selection.id : null;
}

export function positionsFromRenderableGraph(graph: RenderableGraph): RenderPositionMap {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.point.x, y: node.point.y }]));
}

export function initialViewportSize(root: HTMLElement): { width: number; height: number } {
  const rect = root.getBoundingClientRect();
  const fallback = defaultGraphViewportSize();
  return { width: rect.width || fallback.width, height: rect.height || fallback.height };
}

export function emptyPaintedDom(): PaintedGraphDom {
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

export function readLegendCollapsed(ownerDocument: Document): boolean {
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

export function round(value: number): number {
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

function animationDurationMs(diff: GraphDiff): number {
  const size = diff.addedNodes.length + diff.addedEdges.length + diff.removedNodes.length + diff.removedEdges.length + diff.newCommunities.length;
  return Math.min(2600, 520 + size * 80);
}

function prefersReducedMotion(doc: Document): boolean {
  return Boolean(doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
