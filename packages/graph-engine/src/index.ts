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
export { createGraphFacade } from "./facade";

import type { GraphEngine, GraphEngineOptions } from "./types";
import { createGraphFacade } from "./facade";

export function createGraphEngine(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  return createGraphFacade(container, options);
}
