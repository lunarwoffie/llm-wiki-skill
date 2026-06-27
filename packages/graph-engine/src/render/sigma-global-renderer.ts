import type { PinMap, PinPosition, ThemeId } from "../types";
import type {
  GraphRendererAdapterData,
  GraphRendererAdapterNode
} from "./adapter";
import {
  bindSigmaGlobalOverlayMouseDrag,
  bindSigmaGlobalOverlayPointerDrag,
  createSigmaGlobalNodeDragSession,
  moveSigmaGlobalNodeDragSession,
  sigmaAdapterDataWithNodePoint,
  sigmaCommunityLabels,
  type SigmaGlobalNodeDragSession
} from "./sigma-global-drag";
import type { GraphScreenPoint } from "./geometry";
import type { GraphGestureTarget } from "./gestures";
import { DEFAULT_RENDERER_VIEWPORT, type RendererViewport, type RendererViewportSize } from "./viewport";
import { overlayPointerScreenPoint, sigmaScreenPointToWorldPoint, sigmaWorldPointToScreenPoint } from "./sigma-coordinates";
import {
  sigmaCommunityCloud,
  sigmaCommunityCloudBasisById,
  sigmaCommunityCloudBasisByIdWithNodePoint,
  sigmaCommunityCloudBasisByIdWithReuse,
  sigmaProjectedCloudHullPoints,
  type SigmaCommunityCloud
} from "./community-cloud-geometry";
import {
  applyOverlayBox,
  applySigmaCloudColor,
  applySigmaCloudGeometry,
  createSigmaCloudSvg,
  createSigmaOverlayRoot,
  nextSigmaCloudFilterSequence,
  sigmaOverlayButton,
  sigmaOverlayPassiveElement,
  sigmaSharedCloudFilterDef,
  type SigmaCloudKind
} from "./sigma-overlay-svg";
import {
  SIGMA_BUTTON_ZOOM_DURATION_MS,
  SIGMA_BUTTON_ZOOM_RATIO,
  SIGMA_CAMERA_MAX_RATIO,
  SIGMA_CAMERA_MIN_RATIO,
  sigmaButtonZoomRatio,
  sigmaWheelZoomRatio,
  type SigmaWheelDeltaLike
} from "./sigma-zoom";
import { preventSigmaDefault } from "./sigma-events";
import type {
  SigmaGlobalCameraState,
  SigmaGlobalGraphologyGraph,
  SigmaGlobalGraphologyRuntime,
  SigmaGlobalRenderer,
  SigmaGlobalRendererCreateOptions,
  SigmaGlobalRendererRuntime,
  SigmaGlobalRendererRuntimeBoundary,
  SigmaGlobalRendererUpdateOptions,
  SigmaGlobalSigmaLike
} from "./sigma-global-types";
import {
  buildSigmaGlobalGraphologyGraph,
  canPatchSigmaGlobalGraphAttributes,
  patchSigmaGlobalGraphAttributes,
  sigmaGlobalNodeSize,
  sigmaGlobalNodeSpotlightState,
  sigmaSelectedCommunityIds,
  sigmaSpotlightCommunityId,
  sigmaSpotlightCommunityIds
} from "./sigma-graphology-model";
import {
  createSigmaGlobalHitProjector,
  sigmaNodeIdFromPayload,
  sigmaScreenPointFromPayload,
  type SigmaGlobalHitInput,
  type SigmaGlobalHitProjector
} from "./sigma-hit-projector";
import {
  maybeAnimateSigmaCommunitySpotlightCamera,
  prefersReducedMotion,
  readCameraState,
  restoreCameraState,
  sigmaGlobalCameraState
} from "./sigma-global-camera";

export type {
  SigmaGlobalCameraState,
  SigmaGlobalGraphologyGraph,
  SigmaGlobalGraphologyRuntime,
  SigmaGlobalRenderer,
  SigmaGlobalRendererCreateOptions,
  SigmaGlobalRendererRuntime,
  SigmaGlobalRendererRuntimeBoundary,
  SigmaGlobalRendererUpdateOptions,
  SigmaGlobalSigmaLike
} from "./sigma-global-types";

export {
  buildSigmaGlobalGraphologyGraph,
  sigmaGlobalEdgeStyle
} from "./sigma-graphology-model";
export type { SigmaGlobalEdgeStyle } from "./sigma-graphology-model";
export { createSigmaGlobalHitProjector } from "./sigma-hit-projector";
export type {
  SigmaGlobalHitInput,
  SigmaGlobalHitProjector,
  SigmaGlobalHitProjectorInput,
  SigmaGlobalRenderedObject
} from "./sigma-hit-projector";

export const SIGMA_GLOBAL_RENDERER_ID = "sigma-global" as const;

export const SIGMA_GLOBAL_RENDERER_ROUTE_MANAGER_OWNER = "facade" as const;

const SIGMA_GLOBAL_COMMUNITY_LABEL_LIMIT = 8;
const SIGMA_GLOBAL_NODE_HIT_TARGET_LIMIT = 160;

