import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphData, GraphDiff, SelectionInput } from "../src";
import { createGraphRenderer } from "../src/render";

describe("graph renderer lifecycle", () => {
  it("routes a community click to lightweight selection instead of focusing the community", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const selections: SelectionInput[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataWithCommunities([
        ["a", "community-a"],
        ["b", "community-b"]
      ]),
      theme: "shan-shui",
      live: false,
      onSelectionInput: (selection) => selections.push(selection)
    });

    findByDataset(renderer.root as unknown as FakeElement, "communityId", "community-a")?.dispatch("click");

    assert.deepEqual(selections, [{ kind: "community", id: "community-a" }]);
    assert.ok(nodeElement(renderer, "a"));
    assert.ok(nodeElement(renderer, "b"));

    renderer.destroy();
  });

  it("routes a global node click to lightweight selection instead of opening the page", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const opened: string[] = [];
    const selections: SelectionInput[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false,
      onNodeOpen: (id) => opened.push(id),
      onSelectionInput: (selection) => selections.push(selection)
    });

    nodeElement(renderer, "a")?.dispatch("click", { detail: 0 });

    assert.deepEqual(opened, []);
    assert.deepEqual(selections, [{ kind: "node", id: "a" }]);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "true");

    renderer.destroy();
  });

  it("clears selection on a blank click without leaving community focus", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const clearRequests: number[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataWithCommunities([
        ["a", "community-a"],
        ["b", "community-a"],
        ["c", "community-b"]
      ]),
      theme: "shan-shui",
      live: false,
      focus: { kind: "community", id: "community-a" },
      onSelectionClearRequested: () => clearRequests.push(1)
    });

    renderer.select({ kind: "node", id: "a" });
    dispatchPointerSequence(renderer.root as unknown as FakeElement, 20, 20);

    assert.equal(clearRequests.length, 1);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "false");
    assert.ok(nodeElement(renderer, "a"));
    assert.ok(nodeElement(renderer, "b"));
    assert.equal(nodeElement(renderer, "c"), undefined);

    renderer.destroy();
  });

  it("keeps node double click from silently unpinning or changing focus", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const pinsChanged: unknown[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataWithCommunities([
        ["a", "community-a"],
        ["b", "community-a"],
        ["c", "community-b"]
      ]),
      pins: { "wiki/a.md": { x: 120, y: 140, coordinateSpace: "world" } },
      theme: "shan-shui",
      live: false,
      focus: { kind: "community", id: "community-a" },
      onPinsChanged: (pins) => pinsChanged.push(pins)
    });

    nodeElement(renderer, "a")?.dispatch("dblclick");

    assert.deepEqual(pinsChanged, []);
    assert.equal(nodeElement(renderer, "a")?.dataset.pinned, "true");
    assert.ok(nodeElement(renderer, "a"));
    assert.ok(nodeElement(renderer, "b"));
    assert.equal(nodeElement(renderer, "c"), undefined);

    renderer.destroy();
  });

  it("fixes and unfixes node position only through the explicit renderer action", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const pinsChanged: unknown[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false,
      onPinsChanged: (pins) => pinsChanged.push(pins)
    });

    assert.equal(renderer.setNodeFixed("a", "fix"), true);
    assert.equal(nodeElement(renderer, "a")?.dataset.pinned, "true");
    assert.deepEqual(Object.keys(pinsChanged.at(-1) as Record<string, unknown>), ["wiki/a.md"]);

    assert.equal(renderer.setNodeFixed("a", "unfix"), true);
    assert.equal(nodeElement(renderer, "a")?.dataset.pinned, "false");
    assert.deepEqual(pinsChanged.at(-1), {});

    renderer.destroy();
  });

  it("returns global while preserving selection, search, filters, and fixed positions", async () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const clearRequests: number[] = [];
    const viewResets: number[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataForReturnGlobal(),
      pins: { "wiki/a.md": { x: 120, y: 140, coordinateSpace: "world" } },
      theme: "shan-shui",
      live: false,
      focus: { kind: "community", id: "community-a" },
      typeFilters: { entity: true, source: true },
      onSelectionClearRequested: () => clearRequests.push(1),
      onViewReset: () => viewResets.push(1)
    });

    renderer.setTypeFilters({ entity: true, source: false });
    renderer.select({ kind: "node", id: "a" });
    const searchInput = findByClass(renderer.root as unknown as FakeElement, "graph-search-input")[0];
    searchInput.value = "Node a";
    searchInput.dispatch("input");

    assert.deepEqual(visibleNodeIds(renderer), ["a"]);

    renderer.resetView();
    await waitForViewportCommit();

    assert.deepEqual(viewResets, [1]);
    assert.deepEqual(clearRequests, []);
    assert.deepEqual(visibleNodeIds(renderer), ["a", "c"]);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "true");
    assert.equal(nodeElement(renderer, "c")?.getAttribute("aria-pressed"), "false");
    assert.equal(nodeElement(renderer, "a")?.dataset.pinned, "true");
    assert.equal(nodeElement(renderer, "b"), undefined);
    assert.equal(findByClass(renderer.root as unknown as FakeElement, "graph-search-input")[0]?.value, "Node a");
    assert.equal(nodeElement(renderer, "a")?.dataset.searchState, "match");
    assert.equal(nodeElement(renderer, "c")?.dataset.searchState, "faded");

    renderer.destroy();
  });

  it("keeps reset layout separate from return global", async () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const viewResets: number[] = [];
    const pinsChanged: unknown[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataForReturnGlobal(),
      pins: { "wiki/a.md": { x: 120, y: 140, coordinateSpace: "world" } },
      theme: "shan-shui",
      live: false,
      focus: { kind: "community", id: "community-a" },
      typeFilters: { entity: true, source: true },
      onViewReset: () => viewResets.push(1),
      onPinsChanged: (pins) => pinsChanged.push(pins)
    });

    renderer.select({ kind: "node", id: "a" });
    const searchInput = findByClass(renderer.root as unknown as FakeElement, "graph-search-input")[0];
    searchInput.value = "Node a";
    searchInput.dispatch("input");

    renderer.resetLayout();
    await waitForViewportCommit();

    assert.deepEqual(viewResets, []);
    assert.deepEqual(pinsChanged.at(-1), {});
    assert.deepEqual(visibleNodeIds(renderer), ["a", "b"]);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "true");
    assert.equal(nodeElement(renderer, "a")?.dataset.pinned, "false");
    assert.equal(findByClass(renderer.root as unknown as FakeElement, "graph-search-input")[0]?.value, "Node a");
    assert.equal(nodeElement(renderer, "c"), undefined);

    renderer.destroy();
  });

  it("returns global with a selected community still selected", async () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphDataForReturnGlobal(),
      theme: "shan-shui",
      live: false,
      focus: { kind: "community", id: "community-a" }
    });

    renderer.select({ kind: "community", id: "community-a" });
    renderer.resetView();
    await waitForViewportCommit();

    assert.deepEqual(visibleNodeIds(renderer), ["a", "b", "c"]);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "true");
    assert.equal(nodeElement(renderer, "b")?.getAttribute("aria-pressed"), "true");
    assert.equal(nodeElement(renderer, "c")?.getAttribute("aria-pressed"), "false");

    renderer.destroy();
  });

  it("updates toolbar panel state without repainting the graph", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false
    });

    const toolbar = findByClass(renderer.root as unknown as FakeElement, "graph-toolbar")[0];
    const filtersButton = findByText(toolbar, "筛选");
    const legendButton = findByText(toolbar, "图例");
    const panel = findByClass(toolbar, "graph-toolbar-panel")[0];
    const node = nodeElement(renderer, "a");

    filtersButton?.dispatch("click");

    assert.equal(renderer.root.dataset.toolbarPanel, "filters");
    assert.equal(toolbar.dataset.panel, "filters");
    assert.equal(panel.dataset.state, "filters");
    assert.equal(filtersButton?.dataset.active, "true");
    assert.equal(legendButton?.dataset.active, "false");
    assert.equal(findByClass(renderer.root as unknown as FakeElement, "graph-toolbar")[0], toolbar);
    assert.equal(nodeElement(renderer, "a"), node);

    renderer.destroy();
  });

  it("does not let stale diff settlement mutate a refreshed graph", async () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false
    });

    const staleDiff = renderer.applyDiff(diff({ addedNodes: ["a"], nodeCount: 1 }), { durationMs: 420 });
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "a")?.classList.contains("is-diff-added"), true);

    renderer.setData(graphData(["b"]));
    assert.equal(renderer.root.dataset.diffState, undefined);
    assert.equal(nodeElement(renderer, "a"), undefined);

    const currentDiff = renderer.applyDiff(diff({ addedNodes: ["b"], nodeCount: 1 }), { durationMs: 420 });
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), true);

    await staleDiff;
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), true);

    await currentDiff;
    assert.equal(renderer.root.dataset.diffState, "settled");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), false);

    renderer.destroy();
  });
});

