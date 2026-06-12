import type { CommunityId, GraphData, GraphDiff, NodeId, PinMap, SelectionInput, ThemeId, WikiPath } from "../types";
import { createLiveGraphSimulation, PinState, pinsToPositions, type LiveGraphSimulation } from "../sim";
import { getCommunityColor, getThemeTokens, themeTokensToCssVars } from "../themes";
import {
  buildRenderableGraph,
  createRenderPathCache,
  makeEdgePathFromPoints,
  type RenderableGraph,
  type RenderableNode,
  type RenderPositionMap
} from "./model";

interface StaticRendererOptions {
  data: GraphData;
  pins?: PinMap;
  theme: ThemeId;
  onOpenPage?: (path: WikiPath) => void;
  onSelect?: (selection: SelectionInput) => void;
  persistPins?: (pins: PinMap) => Promise<void>;
  onDragStateChange?: (dragging: boolean) => void;
  live?: boolean;
}

export interface StaticGraphRenderer {
  root: HTMLElement;
  graph: RenderableGraph;
  render(next?: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null }): void;
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
  setTheme(theme: ThemeId): void;
  focusNode(pathOrId: WikiPath): void;
  select(selection: SelectionInput): void;
  resetLayout(): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 680;

interface PaintedGraphDom {
  edgeElements: Map<string, SVGPathElement>;
  communityWashElements: Map<string, SVGEllipseElement>;
  nodeElements: Map<string, HTMLButtonElement>;
  miniNodeElements: Map<string, SVGCircleElement>;
  basePoints: Map<string, { x: number; y: number }>;
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
  let activeDiff: GraphDiff | null = null;
  const pathCache = createRenderPathCache();
  const root = document.createElement("div");
  root.className = "llm-wiki-graph-engine";
  root.dataset.llmWikiGraphRoot = "true";
  container.replaceChildren(root);
  ensureStaticRendererStyles(container.ownerDocument || document);

  let graph = buildRenderableGraph(data, { pins, theme, selectedNodeId, selection, pathCache });
  let pinState = new PinState(graph, pins);