export const SIGMA_GLOBAL_RENDERER_BUNDLE_BOUNDARY = {
  sigma: "runtime-loaded-by-sigma-global-renderer",
  graphology: "runtime-loaded-by-sigma-global-renderer",
  workbench: "loads through the graph-engine ESM Sigma runtime boundary when global route manager selects Sigma",
  offlineHtml: "loads through the graph-engine IIFE Sigma runtime boundary when offline global route manager selects Sigma"
} as const;

interface SigmaGlobalWheelPayload {
  x?: unknown;
  y?: unknown;
  delta?: unknown;
  original?: {
    deltaY?: unknown;
    deltaMode?: unknown;
    target?: unknown;
  };
  preventSigmaDefault?: () => void;
}

export async function sigmaGlobalRendererRuntimeBoundary(): Promise<SigmaGlobalRendererRuntimeBoundary> {
  const [{ default: Sigma }, { default: GraphologyGraph }] = await Promise.all([
    import("sigma"),
    import("graphology")
  ]);

  return {
    Sigma,
    GraphologyGraph
  };
}

export function createSigmaGlobalRenderer(options: SigmaGlobalRendererCreateOptions): SigmaGlobalRenderer {
  if (!options.container) {
    throw new Error("createSigmaGlobalRenderer requires a container element");
  }
  if (!options.runtime) {
    throw new Error("createSigmaGlobalRenderer requires a loaded Sigma runtime boundary");
  }

  const runtime = options.runtime;
  let destroyed = false;
  let currentTheme = options.theme;
  let currentEdgeStyle = options.edgeStyle;
  let adapterData = options.adapterData;
  let graph = buildSigmaGlobalGraphologyGraph(adapterData, runtime, currentTheme, currentEdgeStyle);
  const sigmaRoot = createSigmaRoot(options.container, currentTheme);
  const overlayRoot = createSigmaOverlayRoot(sigmaRoot);
  // 云团模糊滤镜内容与帧无关，挂到独立的 filterHost 只建一次，renderSigmaOverlays
  // 每帧 replaceChildren(overlayRoot) 不会动到它。随 sigmaRoot.remove() 一并回收。
  const cloudFilterId = `sigma-community-cloud-blur-${nextSigmaCloudFilterSequence()}`;
  const filterHost = sigmaRoot.ownerDocument.createElement("div");
  filterHost.setAttribute("aria-hidden", "true");
  filterHost.style.position = "absolute";
  filterHost.style.inset = "0";
  filterHost.style.pointerEvents = "none";
  filterHost.append(sigmaSharedCloudFilterDef(sigmaRoot.ownerDocument, cloudFilterId));
  sigmaRoot.append(filterHost);
  let cloudBasisByCommunityId = sigmaCommunityCloudBasisById(adapterData);
  let projector = createSigmaGlobalHitProjector({
    adapterData,
    viewport: options.viewport ?? DEFAULT_RENDERER_VIEWPORT,
    viewportSize: options.viewportSize ?? { width: 1, height: 1 },
    screenPointToWorldPoint: (point) => sigmaScreenPointToWorldPoint(sigma, point, options)
  });
  let sigma: SigmaGlobalSigmaLike;
  let generation = 0;
  let lastHitTarget: GraphGestureTarget | null = null;
  let activeNodeDrag: SigmaGlobalNodeDragSession | null = null;
  let currentPins: PinMap = { ...(options.pins ?? {}) };
  let cameraSpotlightCommunityId: string | null = sigmaSpotlightCommunityId(adapterData);
  let suppressNextNodeClickId: string | null = null;
  let overlayPointerDragCleanup: (() => void) | null = null;
  let sigmaWheelCleanup: (() => void) | null = null;
  let eventBindings: Array<{ event: string; listener: (payload?: unknown) => void }> = [];
  let resizeObserver: ResizeObserver | null = null;
  let resizeAnimationFrame: number | null = null;
  let lastObservedRootSize: RendererViewportSize | null = null;
  // 覆盖层元素按 id 复用：rebuild 维护这三张表（增删元素、绑监听一次），
  // reposition 只读它们更新位置，相机移动时不重建 DOM。
  const overlayRegionEntries = new Map<string, { element: HTMLElement; shape: SVGElement; kind: SigmaCloudKind }>();
  const overlayNodeEntries = new Map<string, HTMLButtonElement>();
  const overlayLabelEntries = new Map<string, HTMLElement>();

  try {
    sigma = new runtime.Sigma(graph, sigmaRoot, sigmaSettingsForTheme(currentTheme));
    bindSigmaWheelZoom();
    bindSigmaEvents();
    bindSigmaResizeObserver();
    rebuildSigmaOverlays();
  } catch (error) {
    options.onFatalError?.(error);
    sigmaRoot.remove();
    throw error;
  }

  const renderer: SigmaGlobalRenderer = {
    id: SIGMA_GLOBAL_RENDERER_ID,
    root: sigmaRoot,
    overlayRoot,
    get graph() {
      return graph;
    },
    updateStrategy: "rebuild-graph-preserve-camera",
    get lastHitTarget() {
      return lastHitTarget;
    },
    isDragging() {
      return Boolean(activeNodeDrag);
    },
    resetView() {
      assertActive();
      cameraSpotlightCommunityId = null;
      sigma.getCamera?.().setState?.(sigmaGlobalCameraState(sigma, adapterData));
    },
    zoomIn() {
      assertActive();
      zoomSigmaCameraAtViewportPoint(sigmaViewportCenter(sigmaRoot), "in", true);
    },
    zoomOut() {
      assertActive();
      zoomSigmaCameraAtViewportPoint(sigmaViewportCenter(sigmaRoot), "out", true);
    },
    update(updateOptions) {
      assertActive();
      const cameraState = readCameraState(sigma);
      const previousCameraSpotlightCommunityId = cameraSpotlightCommunityId;
      cancelNodeDrag();
      generation += 1;
      const finalizeUpdate = (): void => {
        try {
          restoreCameraState(sigma, cameraState);
          sigma.refresh?.();
          rebuildSigmaOverlays();
          cameraSpotlightCommunityId = maybeAnimateSigmaCommunitySpotlightCamera(
            sigma,
            sigmaRoot,
            adapterData,
            sigmaSpotlightCommunityId(adapterData),
            previousCameraSpotlightCommunityId
          );
        } catch (error) {
          options.onFatalError?.(error);
        }
      };
      const nextAdapterData = updateOptions.adapterData;
      const nextTheme = updateOptions.theme ?? currentTheme;
      const nextEdgeStyle = updateOptions.edgeStyle ?? currentEdgeStyle;
      const nextPins = { ...(updateOptions.pins ?? currentPins) };
      if (canPatchSigmaGlobalGraphAttributes(adapterData, nextAdapterData, currentTheme, nextTheme)) {
        adapterData = nextAdapterData;
        currentEdgeStyle = nextEdgeStyle;
        currentPins = nextPins;
        cloudBasisByCommunityId = sigmaCommunityCloudBasisByIdWithReuse(cloudBasisByCommunityId, adapterData);
        patchSigmaGlobalGraphAttributes(graph, adapterData, currentTheme, currentEdgeStyle);
        projector = createSigmaGlobalHitProjector({
          adapterData,
          viewport: options.viewport ?? DEFAULT_RENDERER_VIEWPORT,
          viewportSize: options.viewportSize ?? { width: 1, height: 1 },
          screenPointToWorldPoint: (point) => sigmaScreenPointToWorldPoint(sigma, point, options)
        });
        finalizeUpdate();
        return;
      }
      adapterData = updateOptions.adapterData;
      cloudBasisByCommunityId = sigmaCommunityCloudBasisByIdWithReuse(cloudBasisByCommunityId, adapterData);
      currentTheme = updateOptions.theme ?? currentTheme;
      currentEdgeStyle = updateOptions.edgeStyle ?? currentEdgeStyle;
      currentPins = { ...(updateOptions.pins ?? currentPins) };
      graph = buildSigmaGlobalGraphologyGraph(adapterData, runtime, currentTheme, currentEdgeStyle);
      projector = createSigmaGlobalHitProjector({
        adapterData,
        viewport: options.viewport ?? DEFAULT_RENDERER_VIEWPORT,
        viewportSize: options.viewportSize ?? { width: 1, height: 1 },
        screenPointToWorldPoint: (point) => sigmaScreenPointToWorldPoint(sigma, point, options)
      });
      try {
        sigma.setGraph?.(graph);
        if (updateOptions.theme) {
          sigmaRoot.dataset.theme = currentTheme;
          sigma.setSetting?.("labelColor", sigmaLabelColor(currentTheme));
        }
        finalizeUpdate();
      } catch (error) {
        options.onFatalError?.(error);
      }
    },
    destroy() {
      if (destroyed) return;
      cancelNodeDrag();
      destroyed = true;
      generation += 1;
      unbindSigmaWheelZoom();
      unbindSigmaEvents();
      cancelScheduledResizeRefresh();
      resizeObserver?.disconnect();
      resizeObserver = null;
      try {
        sigma.kill?.();
      } catch (error) {
        options.onFatalError?.(error);
      }
      sigmaRoot.remove();
      overlayRegionEntries.clear();
      overlayNodeEntries.clear();
      overlayLabelEntries.clear();
    }
  };

  return renderer;

  function bindSigmaEvents(): void {
    const nodeClick = (payload?: unknown): void => {
      const nodeId = sigmaNodeIdFromPayload(payload);
      if (consumeSuppressedNodeClick(nodeId)) return;
      handleSigmaHit({ nodeId });
    };
    const stageClick = (payload?: unknown): void => handleSigmaHit({ screenPoint: sigmaScreenPointFromPayload(payload) });
    const cameraUpdated = (): void => repositionSigmaOverlays();
    const nodeDown = (payload?: unknown): void => beginNodeDrag(sigmaNodeIdFromPayload(payload), sigmaScreenPointFromPayload(payload), payload);
    const nodeMove = (payload?: unknown): void => moveNodeDrag(sigmaScreenPointFromPayload(payload), payload);
    const nodeUp = (payload?: unknown): void => commitNodeDrag(sigmaScreenPointFromPayload(payload), payload);
    eventBindings = [
      { event: "clickNode", listener: nodeClick },
      { event: "clickStage", listener: stageClick },
      { event: "downNode", listener: nodeDown },
      { event: "moveBody", listener: nodeMove },
      { event: "upNode", listener: nodeUp },
      { event: "upStage", listener: nodeUp },
      { event: "cameraUpdated", listener: cameraUpdated },
      { event: "afterRender", listener: cameraUpdated }
    ];
    for (const binding of eventBindings) {
      sigma.on?.(binding.event, binding.listener);
    }
  }

  function unbindSigmaEvents(): void {
    for (const binding of eventBindings) {
      sigma.off?.(binding.event, binding.listener);
    }
    eventBindings = [];
  }

  function bindSigmaWheelZoom(): void {
    const captor = sigma.getMouseCaptor?.();
    if (!captor?.on) return;
    const listener = (payload?: unknown): void => handleSigmaWheelZoom(payload);
    captor.on("wheel", listener);
    sigmaWheelCleanup = () => captor.off?.("wheel", listener);
  }

  function unbindSigmaWheelZoom(): void {
    sigmaWheelCleanup?.();
    sigmaWheelCleanup = null;
  }

  function handleSigmaWheelZoom(payload: unknown): void {
    if (destroyed) return;
    const input = sigmaWheelInputFromPayload(payload, sigmaViewportCenter(sigmaRoot));
    if (!input) return;
    preventSigmaDefault(payload);
    if (sigmaWheelTargetIsZoomControl(payload)) return;
    const current = readCameraState(sigma) ?? { x: 0, y: 0, angle: 0, ratio: 1 };
    const nextRatio = sigmaWheelZoomRatio(current.ratio, input.delta);
    zoomSigmaCameraAtViewportPoint(input.point, nextRatio, false);
  }

  function zoomSigmaCameraAtViewportPoint(
    point: GraphScreenPoint,
    target: "in" | "out" | number,
    animated: boolean
  ): void {
    const camera = sigma.getCamera?.();
    const current = readCameraState(sigma) ?? { x: 0, y: 0, angle: 0, ratio: 1 };
    const nextRatio = typeof target === "number" ? target : sigmaButtonZoomRatio(current.ratio, target);
    const nextState = sigma.getViewportZoomedState?.(point, nextRatio) ?? {
      ...current,
      ratio: nextRatio
    };
    if (animated && camera?.animate && !prefersReducedMotion(sigmaRoot.ownerDocument.defaultView)) {
      void camera.animate(nextState, { duration: SIGMA_BUTTON_ZOOM_DURATION_MS, easing: "quadraticOut" });
      return;
    }
    // 滚轮/触控板始终即时 setState，不排队动画（设计 §5）。即使按钮或社区聚焦动画
    // 仍在进行，滚轮也直接覆盖相机；Sigma camera 没有公开的取消动画接口，接受聚焦
    // 动画末期（约 380ms）与滚轮的轻微拉锯，换取触控板高频输入的连续手感。
    camera?.setState?.(nextState);
  }

  function bindSigmaResizeObserver(): void {
    const view = sigmaRoot.ownerDocument.defaultView;
    const ViewResizeObserver = view?.ResizeObserver;
    if (!ViewResizeObserver) return;
    lastObservedRootSize = readObservedRootSize();
    resizeObserver = new ViewResizeObserver((entries) => {
      if (destroyed) return;
      const nextSize = readResizeEntrySize(entries) ?? readObservedRootSize();
      if (nextSize && lastObservedRootSize && sameRendererViewportSize(nextSize, lastObservedRootSize)) return;
      if (nextSize) lastObservedRootSize = nextSize;
      scheduleResizeRefresh();
    });
    resizeObserver.observe(sigmaRoot);
  }

  function scheduleResizeRefresh(): void {
    if (resizeAnimationFrame !== null) return;
    const view = sigmaRoot.ownerDocument.defaultView;
    const run = () => {
      resizeAnimationFrame = null;
      try {
        if (destroyed) return;
        sigma.refresh?.();
        repositionSigmaOverlays();
      } catch (error) {
        options.onFatalError?.(error);
      }
    };
    if (view?.requestAnimationFrame) {
      resizeAnimationFrame = view.requestAnimationFrame(run);
      return;
    }
    run();
  }

  function cancelScheduledResizeRefresh(): void {
    if (resizeAnimationFrame === null) return;
    sigmaRoot.ownerDocument.defaultView?.cancelAnimationFrame?.(resizeAnimationFrame);
    resizeAnimationFrame = null;
  }

  function readResizeEntrySize(entries: ResizeObserverEntry[]): RendererViewportSize | null {
    const entry = entries.find((item) => item.target === sigmaRoot) ?? entries[0];
    if (!entry?.contentRect) return null;
    const width = finiteNumber(entry.contentRect.width, 0);
    const height = finiteNumber(entry.contentRect.height, 0);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function readObservedRootSize(): RendererViewportSize | null {
    const rect = typeof sigmaRoot.getBoundingClientRect === "function" ? sigmaRoot.getBoundingClientRect() : null;
    const width = finiteNumber(rect?.width, 0);
    const height = finiteNumber(rect?.height, 0);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function handleSigmaHit(input: SigmaGlobalHitInput): void {
    if (destroyed) return;
    const eventGeneration = generation;
    const target = projector.targetFromSigmaHit(input);
    if (destroyed || eventGeneration !== generation) return;
    lastHitTarget = target;
    options.onHitTarget?.(target);
  }

  function beginNodeDrag(nodeId: string | null, screenPoint: GraphScreenPoint | null, payload?: unknown): void {
    if (destroyed || !nodeId || !screenPoint || !graph.hasNode(nodeId)) return;
    preventSigmaDefault(payload);
    cancelNodeDrag();
    const startPoint = sigmaNodeWorldPoint(nodeId);
    const pointerWorldPoint = sigmaScreenPointToWorldPoint(sigma, screenPoint, options);
    activeNodeDrag = createSigmaGlobalNodeDragSession({
      nodeId,
      pinKey: sigmaPinKeyForNode(nodeId),
      startPoint,
      pointerStart: screenPoint,
      pointerWorldPoint,
      initiallyPinned: Boolean(graph.getNodeAttribute(nodeId, "pinned")),
      initialPinPosition: sigmaPinPositionForNode(nodeId),
      previousCameraPanning: sigma.getSetting?.("enableCameraPanning")
    });
    sigma.setSetting?.("enableCameraPanning", false);
    sigmaRoot.dataset.draggingNodeId = nodeId;
    options.onDragActiveChange?.(true);
  }

  function moveNodeDrag(screenPoint: GraphScreenPoint | null, payload?: unknown): void {
    const drag = activeNodeDrag;
    if (!drag || destroyed || !screenPoint) return;
    preventSigmaDefault(payload);
    const pointerWorldPoint = sigmaScreenPointToWorldPoint(sigma, screenPoint, options);
    moveSigmaGlobalNodeDragSession(drag, screenPoint, pointerWorldPoint);
    if (drag.moved) {
      applyNodeDragPoint(drag.nodeId, drag.currentPoint, drag.initiallyPinned, drag.initialPinPosition);
    }
  }

  function commitNodeDrag(screenPoint: GraphScreenPoint | null, payload?: unknown): void {
    const drag = activeNodeDrag;
    if (!drag || destroyed) return;
    preventSigmaDefault(payload);
    if (screenPoint) moveNodeDrag(screenPoint, payload);
    clearOverlayPointerDragListeners();
    restoreNodeDragCamera(drag);
    activeNodeDrag = null;
    delete sigmaRoot.dataset.draggingNodeId;
    options.onDragActiveChange?.(false);
    if (!drag.moved) {
      return;
    }
    suppressNextNodeClickId = drag.nodeId;
    const finalPin: PinPosition = {
      x: drag.currentPoint.x,
      y: drag.currentPoint.y,
      coordinateSpace: "world"
    };
    currentPins = {
      ...currentPins,
      [drag.pinKey]: finalPin
    };
    applyNodeDragPoint(drag.nodeId, drag.currentPoint, true, finalPin);
    options.onPinsChanged?.(currentPins);
  }

  function cancelNodeDrag(): void {
    const drag = activeNodeDrag;
    if (!drag) return;
    clearOverlayPointerDragListeners();
    restoreNodeDragCamera(drag);
    activeNodeDrag = null;
    delete sigmaRoot.dataset.draggingNodeId;
    applyNodeDragPoint(drag.nodeId, drag.startPoint, Boolean(currentPins[drag.pinKey]), currentPins[drag.pinKey] ?? null);
    options.onDragActiveChange?.(false);
  }

  function restoreNodeDragCamera(drag: SigmaGlobalNodeDragSession): void {
    const nextValue = typeof drag.previousCameraPanning === "boolean" ? drag.previousCameraPanning : true;
    sigma.setSetting?.("enableCameraPanning", nextValue);
  }

  function applyNodeDragPoint(nodeId: string, point: { x: number; y: number }, pinned: boolean, pinPosition: PinPosition | null = null): void {
    const dragging = Boolean(activeNodeDrag);
    if (!graph.hasNode(nodeId)) return;
    graph.mergeNodeAttributes(nodeId, {
      x: finiteNumber(point.x, 0),
      y: finiteNumber(point.y, 0),
      pinned
    });
    adapterData = sigmaAdapterDataWithNodePoint(adapterData, nodeId, point, pinned, pinPosition);
    sigma.refresh?.();
    if (!dragging) {
      cloudBasisByCommunityId = sigmaCommunityCloudBasisByIdWithNodePoint(cloudBasisByCommunityId, adapterData, nodeId);
      // 拖拽提交/取消是终态数据变化（pin 状态、永久坐标），走 rebuild 刷新 dataset 等属性；
      // 拖拽过程中的每帧位置更新由 afterRender → reposition 负责。
      rebuildSigmaOverlays();
    }
  }

  function sigmaNodeWorldPoint(nodeId: string): { x: number; y: number } {
    return {
      x: finiteNumber(graph.getNodeAttribute(nodeId, "x"), 0),
      y: finiteNumber(graph.getNodeAttribute(nodeId, "y"), 0)
    };
  }

  function sigmaPinKeyForNode(nodeId: string): string {
    const sourcePath = graph.getNodeAttribute(nodeId, "sourcePath");
    return typeof sourcePath === "string" && sourcePath ? sourcePath : nodeId;
  }

  function sigmaPinPositionForNode(nodeId: string): PinPosition | null {
    const pinKey = sigmaPinKeyForNode(nodeId);
    return currentPins[pinKey] ?? null;
  }

  function consumeSuppressedNodeClick(nodeId: string | null): boolean {
    if (!nodeId || suppressNextNodeClickId !== nodeId) return false;
    suppressNextNodeClickId = null;
    return true;
  }

  // 结构更新：仅在数据/选中变化时调用。按 id 复用元素、绑监听一次、写数据态属性，
  // 最后调用 reposition 完成定位（定位逻辑只存在于 reposition，避免两条路径分叉）。
  function rebuildSigmaOverlays(): void {
    if (destroyed) return;
    const ordered: HTMLElement[] = [];
    const selectedCommunityIds = sigmaSelectedCommunityIds(adapterData);
    const spotlightCommunityIds = sigmaSpotlightCommunityIds(adapterData);

    const nextRegionIds = new Set<string>();
    for (const community of adapterData.renderable.communities) {
      if (!community.wash) continue;
      nextRegionIds.add(community.id);
      const cloud = sigmaCommunityCloudFor(community.id, community.wash);
      const kind: SigmaCloudKind = cloud.localPoints ? "polygon" : "ellipse";
      let entry = overlayRegionEntries.get(community.id);
      if (!entry || entry.kind !== kind) {
        const element = sigmaOverlayPassiveElement(overlayRoot.ownerDocument, "community-region", community.id);
        element.className = "sigma-global-community-region";
        element.dataset.communityId = community.id;
        element.style.overflow = "visible";
        const handle = createSigmaCloudSvg(overlayRoot.ownerDocument, cloud, cloudFilterId, () => {
          handleSigmaHit({ renderedObject: { kind: "community-wash", id: community.id } });
        });
        element.append(handle.svg);
        entry = { element, shape: handle.shape, kind: handle.kind };
        overlayRegionEntries.set(community.id, entry);
      }
      const selected = selectedCommunityIds.has(community.id);
      const dim = selectedCommunityIds.size > 0 && !selected;
      entry.element.dataset.selected = selected ? "true" : "false";
      applySigmaCloudColor(entry.shape, community.color, dim);
      ordered.push(entry.element);
    }
    pruneOverlayEntries(overlayRegionEntries, nextRegionIds);

    const nextNodeIds = new Set<string>();
    for (const node of sigmaOverlayNodes(adapterData)) {
      nextNodeIds.add(node.id);
      let element = overlayNodeEntries.get(node.id);
      if (!element) {
        element = createSigmaNodeHitTarget(node.id, node.label || node.id);
        overlayNodeEntries.set(node.id, element);
      }
      element.setAttribute("aria-label", node.label || node.id);
      element.dataset.nodeId = node.id;
      element.dataset.searchHit = node.searchHit ? "true" : "false";
      element.dataset.selected = node.selected ? "true" : "false";
      element.dataset.pinned = node.pinHint.pinned ? "true" : "false";
      element.dataset.communityDimmed = sigmaGlobalNodeSpotlightState(node, spotlightCommunityIds).dimmed ? "true" : "false";
      ordered.push(element);
    }
    pruneOverlayEntries(overlayNodeEntries, nextNodeIds);

    const nextLabelIds = new Set<string>();
    for (const community of sigmaCommunityLabels(adapterData, SIGMA_GLOBAL_COMMUNITY_LABEL_LIMIT)) {
      if (!community.wash) continue;
      nextLabelIds.add(community.id);
      let element = overlayLabelEntries.get(community.id);
      if (!element) {
        element = sigmaOverlayPassiveElement(overlayRoot.ownerDocument, "community-label", community.id);
        element.className = "sigma-global-community-label";
        element.dataset.communityId = community.id;
        overlayLabelEntries.set(community.id, element);
      }
      const labelSelected = selectedCommunityIds.has(community.id);
      element.dataset.selected = labelSelected ? "true" : "false";
      element.dataset.dim = selectedCommunityIds.size > 0 && !labelSelected ? "true" : "false";
      element.textContent = community.label || community.id;
      ordered.push(element);
    }
    pruneOverlayEntries(overlayLabelEntries, nextLabelIds);

    overlayRoot.replaceChildren(...ordered);
    repositionSigmaOverlays();
  }

  // 位置更新：相机/缩放/拖拽每帧调用。只读已存在元素更新位置与云层几何，
  // 不创建元素、不重绑监听、不调用 replaceChildren；缺失的 id 安全跳过。
  function repositionSigmaOverlays(): void {
    if (destroyed) return;
    for (const community of adapterData.renderable.communities) {
      if (!community.wash) continue;
      const entry = overlayRegionEntries.get(community.id);
      if (!entry) continue;
      const cloud = sigmaCommunityCloudFor(community.id, community.wash);
      applyOverlayBox(entry.element, cloud.box);
      applySigmaCloudGeometry(entry.shape, entry.kind, cloud);
    }
    for (const node of sigmaOverlayNodes(adapterData)) {
      const element = overlayNodeEntries.get(node.id);
      if (!element) continue;
      const size = Math.max(16, sigmaGlobalNodeSize(node) * 3);
      const center = sigmaWorldPointToScreenPoint(sigma, node.point, options);
      applyOverlayBox(element, {
        left: center.x - size / 2,
        top: center.y - size / 2,
        width: size,
        height: size
      });
    }
    for (const community of sigmaCommunityLabels(adapterData, SIGMA_GLOBAL_COMMUNITY_LABEL_LIMIT)) {
      if (!community.wash) continue;
      const element = overlayLabelEntries.get(community.id);
      if (!element) continue;
      const center = sigmaWorldPointToScreenPoint(sigma, {
        x: community.wash.cx,
        y: community.wash.cy - community.wash.ry * 0.16
      }, options);
      applyOverlayBox(element, {
        left: center.x,
        top: center.y,
        width: 160,
        height: 22
      });
    }
  }

  function sigmaCommunityCloudFor(communityId: string, wash: { cx: number; cy: number; rx: number; ry: number }): SigmaCommunityCloud {
    const fallbackBox = overlayBoxFromWorldEllipse(wash.cx, wash.cy, wash.rx, wash.ry);
    return sigmaCommunityCloud(
      sigmaProjectedCloudHullPoints(cloudBasisByCommunityId.get(communityId), sigma, options),
      fallbackBox
    );
  }

  function createSigmaNodeHitTarget(nodeId: string, label: string): HTMLButtonElement {
    const element = sigmaOverlayButton(overlayRoot.ownerDocument, "node", nodeId, label);
    element.className = "sigma-global-node-hit-target";
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (consumeSuppressedNodeClick(nodeId)) return;
      handleSigmaHit({ renderedObject: { kind: "node", id: nodeId } });
    });
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      beginNodeDrag(nodeId, overlayPointerScreenPoint(event, sigmaRoot), event);
      if (activeNodeDrag?.nodeId === nodeId) {
        bindOverlayPointerDragListeners(element.ownerDocument, element, nodeId, event.pointerId);
      }
    });
    element.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (element.ownerDocument.defaultView?.PointerEvent) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeNodeDrag?.nodeId !== nodeId) {
        beginNodeDrag(nodeId, overlayPointerScreenPoint(event, sigmaRoot), event);
      }
      if (activeNodeDrag?.nodeId === nodeId) {
        bindOverlayMouseDragListeners(element.ownerDocument, nodeId);
      }
    });
    element.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });
    return element;
  }

  function pruneOverlayEntries(entries: Map<string, unknown>, keep: Set<string>): void {
    for (const id of [...entries.keys()]) {
      if (!keep.has(id)) entries.delete(id);
    }
  }

  function overlayBoxFromWorldEllipse(x: number, y: number, rx: number, ry: number): { left: number; top: number; width: number; height: number } {
    const topLeft = sigmaWorldPointToScreenPoint(sigma, { x: x - rx, y: y - ry }, options);
    const bottomRight = sigmaWorldPointToScreenPoint(sigma, { x: x + rx, y: y + ry }, options);
    const left = Math.min(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    return {
      left,
      top,
      width: Math.max(8, Math.abs(bottomRight.x - topLeft.x)),
      height: Math.max(8, Math.abs(bottomRight.y - topLeft.y))
    };
  }

  function bindOverlayPointerDragListeners(ownerDocument: Document, element: HTMLElement, nodeId: string, pointerId: number): void {
    clearOverlayPointerDragListeners();
    const cleanup = bindSigmaGlobalOverlayPointerDrag({
      ownerDocument,
      element,
      nodeId,
      pointerId,
      isActive: isActiveOverlayDrag,
      screenPointFromEvent: (event) => overlayPointerScreenPoint(event, sigmaRoot),
      onMove: moveNodeDrag,
      onEnd: commitNodeDrag,
      onCancel: cancelNodeDrag
    });
    overlayPointerDragCleanup = () => {
      cleanup();
      overlayPointerDragCleanup = null;
    };
  }

  function bindOverlayMouseDragListeners(ownerDocument: Document, nodeId: string): void {
    clearOverlayPointerDragListeners();
    const cleanup = bindSigmaGlobalOverlayMouseDrag({
      ownerDocument,
      nodeId,
      isActive: isActiveOverlayDrag,
      screenPointFromEvent: (event) => overlayPointerScreenPoint(event, sigmaRoot),
      onMove: moveNodeDrag,
      onEnd: commitNodeDrag
    });
    overlayPointerDragCleanup = () => {
      cleanup();
      overlayPointerDragCleanup = null;
    };
  }

  function isActiveOverlayDrag(nodeId: string): boolean {
    return activeNodeDrag?.nodeId === nodeId;
  }

  function clearOverlayPointerDragListeners(): void {
    overlayPointerDragCleanup?.();
  }

  function assertActive(): void {
    if (destroyed) {
      throw new Error("Sigma global renderer has been destroyed");
    }
  }

}