function graphData(ids: string[]): GraphData {
  return graphDataWithCommunities(ids.map((id) => [id, "community-a"]));
}

function graphDataWithCommunities(entries: Array<[string, string]>): GraphData {
  return {
    meta: {
      build_date: "2026-06-17",
      wiki_title: "Lifecycle graph",
      total_nodes: entries.length,
      total_edges: 0
    },
    nodes: entries.map(([id, community]) => ({
      id,
      label: `Node ${id}`,
      type: "topic",
      community,
      source_path: `wiki/${id}.md`,
      content: `Node ${id}`
    })),
    edges: []
  };
}

function graphDataForReturnGlobal(): GraphData {
  return {
    meta: {
      build_date: "2026-06-17",
      wiki_title: "Return global graph",
      total_nodes: 3,
      total_edges: 1
    },
    nodes: [
      { id: "a", label: "Node a", type: "entity", community: "community-a", source_path: "wiki/a.md", content: "Node a detail" },
      { id: "b", label: "Node b", type: "source", community: "community-a", source_path: "wiki/b.md", content: "Node b detail" },
      { id: "c", label: "Node c", type: "entity", community: "community-b", source_path: "wiki/c.md", content: "Node c detail" }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED" }
    ]
  };
}

function visibleNodeIds(renderer: { root: HTMLElement }): string[] {
  return collectNodes(renderer.root as unknown as FakeElement).map((node) => node.dataset.id || "").sort();
}

