export * from "./types";
export * from "./graph-node";
export * from "./layout";
export * from "./model";
export * from "./render";
export * from "./select";
export * from "./sim";
export * from "./themes";
export * from "./diff";
export * from "./anim";

import type {
  GraphDiff,
  GraphEngine,
  GraphEngineOptions,
  Selection,
  SelectionInput,
  ThemeId
} from "./types";
import { createStaticGraphRenderer } from "./render";
import { resolveSelectionForCapabilities } from "./select";

export function createGraphEngine(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  if (!container) {
    throw new Error("createGraphEngine requires a container element");
  }

  let currentTheme: ThemeId = options.theme;
  let destroyed = false;
  const canAsk = Boolean(options.capabilities?.onAsk);
  const canSelect = Boolean(options.capabilities?.onSelectionChange || options.capabilities?.onAsk);
  const resolveForHostCapabilities = (input: SelectionInput): Selection =>
    resolveSelectionForCapabilities(options.data, input, { canAsk });
  const renderer = createStaticGraphRenderer(container, {
    data: options.data,
    pins: options.pins || {},
    theme: currentTheme,
    toolbarContainer: options.toolbarContainer,
    focus: options.focus,
    typeFilters: options.typeFilters,
    onOpenPage: options.capabilities?.onOpenPage,
    onSelectionChange: canSelect
      ? (input) => {
          const selection = resolveForHostCapabilities(input);
          options.capabilities?.onSelectionChange?.(selection);
          if (!options.capabilities?.onSelectionChange) options.capabilities?.onAsk?.(selection);
        }
      : undefined,
    persistPins: options.capabilities?.persistPins,
    onSelectionClear: options.capabilities?.onSelectionClear,
    onDragStateChange: options.capabilities?.onDragStateChange
  });

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

    resetView(): void {
      assertActive();
      delete container.dataset.llmWikiGraphFocus;
      renderer.resetView();
    },

    select(selector: SelectionInput): Selection {
      assertActive();
      renderer.select(selector);
      return resolveForHostCapabilities(selector);
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

    setTheme(theme: ThemeId): void {
      assertActive();
      currentTheme = theme;
      container.dataset.llmWikiGraphTheme = currentTheme;
      renderer.setTheme(theme);
    },

    setPins(pins): void {
      assertActive();
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