function createSigmaRoot(container: HTMLElement, theme: ThemeId): HTMLElement {
  const root = container.ownerDocument.createElement("div");
  root.className = "sigma-global-renderer";
  root.dataset.renderer = SIGMA_GLOBAL_RENDERER_ID;
  root.dataset.theme = theme;
  root.tabIndex = 0;
  container.append(root);
  return root;
}

function sigmaSettingsForTheme(theme: ThemeId): Record<string, unknown> {
  return {
    renderEdgeLabels: false,
    allowInvalidContainer: false,
    labelColor: sigmaLabelColor(theme),
    zoomingRatio: SIGMA_BUTTON_ZOOM_RATIO,
    // Sigma 默认 wheel 的兜底参数：wheel 已被 handleSigmaWheelZoom 接管（preventSigmaDefault），
    // zoomingRatio/zoomDuration 只在 Sigma 内置缩放入口（如 animatedZoom）被触发时生效，
    // 日常不走。项目按钮动画用的是 SIGMA_BUTTON_ZOOM_DURATION_MS（140），勿与这里的 120 混淆。
    zoomDuration: 120,
    minCameraRatio: SIGMA_CAMERA_MIN_RATIO,
    maxCameraRatio: SIGMA_CAMERA_MAX_RATIO
  };
}

