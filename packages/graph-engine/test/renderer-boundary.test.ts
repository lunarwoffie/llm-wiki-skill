import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommunityWashElement } from "../src/render/community-washes";
import { createGraphEdgeElement } from "../src/render/edges";
import { createGraphMinimap } from "../src/render/minimap";
import { createGraphNodeElement } from "../src/render/nodes";
import type { RenderableCommunity, RenderableEdge, RenderableMinimap, RenderableNode } from "../src/render";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

const HOST_CALLBACK_IDENTIFIERS = [
  "onOpenPage",
  "onSelectionChange",
  "onSelectionClear",
  "onAsk",
  "persistPins",
  "onDragStateChange",
  "GraphEngineCapabilities",
  "GraphOpenPagePayload"
];

const HOST_CALLBACK_ALLOWED_FILES = new Set(["facade.ts", "types.ts"]);
const RAW_GRAPH_EVENT_ALLOWED_FILES = new Set([
  "render/gestures.ts",
  "render/keyboard.ts",
  "render/host-dom.ts",
  "render/static-renderer.ts",
  "render/controls.ts",
  "render/offline-reader.ts"
]);
const RAW_GRAPH_EVENT_PATTERNS = [
  /\baddEventListener\s*\(\s*["'](?:wheel|pointerdown|pointermove|pointerup|pointercancel|lostpointercapture)["']/,
  /\bremoveEventListener\s*\(\s*["'](?:wheel|pointerdown|pointermove|pointerup|pointercancel|lostpointercapture)["']/,
  /\bsetPointerCapture\s*\(/,
  /\breleasePointerCapture\s*\(/,
  /\bclassifyGraph(?:EventTarget|WheelTarget|WheelTargetFromGraphTarget|PointerDownTarget|PointerDownTargetFromGraphTarget)\s*\(/,
  /\bpreventDefault\s*\(/
];
const DRAWING_MODULES = [
  "render/nodes.ts",
  "render/edges.ts",
  "render/community-washes.ts",
  "render/minimap.ts",
  "render/overlays.ts",
  "render/hover-card.ts"
] as const;
const FORBIDDEN_RENDERER_EVENT_TYPES = new Set([
  "wheel",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "lostpointercapture"
]);

describe("renderer and facade boundary contract", () => {
  it("keeps host callback names out of layout and renderer modules", async () => {
    const files = await sourceFiles(SRC);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file);
      if (HOST_CALLBACK_ALLOWED_FILES.has(rel)) continue;
      const text = await readFile(file, "utf8");
      for (const identifier of HOST_CALLBACK_IDENTIFIERS) {
        if (new RegExp(`\\b${identifier}\\b`).test(text)) violations.push(`${rel}: ${identifier}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it("keeps graph object hit classification calls inside GraphGestures", async () => {
    const renderFiles = (await sourceFiles(join(SRC, "render")))
      .filter((file) => {
        const rel = relative(SRC, file);
        return rel !== "render/gestures.ts" && rel !== "render/index.ts";
      });
    const violations: string[] = [];
    const forbiddenCalls = /\bclassifyGraph(?:EventTarget|WheelTarget|WheelTargetFromGraphTarget|PointerDownTarget|PointerDownTargetFromGraphTarget)\s*\(/;

    for (const file of renderFiles) {
      const rel = relative(SRC, file);
      const text = await readFile(file, "utf8");
      if (forbiddenCalls.test(text)) violations.push(rel);
    }

    assert.deepEqual(violations, []);
  });

  it("keeps raw graph gesture ownership out of drawing modules", async () => {
    const violations: string[] = [];

    for (const rel of DRAWING_MODULES) {
      const text = await readFile(join(SRC, rel), "utf8");
      for (const pattern of RAW_GRAPH_EVENT_PATTERNS) {
        if (pattern.test(text)) violations.push(`${rel}: ${pattern}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it("keeps root graph wheel and pointer bindings inside GraphGestures", async () => {
    const renderFiles = await sourceFiles(join(SRC, "render"));
    const violations: string[] = [];

    for (const file of renderFiles) {
      const rel = relative(SRC, file);
      if (RAW_GRAPH_EVENT_ALLOWED_FILES.has(rel)) continue;
      const text = await readFile(file, "utf8");
      for (const pattern of RAW_GRAPH_EVENT_PATTERNS) {
        if (pattern.test(text)) violations.push(`${rel}: ${pattern}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it("proves drawing modules do not attach global graph gesture listeners at runtime", () => {
    const ownerDocument = new FakeDocument();

    createGraphNodeElement(ownerDocument as unknown as Document, sampleNode(), {
      onNodeClick: () => {},
      onNodeDoubleClick: () => false,
      onNodePreviewEnter: () => {},
      onNodePreviewLeave: () => {}
    });
    createGraphEdgeElement(ownerDocument as unknown as Document, sampleEdge(), {
      onEdgePreviewEnter: () => {},
      onEdgePreviewLeave: () => {}
    });
    createCommunityWashElement(ownerDocument as unknown as Document, sampleCommunity());
    createGraphMinimap(ownerDocument as unknown as Document, sampleMinimap());

    assert.deepEqual(ownerDocument.forbiddenListeners, []);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

function sampleNode(): RenderableNode {
  return {
    id: "node-a",
    label: "Node A",
    type: "topic",
    kind: "TOPIC",
    community: "community-a",
    sourcePath: "wiki/node-a.md",
    x: 50,
    y: 40,
    point: { x: 500, y: 272 },
    displayMode: "card",
    visualRole: "landmark",
    priority: 80,
    weight: 80,
    unavailable: false,
    selected: false,
    startNode: false,
    previewStart: false,
    labelVisible: true
  };
}

function sampleEdge(): RenderableEdge {
  return {
    id: "edge-a",
    source: "node-a",
    target: "node-b",
    type: "extracted",
    confidence: "extracted",
    relationType: "实现",
    relationClass: "relation-implementation",
    path: "M 0 0 Q 50 50 100 100",
    curveOffset: 0,
    strokeWidth: 1.5,
    opacity: 0.8,
    simulationWeight: 1
  };
}

function sampleCommunity(): RenderableCommunity {
  return {
    id: "community-a",
    label: "Community A",
    color: "#c66",
    nodeCount: 3,
    wash: {
      cx: 500,
      cy: 272,
      rx: 120,
      ry: 80,
      opacity: 0.18
    }
  };
}

function sampleMinimap(): RenderableMinimap {
  return {
    path: "M0 0 L100 20",
    nodes: [{ id: "node-a", x: 10, y: 12, r: 3, fill: "#c66", selected: false }]
  };
}

class FakeDocument {
  readonly forbiddenListeners: string[] = [];

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string | undefined> = {};
  readonly style: Record<string, string> = {};
  readonly classList = {
    add: (...classNames: string[]) => {
      this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...classNames])].join(" ");
    },
    toggle: (className: string, force?: boolean) => {
      const classNames = new Set(this.className.split(/\s+/).filter(Boolean));
      const shouldAdd = force ?? !classNames.has(className);
      if (shouldAdd) classNames.add(className);
      else classNames.delete(className);
      this.className = [...classNames].join(" ");
    }
  };
  className = "";
  textContent = "";
  type = "";
  title = "";
  href = "";
  innerHTML = "";

  constructor(readonly tagName: string, private readonly ownerDocument: FakeDocument) {}

  append(...children: Array<FakeElement | string>): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        this.children.push(child);
      }
    }
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    if (name === "class") this.className = value;
    else if (name === "href") this.href = value;
    else (this as unknown as Record<string, string>)[name] = value;
  }

  addEventListener(type: string, _listener: unknown): void {
    if (FORBIDDEN_RENDERER_EVENT_TYPES.has(type)) {
      this.ownerDocument.forbiddenListeners.push(`${this.tagName}:${type}`);
    }
  }
}
