export * from "./types";

import type {
  GraphDiff,
  GraphEngine,
  GraphEngineOptions,
  SelectionInput,
  ThemeId
} from "./types";

export function createGraphEngine(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  if (!container) {
    throw new Error("createGraphEngine requires a container element");
  }

  let currentTheme: ThemeId = options.theme;
  let destroyed = false;

  container.dataset.llmWikiGraphEngine = "mounted";
  container.dataset.llmWikiGraphTheme = currentTheme;

  return {
    async applyDiff(_diff: GraphDiff): Promise<void> {
      assertActive();
    },

    focusNode(path: string): void {
      assertActive();
      container.dataset.llmWikiGraphFocus = path;
    },

    select(_selector: SelectionInput): void {
      assertActive();
    },

    setTheme(theme: ThemeId): void {
      assertActive();
      currentTheme = theme;
      container.dataset.llmWikiGraphTheme = currentTheme;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
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