function sigmaLabelColor(theme: ThemeId): { color: string } {
  return { color: theme === "mo-ye" ? "#f8fafc" : "#6b6256" };
}

function sigmaWheelInputFromPayload(payload: unknown, fallbackPoint: GraphScreenPoint): {
  point: GraphScreenPoint;
  delta: SigmaWheelDeltaLike;
} | null {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const originalDeltaY = wheel?.original?.deltaY;
  const fallbackDelta = wheel?.delta;
  const deltaY = typeof originalDeltaY === "number"
    ? originalDeltaY
    : typeof fallbackDelta === "number"
      ? -fallbackDelta * 120
      : null;
  if (deltaY == null || !Number.isFinite(deltaY)) return null;

  const x = finiteNumber(wheel?.x, Number.NaN);
  const y = finiteNumber(wheel?.y, Number.NaN);
  const point = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallbackPoint;
  const originalDeltaMode = wheel?.original?.deltaMode;
  return {
    point,
    delta: {
      deltaY,
      deltaMode: typeof originalDeltaMode === "number" ? originalDeltaMode : 0
    }
  };
}

// 防御性检查：判断 wheel 是否发生在左下缩放控件上。实际上 .graph-zoom-controls 是
// 覆盖在 Sigma canvas 之上的独立 DOM，wheel 事件不会从它冒泡到 Sigma 的 mouse captor
// （captor 绑在内部 canvas），所以这个分支在当前结构下正常不可达。保留是为了在控件
// 层级/事件链日后变化时仍能挡住"滚到按钮上误缩放图谱"。
function sigmaWheelTargetIsZoomControl(payload: unknown): boolean {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const target = wheel?.original?.target as {
    closest?: (selector: string) => unknown;
    parentElement?: { closest?: (selector: string) => unknown };
  } | null | undefined;
  return Boolean(
    target?.closest?.("[data-control=\"sigma-zoom\"]") ||
    target?.parentElement?.closest?.("[data-control=\"sigma-zoom\"]")
  );
}