function collectNodes(root: FakeElement): FakeElement[] {
  const matches: FakeElement[] = [];
  if (root.classList.contains("node")) matches.push(root);
  for (const child of root.children) matches.push(...collectNodes(child));
  return matches;
}

async function waitForViewportCommit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 24));
}

function diff(overrides: Partial<GraphDiff> & { nodeCount: number }): GraphDiff {
  return {
    addedNodes: overrides.addedNodes || [],
    removedNodes: overrides.removedNodes || [],
    recoloredNodes: overrides.recoloredNodes || [],
    addedEdges: overrides.addedEdges || [],
    removedEdges: overrides.removedEdges || [],
    newCommunities: overrides.newCommunities || [],
    stats: {
      nodeCount: overrides.nodeCount,
      edgeCount: 0,
      communityCount: 1
    }
  };
}

function nodeElement(renderer: { root: HTMLElement }, id: string): FakeElement | undefined {
  return findByDataset(renderer.root as unknown as FakeElement, "id", id);
}

function findByDataset(root: FakeElement, key: string, value: string): FakeElement | undefined {
  if (root.dataset[key] === value) return root;
  for (const child of root.children) {
    const match = findByDataset(child, key, value);
    if (match) return match;
  }
  return undefined;
}

class FakeDocument {
  readonly head = new FakeElement("head", this);
  readonly defaultView = {
    localStorage: null,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) as unknown as number
  };

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement | null {
    return findById(this.head, id) || null;
  }

  addEventListener(_type: string, _listener: unknown): void {}

  removeEventListener(_type: string, _listener: unknown): void {}
}

class FakeElement {
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly dataset: Record<string, string | undefined> = {};
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null = null;
  className = "";
  textContent = "";
  type = "";
  title = "";
  href = "";
  innerHTML = "";
  checked = false;
  value = "";
  tabIndex = -1;
  scrollLeft = 0;
  scrollTop = 0;
  id = "";
  private capturedPointerId: number | null = null;