  function render(next: Partial<StaticRendererOptions> & { selectedNodeId?: string | null; selection?: SelectionInput | null } = {}): void {
    assertActive();
    data = next.data || data;
    pins = next.pins || pins;
    theme = next.theme || theme;
    if (Object.hasOwn(next, "selectedNodeId")) selectedNodeId = next.selectedNodeId || null;
    if (Object.hasOwn(next, "selection")) selection = next.selection || null;
    graph = buildRenderableGraph(data, { pins, theme, selectedNodeId, selection, pathCache });
    pinState = new PinState(graph, pins);
    applyTheme(root, theme);
    dom = paint(root, graph, theme, options.onOpenPage, {
      onCommunitySelect: (id) => {
        manualNodeIds = [];
        const nextSelection: SelectionInput = { kind: "community", id };
        selection = nextSelection;
        options.onSelect?.(nextSelection);
        render({ selection: nextSelection });
      },
      onNodeSelect: (id, additive) => {
        const nextSelection = additive
          ? shiftSelection(id, manualNodeIds.length ? manualNodeIds : selectedNodeIds(selection))
          : { kind: "node" as const, id };
        manualNodeIds = nextSelection.kind === "nodes" ? nextSelection.ids : nextSelection.kind === "node" ? [nextSelection.id] : [];
        selection = nextSelection;
        options.onSelect?.(nextSelection);
        render({ selection: nextSelection });
      },
      onDragStart: (id, event) => {
        if (!simulation) return;
        simulation.beginDrag(id);
        simulation.dragTo(id, eventToGraphPoint(root, event));
        root.dataset.dragging = id;
        options.onDragStateChange?.(true);
      },
      onDragMove: (id, event) => {
        if (!simulation || root.dataset.dragging !== id) return;
        simulation.dragTo(id, eventToGraphPoint(root, event));
      },
      onDragEnd: (id) => {
        if (!simulation || root.dataset.dragging !== id) return;
        const snapshot = simulation.endDrag({ keepFixed: true });
        const position = snapshot.positions[id];
        if (position) {
          const nextState = pinState.pin(id, position);
          pins = nextState.pins;
          applyMotionFrame(snapshot.positions);
          markPinnedNodes(nextState.pinnedNodeIds);
          void options.persistPins?.(nextState.pins);
        }
        delete root.dataset.dragging;
        options.onDragStateChange?.(false);
      },
      onNodeDoubleClick: (id) => {
        if (!pinState.isPinned(id)) return false;
        const nextState = pinState.unpin(id);
        pins = nextState.pins;
        simulation?.setFixed(id, null);
        markPinnedNodes(nextState.pinnedNodeIds);
        void options.persistPins?.(nextState.pins);
        return true;
      }
    });
    if (activeDiff && root.dataset.diffState === "playing") markDiffElements(activeDiff);
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
      return Boolean(root.dataset.dragging);
    },
    setTheme(nextTheme: ThemeId): void {
      render({ theme: nextTheme });
    },
    focusNode(pathOrId: WikiPath): void {
      const node = graph.nodes.find((item) => item.id === pathOrId || item.sourcePath === pathOrId);
      render({ selectedNodeId: node ? node.id : pathOrId });
      root.dataset.focus = pathOrId;
    },
    select(nextSelection: SelectionInput): void {
      manualNodeIds = nextSelection.kind === "nodes" ? nextSelection.ids : [];
      render({ selection: nextSelection });
    },
    resetLayout(): void {
      const nextState = pinState.reset();
      pins = nextState.pins;
      render({ pins });
      void options.persistPins?.(nextState.pins);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      simulation?.destroy();
      simulation = null;
      pathCache.clear();
      root.remove();
    }
  };

  function assertActive(): void {
    if (destroyed) throw new Error("Graph renderer has been destroyed");
  }

  function restartSimulation(): void {
    simulation?.destroy();
    simulation = null;
    if (options.live === false || !graph.nodes.length) return;
    simulation = createLiveGraphSimulation(graph, {
      onTick: (snapshot) => applyMotionFrame(snapshot.positions)
    });
    for (const [id, position] of Object.entries(pinsToPositions(graph, pins))) {
      simulation.setFixed(id, position);
    }
    simulation.startCold();
    markPinnedNodes(pinState.snapshot().pinnedNodeIds);
  }

  function applyMotionFrame(positions: RenderPositionMap): void {
    if (destroyed) return;
    graph = buildRenderableGraph(data, { pins, theme, selectedNodeId, selection, positions, pathCache });
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes) {
      const element = dom.nodeElements.get(node.id);
      const base = dom.basePoints.get(node.id);
      if (!element || !base) continue;
      const dx = node.point.x - base.x;
      const dy = node.point.y - base.y;
      element.style.translate = `calc(-50% + ${round(dx)}px) calc(-50% + ${round(dy)}px)`;
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
  }

  function markPinnedNodes(pinnedNodeIds: string[]): void {
    const pinned = new Set(pinnedNodeIds);
    root.dataset.pinnedCount = String(pinned.size);
    for (const [id, element] of dom.nodeElements) {
      element.classList.toggle("is-pinned", pinned.has(id));
      element.dataset.pinned = pinned.has(id) ? "true" : "false";
    }
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
      x: node.point.x < WORLD_WIDTH / 2 ? -80 : WORLD_WIDTH + 80,
      y: clamp(node.point.y, 80, WORLD_HEIGHT - 80)
    };
  }
}

interface DragHandlers {
  onCommunitySelect: (id: CommunityId) => void;
  onNodeSelect: (id: NodeId, additive: boolean) => void;
  onDragStart: (id: string, event: PointerEvent) => void;
  onDragMove: (id: string, event: PointerEvent) => void;
  onDragEnd: (id: string, event: PointerEvent) => void;
  onNodeDoubleClick: (id: string) => boolean;
}

function paint(
  root: HTMLElement,
  graph: RenderableGraph,
  theme: ThemeId,
  onOpenPage: ((path: WikiPath) => void) | undefined,
  dragHandlers: DragHandlers
): PaintedGraphDom {
  root.replaceChildren();
  root.dataset.theme = theme;
  root.dataset.density = graph.densityMode;
  const painted = emptyPaintedDom();

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
    ellipse.addEventListener("click", (event) => {
      event.stopPropagation();
      dragHandlers.onCommunitySelect(community.id);
    });
    washLayer.appendChild(ellipse);
    painted.communityWashElements.set(community.id, ellipse);
  }
  svg.appendChild(washLayer);

  const edgeLayer = document.createElementNS(SVG_NS, "g");
  edgeLayer.setAttribute("class", "edge-layer");
  for (const edge of graph.edges) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", edge.path);
    path.setAttribute("class", `edge ${edge.type}`);
    path.setAttribute("data-from", edge.source);
    path.setAttribute("data-to", edge.target);
    path.setAttribute("data-edge-id", edge.id);
    path.style.strokeWidth = String(edge.strokeWidth);
    path.style.opacity = String(edge.opacity);
    edgeLayer.appendChild(path);
    painted.edgeElements.set(edge.id, path);
  }
  svg.appendChild(edgeLayer);
  root.appendChild(svg);

  const nodeLayer = document.createElement("div");
  nodeLayer.className = "node-layer";
  for (const node of graph.nodes) {
    const button = createNodeButton(node, onOpenPage, dragHandlers);
    painted.nodeElements.set(node.id, button);
    painted.basePoints.set(node.id, node.point);
    nodeLayer.appendChild(button);
  }
  root.appendChild(nodeLayer);

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
  return painted;
}