function sigmaViewportCenter(root: HTMLElement): GraphScreenPoint {
  const rect = typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect() : null;
  const width = finiteNumber(rect?.width, 1000);
  const height = finiteNumber(rect?.height, 680);
  return {
    x: width / 2,
    y: height / 2
  };
}

function sigmaOverlayNodes(adapterData: GraphRendererAdapterData): GraphRendererAdapterNode[] {
  const nodes = adapterData.nodes;
  const seen = new Set<string>();
  const output: GraphRendererAdapterNode[] = [];
  const append = (candidates: GraphRendererAdapterNode[], limit: number) => {
    let count = 0;
    for (const node of candidates) {
      if (output.length >= SIGMA_GLOBAL_NODE_HIT_TARGET_LIMIT || count >= limit || seen.has(node.id)) continue;
      seen.add(node.id);
      output.push(node);
      count += 1;
    }
  };
  if (adapterData.selection.input?.kind !== "community") {
    append(nodes.filter((node) => node.selected), Number.POSITIVE_INFINITY);
  }
  append(nodes.filter((node) => node.searchHit), 80);
  append(nodes.filter((node) => node.pinHint.pinned), 80);
  return output;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sameRendererViewportSize(left: RendererViewportSize, right: RendererViewportSize): boolean {
  return Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