  constructor(readonly tagName: string, ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  append(...children: Array<FakeElement | string>): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        this.appendChild(child);
      }
    }
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child: FakeElement): void {
    child.parentElement = this;
    this.children.unshift(child);
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.splice(0);
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  contains(candidate: FakeElement): boolean {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  setAttribute(name: string, value: string): void {
    if (name === "class") this.className = value;
    else if (name === "href") this.href = value;
    else if (name === "id") this.id = value;
    else if (name.startsWith("data-")) this.dataset[dataKey(name)] = value;
    else (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
    if (name === "href") return this.href || null;
    if (name === "id") return this.id || null;
    if (name.startsWith("data-")) return this.dataset[dataKey(name)] || null;
    const value = (this as unknown as Record<string, string>)[name];
    return value || null;
  }

  addEventListener(type: string, listener: unknown): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener as (event: FakeEvent) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: unknown): void {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, init: Partial<FakeEvent> = {}): void {
    const event = new FakeEvent(type, { ...init, target: init.target || this });
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  focus(_options?: unknown): void {}

  select(): void {}

  setPointerCapture(pointerId: number): void {
    this.capturedPointerId = pointerId;
  }

  releasePointerCapture(pointerId: number): void {
    if (this.capturedPointerId === pointerId) this.capturedPointerId = null;
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointerId === pointerId;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 960, height: 640 };
  }
}

class FakeEvent {
  propagationStopped = false;
  defaultPrevented = false;
  detail = 1;
  shiftKey = false;
  button = 0;
  pointerId = 1;
  clientX = 0;
  clientY = 0;
  deltaY = 0;
  deltaMode = 0;
  ctrlKey = false;
  metaKey = false;
  target: FakeElement | null = null;

  constructor(readonly type: string, init: Partial<FakeEvent> = {}) {
    Object.assign(this, init);
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeProperty(name: string): string {
    const value = this.values.get(name) || "";
    this.values.delete(name);
    return value;
  }

  set colorScheme(value: string) {
    this.setProperty("color-scheme", value);
  }

  set left(value: string) {
    this.setProperty("left", value);
  }

  set top(value: string) {
    this.setProperty("top", value);
  }

  set translate(value: string) {
    this.setProperty("translate", value);
  }

  set strokeWidth(value: string) {
    this.setProperty("stroke-width", value);
  }

  set opacity(value: string) {
    this.setProperty("opacity", value);
  }

  set cursor(value: string) {
    this.setProperty("cursor", value);
  }

  set background(value: string) {
    this.setProperty("background", value);
  }
}

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  add(...classNames: string[]): void {
    this.write([...this.read(), ...classNames]);
  }

  remove(...classNames: string[]): void {
    const remove = new Set(classNames);
    this.write(this.read().filter((className) => !remove.has(className)));
  }

  toggle(className: string, force?: boolean): void {
    const classNames = new Set(this.read());
    const shouldAdd = force ?? !classNames.has(className);
    if (shouldAdd) classNames.add(className);
    else classNames.delete(className);
    this.write([...classNames]);
  }

  contains(className: string): boolean {
    return this.read().includes(className);
  }

  private read(): string[] {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  private write(classNames: string[]): void {
    this.element.className = [...new Set(classNames)].join(" ");
  }
}

function findById(root: FakeElement, id: string): FakeElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return undefined;
}

function findByClass(root: FakeElement, className: string): FakeElement[] {
  const matches: FakeElement[] = [];
  const classes = new Set(root.className.split(/\s+/).filter(Boolean));
  if (classes.has(className)) matches.push(root);
  for (const child of root.children) matches.push(...findByClass(child, className));
  return matches;
}

function findByText(root: FakeElement, text: string): FakeElement | undefined {
  if (root.textContent === text) return root;
  for (const child of root.children) {
    const match = findByText(child, text);
    if (match) return match;
  }
  return undefined;
}

function dispatchPointerSequence(root: FakeElement, x: number, y: number): void {
  root.dispatch("pointerdown", { pointerId: 1, clientX: x, clientY: y });
  root.dispatch("pointerup", { pointerId: 1, clientX: x, clientY: y });
}

function dataKey(attribute: string): string {
  return attribute.slice("data-".length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