function createNodeButton(node: RenderableNode, onOpenPage: ((path: WikiPath) => void) | undefined, dragHandlers: DragHandlers): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "node";
  if (node.unavailable) button.classList.add("is-disabled");
  if (node.displayMode === "compact-card") button.classList.add("is-compact");
  if (node.displayMode === "point") button.classList.add("is-point");
  if (node.displayMode === "overview") button.classList.add("is-overview");
  if (node.previewStart) button.classList.add("is-preview-start");
  if (!node.labelVisible) button.classList.add("is-label-hidden");
  button.type = "button";
  button.dataset.id = node.id;
  button.dataset.type = node.type;
  button.dataset.community = node.community;
  button.dataset.densityMode = node.displayMode;
  button.dataset.visualRole = node.visualRole;
  button.dataset.startNode = node.startNode ? "true" : "false";
  button.dataset.previewStart = node.previewStart ? "true" : "false";
  button.style.left = `${node.x}%`;
  button.style.top = `${node.y}%`;
  button.title = node.label;
  button.setAttribute("aria-pressed", node.selected ? "true" : "false");
  button.addEventListener("dblclick", () => {
    if (dragHandlers.onNodeDoubleClick(node.id)) return;
    if (node.sourcePath && onOpenPage) onOpenPage(node.sourcePath);
  });
  bindDragHandlers(button, node.id, dragHandlers);

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

function bindDragHandlers(button: HTMLButtonElement, nodeId: string, handlers: DragHandlers): void {
  let dragging = false;
  let moved = false;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    button.classList.add("is-dragging");
    button.setPointerCapture(event.pointerId);
    handlers.onDragStart(nodeId, event);
  });
  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    moved = true;
    handlers.onDragMove(nodeId, event);
  });
  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    button.classList.remove("is-dragging");
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    handlers.onDragEnd(nodeId, event);
  };
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("click", (event) => {
    if (moved) {
      moved = false;
      return;
    }
    event.stopPropagation();
    handlers.onNodeSelect(nodeId, event.shiftKey);
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

function eventToGraphPoint(root: HTMLElement, event: PointerEvent): { x: number; y: number } {
  const rect = root.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width) * WORLD_WIDTH, 0, WORLD_WIDTH),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height) * WORLD_HEIGHT, 0, WORLD_HEIGHT)
  };
}

function emptyPaintedDom(): PaintedGraphDom {
  return {
    edgeElements: new Map(),
    communityWashElements: new Map(),
    nodeElements: new Map(),
    miniNodeElements: new Map(),
    basePoints: new Map()
  };
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
}
.edge.is-diff-added {
  stroke-dasharray: var(--diff-edge-length, 180);
  stroke-dashoffset: var(--diff-edge-length, 180);
  animation: llm-wiki-edge-draw 1.15s ease forwards;
}
.edge.is-diff-removed {
  animation: llm-wiki-fade-out .72s ease forwards;
}
.edge.extracted { stroke: color-mix(in srgb, var(--night) 74%, transparent); }
.edge.inferred { stroke: color-mix(in srgb, var(--jade) 62%, transparent); stroke-dasharray: 6 8; }
.edge.ambiguous { stroke: color-mix(in srgb, var(--amber) 66%, transparent); stroke-dasharray: 2 7; }
.edge.unverified { stroke: color-mix(in srgb, var(--muted) 45%, transparent); stroke-dasharray: 1 8; }
.community-wash {
  transition: opacity .16s ease, cx .24s ease, cy .24s ease, rx .24s ease, ry .24s ease;
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
}
.node {
  position: absolute;
  z-index: 3;
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
.node[data-type="topic"] { border-left: 5px solid var(--cinnabar); }
.node[data-type="entity"] { border-left: 5px solid var(--night); }
.node[data-type="source"] { border-left: 5px solid var(--jade); }
.node[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--cinnabar) 74%, transparent);
  box-shadow: 0 16px 28px color-mix(in srgb, var(--cinnabar) 16%, transparent), 0 0 0 4px color-mix(in srgb, var(--cinnabar) 10%, transparent);
  transform: translateY(-2px);
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
  display: block;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.node-name {
  display: block;
  max-width: 146px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}
.node-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--faint);
  font-size: 11px;
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
.mini-map svg {
  width: 100%;
  height: 100%;
  display: block;
}
.mini-map .is-selected {
  stroke: var(--cinnabar);
  stroke-width: 1.5;
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
