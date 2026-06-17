import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const workbenchUrl = process.env.GRAPH_WORKBENCH_URL || "";
const artifactDir = process.env.GRAPH_WORKBENCH_ARTIFACT_DIR || "";
const executablePath = process.env.GRAPH_WORKBENCH_CHROME_EXECUTABLE || "";

assert.notEqual(workbenchUrl, "", "GRAPH_WORKBENCH_URL must point at the workbench dev server");

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const desktop = await runDesktopChecks(browser);
  const narrow = await runNarrowChecks(browser);
  const evidence = {
    desktop,
    narrow
  };
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "phase-6-workbench-interactions.json"),
      `${JSON.stringify(evidence, null, 2)}\n`
    );
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}

async function runDesktopChecks(browser) {
  const page = await openWorkbenchGraphPage(browser, { width: 1440, height: 960 }, "dark");
  const evidence = {
    viewport: "1440x960",
    wheelTargets: {},
    blockedWheelTargets: {},
    hover: {},
    drawer: {},
    communityDrag: {},
    dragRefreshRace: {},
    rootScroll: {},
    panAndReset: {}
  };

  evidence.wheelTargets.blank = await assertWheelZoomsFromReset(page, () => findBlankPoint(page), "blank");
  evidence.wheelTargets.node = await assertWheelZoomsFromReset(page, () => nodeCenter(page, "A"), "node");
  evidence.wheelTargets.communityWash = await assertWheelZoomsFromReset(page, () => findCommunityWashPoint(page, "t1"), "community wash");
  evidence.wheelTargets.edge = await assertWheelZoomsFromReset(page, () => firstEdgeMidpoint(page), "edge");

  await openSearch(page);
  evidence.blockedWheelTargets.search = await assertWheelDoesNotZoom(page, await elementCenter(page, ".graph-search-input"), "search input");
  await page.keyboard.press("Escape");
  await waitForSearchState(page, "closed");
  await openToolbarFilters(page);
  evidence.blockedWheelTargets.toolbar = await assertWheelDoesNotZoom(page, await elementCenter(page, ".graph-toolbar-panel"), "toolbar panel");
  evidence.blockedWheelTargets.legend = await assertWheelDoesNotZoom(page, await elementCenter(page, ".community-legend-row"), "legend row");
  await closeToolbarWithBlankClick(page);
  await waitForToolbarPanel(page, "closed");
  evidence.blockedWheelTargets.minimap = await assertWheelDoesNotZoom(page, await elementCenter(page, ".mini-map"), "minimap");

  await resetGraphView(page);
  evidence.rootScroll = await assertGraphRootScrollResets(page);
  evidence.hover.beforeZoom = await hoverNodeAndMeasure(page, "A");
  await assertWheelZoomsFromReset(page, () => nodeCenter(page, "A"), "hovered node zoom");
  evidence.hover.afterZoom = await hoverNodeAndMeasure(page, "A");
  assertStableHoverOffset(evidence.hover.beforeZoom, evidence.hover.afterZoom, "hover should stay anchored after zoom");

  await page.locator(".node[data-id='A']").click();
  await page.waitForSelector(".drawer-panel-open");
  evidence.drawer.opened = await drawerAndGraphSnapshot(page);
  evidence.blockedWheelTargets.drawer = await assertWheelDoesNotZoom(page, await elementCenter(page, ".drawer-panel-open"), "drawer");
  await resizeDrawer(page, -120);
  evidence.drawer.afterResize = await drawerAndGraphSnapshot(page);
  evidence.hover.withDrawer = await hoverNodeAndMeasure(page, "B");
  await assertBoxInsideViewport(page, ".graph-hover-preview", "hover preview with drawer open");
  await page.locator(".drawer-header button[aria-label='关闭']").click();
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });

  await resetGraphView(page);
  evidence.communityDrag = await runCommunityDragCheck(page);
  evidence.panAndReset = await runPanMinimapResetCheck(page);
  evidence.dragRefreshRace = await runDragRefreshRaceCheck(page);

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "phase-6-workbench-desktop.png"), fullPage: true });
  }
  await page.close();
  return evidence;
}

async function runNarrowChecks(browser) {
  const page = await openWorkbenchGraphPage(browser, { width: 390, height: 844 }, "light");
  const communityId = await firstCommunityWashId(page);
  const nodeId = await ensureAnyNodeInteractable(page, ["A", "B", "C"]);
  const evidence = {
    viewport: "390x844",
    wheelTargets: {},
    hover: {},
    drawer: {},
    communityId,
    nodeId
  };
  evidence.wheelTargets.node = await assertWheelZoomsFromReset(page, () => nodeCenter(page, nodeId), "narrow node");
  evidence.wheelTargets.communityWash = await assertWheelZoomsFromReset(page, () => findCommunityWashPoint(page, communityId), "narrow community wash");
  evidence.hover.node = await hoverNodeAndMeasure(page, nodeId);
  await assertBoxInsideViewport(page, ".graph-hover-preview", "narrow hover preview");
  await page.locator(`.node[data-id="${cssString(nodeId)}"]`).click();
  await page.waitForSelector(".drawer-panel-open");
  evidence.drawer = await drawerAndGraphSnapshot(page);
  await assertBoxInsideViewport(page, ".drawer-panel-open", "narrow drawer");

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "phase-6-workbench-narrow.png"), fullPage: true });
  }
  await page.close();
  return evidence;
}

async function openWorkbenchGraphPage(browser, viewport, theme) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.__graphWorkbenchTest = {
      round(value) {
        return Math.round(value * 1000) / 1000;
      },
      roundRect(rect) {
        return {
          left: this.round(rect.left),
          top: this.round(rect.top),
          right: this.round(rect.right),
          bottom: this.round(rect.bottom),
          width: this.round(rect.width),
          height: this.round(rect.height)
        };
      },
      relativeRect(rect, rootRect) {
        return {
          left: this.round(rect.left - rootRect.left),
          top: this.round(rect.top - rootRect.top),
          right: this.round(rect.right - rootRect.left),
          bottom: this.round(rect.bottom - rootRect.top),
          width: this.round(rect.width),
          height: this.round(rect.height)
        };
      },
      relativePoint(point, rootRect) {
        return {
          x: this.round(point.x - rootRect.left),
          y: this.round(point.y - rootRect.top)
        };
      },
      minimapSnapshot(mini) {
        return {
          x: this.round(Number(mini.getAttribute("x"))),
          y: this.round(Number(mini.getAttribute("y"))),
          width: this.round(Number(mini.getAttribute("width"))),
          height: this.round(Number(mini.getAttribute("height")))
        };
      }
    };
  });
  await page.addInitScript(({ theme }) => {
    window.localStorage.setItem("llm-wiki-agent-main-view", "graph");
    window.localStorage.setItem("llm-wiki-agent-theme", theme);
  }, { theme });
  await page.goto(workbenchUrl);
  await page.waitForSelector(".app-shell");
  const kbButton = page.getByRole("button", { name: /Phase 6 Workbench Test|phase-6-workbench/ });
  if (await kbButton.count() && await kbButton.first().isVisible()) {
    await kbButton.first().click();
  }
  const graphButton = page.getByRole("button", { name: /图谱/ });
  if (await graphButton.count() && await graphButton.first().isVisible()) {
    if (await graphButton.first().isEnabled()) {
      await graphButton.first().click();
    }
  }
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".node[data-id='A']", { state: "attached" });
  await page.waitForSelector(".community-wash", { state: "attached" });
  const expectedGraphTheme = theme === "dark" ? "mo-ye" : "shan-shui";
  await page.waitForFunction((expectedGraphTheme) => {
    return document.querySelector(".graph-screen")?.dataset.graphTheme === expectedGraphTheme
      && document.querySelector(".llm-wiki-graph-engine")?.dataset.theme === expectedGraphTheme;
  }, expectedGraphTheme);
  await resetGraphView(page);
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  await page.waitForSelector(".community-wash");
  return page;
}

async function assertWheelZooms(page, point, label) {
  const before = await layerTransform(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -420);
  const after = await waitForLayerTransform(page, before);
  assert.notEqual(after, before, `wheel over ${label} should zoom`);
  return { before, after, point: roundedPoint(point) };
}

async function assertWheelZoomsFromReset(page, pointFactory, label) {
  await resetGraphView(page);
  const point = await pointFactory();
  return assertWheelZooms(page, point, label);
}

async function assertWheelDoesNotZoom(page, point, label) {
  const before = await layerTransform(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(160);
  const after = await layerTransform(page);
  assert.equal(after, before, `wheel over ${label} should not zoom`);
  return { before, after, point: roundedPoint(point) };
}

async function runCommunityDragCheck(page) {
  await clickCommunityWash(page, "t1");
  await waitForVisibleNodeIds(page, ["A", "B"]);
  const initial = await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const wash = document.querySelector(".community-wash[data-community-id='t1']");
    const node = document.querySelector(".node[data-id='A']");
    if (!root || !wash || !node) throw new Error("Missing community drag elements");
    const rootRect = root.getBoundingClientRect();
    const washRect = wash.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      wash: window.__graphWorkbenchTest.relativeRect(washRect, rootRect),
      nodeCenter: {
        x: nodeRect.left + nodeRect.width / 2,
        y: nodeRect.top + nodeRect.height / 2
      }
    };
  });
  const target = { x: initial.nodeCenter.x + 360, y: initial.nodeCenter.y + 24 };
  await page.mouse.move(initial.nodeCenter.x, initial.nodeCenter.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.waitForTimeout(80);
  const during = await page.locator(".node[data-id='A']").evaluate((node) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing root during drag");
    const rootRect = root.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return {
      center: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      },
      rootDragging: root.dataset.dragging || ""
    };
  });
  const pointerDistance = Math.hypot(during.center.x - target.x, during.center.y - target.y);
  assert.ok(pointerDistance <= 48, `dragged node should stay under the pointer, distance=${pointerDistance.toFixed(1)}`);
  await page.mouse.up();
  await page.waitForSelector(".node[data-id='A'][data-pinned='true']");
  await page.waitForTimeout(140);
  const after = await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const wash = document.querySelector(".community-wash[data-community-id='t1']");
    const node = document.querySelector(".node[data-id='A']");
    const mini = document.querySelector("[data-mini-map-viewport='true']");
    if (!root || !wash || !node || !mini) throw new Error("Missing community drag elements after drag");
    const rootRect = root.getBoundingClientRect();
    const washRect = wash.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      wash: window.__graphWorkbenchTest.relativeRect(washRect, rootRect),
      washWorld: {
        rx: Number(wash.getAttribute("rx")),
        ry: Number(wash.getAttribute("ry"))
      },
      nodeCenter: {
        x: nodeRect.left + nodeRect.width / 2 - rootRect.left,
        y: nodeRect.top + nodeRect.height / 2 - rootRect.top
      },
      pinned: node.dataset.pinned,
      dragging: root.dataset.dragging || "",
      visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort(),
      mini: window.__graphWorkbenchTest.minimapSnapshot(mini)
    };
  });
  assert.equal(after.pinned, "true", "dragging a community node outside the wash should pin it");
  assert.equal(after.dragging, "", "drag should not remain stuck after release");
  assert.ok(after.nodeCenter.x > initial.wash.right + 24, "dragged node should leave the initial community wash");
  assert.ok(after.washWorld.rx <= 190 && after.washWorld.ry <= 142.8, "community wash should remain capped after dragged outlier");
  assertValidMinimap(after.mini, "after community drag");
  return {
    initial: roundObject(initial),
    during: roundObject({ pointerDistance, rootDragging: during.rootDragging }),
    after: roundObject(after)
  };
}

async function runPanMinimapResetCheck(page) {
  const before = await graphSnapshot(page);
  const blank = await findBlankPoint(page);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 180, blank.y + 64, { steps: 5 });
  await page.mouse.up();
  const afterPanTransform = await waitForLayerTransform(page, before.transform);
  await page.waitForTimeout(120);
  const afterPan = await graphSnapshot(page);
  assert.notDeepEqual(afterPan.mini, before.mini, "blank pan should update minimap viewport");
  await resetGraphView(page);
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  const afterReset = await graphSnapshot(page);
  assert.deepEqual(afterReset.visibleNodes, ["A", "B", "C"], "reset view should return to all nodes");
  assertValidMinimap(afterReset.mini, "after reset");
  return {
    before,
    afterPan: { ...afterPan, transform: afterPanTransform },
    afterReset
  };
}

async function runDragRefreshRaceCheck(page) {
  await resetGraphView(page);
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  const nodeId = await ensureAnyNodeInteractable(page, ["B", "C", "A"]);
  const before = await nodeSnapshot(page, nodeId);
  const target = { x: before.center.x + 260, y: before.center.y + 18 };

  await page.mouse.move(before.center.x, before.center.y);
  await page.mouse.down();
  await page.mouse.move(before.center.x + 72, before.center.y + 8, { steps: 3 });
  await page.waitForFunction((nodeId) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return root?.dataset.dragging === nodeId;
  }, nodeId);

  const refreshStart = await startGraphRefreshProbe(page);
  await page.mouse.move(target.x, target.y, { steps: 1 });
  await page.mouse.up();
  await page.waitForSelector(`.node[data-id="${cssString(nodeId)}"][data-pinned="true"]`);
  const refresh = await waitForGraphRefreshProbe(page);
  await page.waitForTimeout(360);
  const after = await nodeSnapshot(page, nodeId);
  const pointerDistance = Math.hypot(after.center.x - target.x, after.center.y - target.y);

  assert.equal(after.pinned, "true", "dragged node should remain pinned after a graph refresh");
  assert.equal(after.dragging, "", "drag refresh should not leave node dragging active");
  assert.ok(pointerDistance <= 72, `dragged node should stay near release after refresh, distance=${pointerDistance.toFixed(1)}`);

  return roundObject({
    nodeId,
    refreshStart,
    refresh,
    before,
    target,
    after,
    pointerDistance
  });
}

async function nodeSnapshot(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const rect = node.getBoundingClientRect();
    return {
      id: node.dataset.id || "",
      center: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      },
      pinned: node.dataset.pinned || "",
      dragging: root?.dataset.dragging || ""
    };
  });
}

async function startGraphRefreshProbe(page) {
  return page.evaluate(async () => {
    const activeResponse = await fetch("/api/knowledge-base");
    const active = await activeResponse.json();
    const kbPath = active?.active?.kb?.path;
    if (!kbPath) throw new Error("No active knowledge base for graph refresh probe");
    const source = new EventSource("/api/events");
    window.__graphRefreshRace = {
      kbPath,
      response: null,
      event: null,
      error: null
    };
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Timed out waiting for graph event stream")), 4000);
      source.addEventListener("ready", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
      source.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("Graph event stream failed before ready"));
      }, { once: true });
    });
    source.addEventListener("graph_updated", (message) => {
      const event = JSON.parse(message.data);
      if (event.kbPath !== kbPath) return;
      window.__graphRefreshRace.event = event;
      source.close();
    });
    source.addEventListener("graph_error", (message) => {
      const event = JSON.parse(message.data);
      if (event.kbPath !== kbPath) return;
      window.__graphRefreshRace.error = event.message || "graph_error";
      window.__graphRefreshRace.event = event;
      source.close();
    });
    fetch(`/api/graph/rebuild?kb=${encodeURIComponent(kbPath)}`, { method: "POST" })
      .then((response) => response.json())
      .then((json) => {
        window.__graphRefreshRace.response = json;
      })
      .catch((err) => {
        window.__graphRefreshRace.error = err instanceof Error ? err.message : String(err);
        source.close();
      });
    return { kbPath };
  });
}

async function waitForGraphRefreshProbe(page) {
  await page.waitForFunction(() => {
    const state = window.__graphRefreshRace;
    return Boolean(state?.event || state?.error);
  }, undefined, { timeout: 15000 });
  const state = await page.evaluate(() => window.__graphRefreshRace);
  assert.equal(state.error, null, `graph refresh probe should not error: ${state.error}`);
  assert.ok(state.response?.ok, `graph refresh trigger should return ok: ${JSON.stringify(state.response)}`);
  assert.equal(state.event?.type, "graph_updated", "graph refresh probe should receive graph_updated");
  return state;
}

async function resetGraphView(page) {
  const before = await layerTransform(page);
  await page.locator("[data-llm-wiki-graph-root='true']").getByRole("button", { name: "回全图" }).click();
  await page.waitForTimeout(220);
  const after = await layerTransform(page);
  if (after === before) {
    await page.waitForTimeout(120);
  }
}

async function hoverNodeAndMeasure(page, id) {
  await ensureNodeInteractable(page, id);
  const point = await nodeCenter(page, id);
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector(".graph-hover-preview[data-state='open'][data-kind='node']");
  await page.locator(".graph-hover-preview-title").waitFor();
  const measurement = await page.evaluate((id) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const node = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    const preview = document.querySelector(".graph-hover-preview");
    if (!root || !node || !preview) throw new Error("Missing hover measurement elements");
    const rootRect = root.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const nodeAnchor = {
      x: nodeRect.left + nodeRect.width / 2,
      y: nodeRect.top + nodeRect.height / 2
    };
    return {
      nodeAnchor: window.__graphWorkbenchTest.relativePoint(nodeAnchor, rootRect),
      preview: window.__graphWorkbenchTest.relativeRect(previewRect, rootRect),
      offset: {
        x: previewRect.left - nodeAnchor.x,
        y: previewRect.bottom - nodeAnchor.y
      }
    };
  }, id);
  await assertBoxInsideViewport(page, ".graph-hover-preview", `hover preview for ${id}`);
  await assertGraphRootNotScrolled(page, `hover preview for ${id}`);
  return roundObject(measurement);
}

async function assertGraphRootScrollResets(page) {
  const before = await graphRootScroll(page);
  await page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => {
    root.scrollLeft = 120;
    root.scrollTop = 240;
  });
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return root && root.scrollLeft === 0 && root.scrollTop === 0;
  });
  const after = await graphRootScroll(page);
  assert.deepEqual(after, { left: 0, top: 0 }, "graph root native scroll should reset to zero");
  return { before, after };
}

async function assertGraphRootNotScrolled(page, label) {
  const scroll = await graphRootScroll(page);
  assert.deepEqual(scroll, { left: 0, top: 0 }, `${label}: graph root native scroll should stay at zero`);
}

async function graphRootScroll(page) {
  return page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => ({
    left: root.scrollLeft,
    top: root.scrollTop
  }));
}

async function ensureNodeInteractable(page, id) {
  if (await isNodeInteractable(page, id)) return;
  await resetGraphView(page);
  await page.waitForTimeout(180);
  assert.equal(await isNodeInteractable(page, id), true, `node ${id} should be interactable after reset`);
}

async function ensureAnyNodeInteractable(page, ids) {
  for (const id of ids) {
    if (await isNodeInteractable(page, id)) return id;
  }
  await resetGraphView(page);
  await page.waitForTimeout(180);
  for (const id of ids) {
    if (await isNodeInteractable(page, id)) return id;
  }
  const diagnostics = await page.evaluate((ids) => {
    return ids.map((id) => {
      const node = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
      if (!node) return { id, present: false };
      const rect = node.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
      const hit = document.elementFromPoint(center.x, center.y);
      return {
        id,
        present: true,
        center,
        hitTag: hit?.tagName || "",
        hitClass: hit instanceof Element ? hit.className : "",
        hitNodeId: hit instanceof Element ? hit.closest(".node")?.getAttribute("data-id") || "" : ""
      };
    });
  }, ids);
  assert.fail(`expected at least one interactable node after reset: ${JSON.stringify(diagnostics)}`);
}

async function isNodeInteractable(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    const hit = document.elementFromPoint(center.x, center.y);
    return Boolean(hit?.closest?.(`.node[data-id="${CSS.escape(node.dataset.id || "")}"]`));
  });
}

function assertStableHoverOffset(before, after, message) {
  const dx = Math.abs(after.offset.x - before.offset.x);
  const dy = Math.abs(after.offset.y - before.offset.y);
  assert.ok(dx <= 8, `${message}: x offset drifted by ${dx.toFixed(2)}px`);
  assert.ok(dy <= 8, `${message}: y offset drifted by ${dy.toFixed(2)}px`);
}

async function drawerAndGraphSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const drawer = document.querySelector(".drawer-panel-open");
    if (!root || !drawer) throw new Error("Missing drawer snapshot elements");
    return {
      root: window.__graphWorkbenchTest.roundRect(root.getBoundingClientRect()),
      drawer: window.__graphWorkbenchTest.roundRect(drawer.getBoundingClientRect()),
      transform: document.querySelector("[data-viewport-layer='true']")?.style.transform || "",
      visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort()
    };
  });
  await assertBoxInsideViewport(page, ".drawer-panel-open", "drawer");
  await assertBoxInsideViewport(page, "[data-llm-wiki-graph-root='true']", "graph root with drawer");
  return snapshot;
}

async function resizeDrawer(page, deltaX) {
  const handle = page.locator(".drawer-resize-handle");
  await handle.waitFor();
  const box = await handle.boundingBox();
  assert.ok(box, "drawer resize handle should have a bounding box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + deltaX, start.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(160);
}

async function graphSnapshot(page) {
  return roundObject(await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const mini = document.querySelector("[data-mini-map-viewport='true']");
    if (!root || !mini) throw new Error("Missing graph snapshot elements");
    return {
      transform: document.querySelector("[data-viewport-layer='true']")?.style.transform || "",
      root: window.__graphWorkbenchTest.roundRect(root.getBoundingClientRect()),
      mini: window.__graphWorkbenchTest.minimapSnapshot(mini),
      visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort()
    };
  }));
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  await page.waitForFunction(
    (previous) => document.querySelector("[data-viewport-layer='true']")?.style.transform !== previous,
    previous,
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function waitForVisibleNodeIds(page, expected) {
  await page.waitForFunction((expected) => {
    const actual = [...document.querySelectorAll(".node")].map((node) => node.dataset.id).sort();
    return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
  }, expected);
}

async function clickCommunityWash(page, communityId) {
  const point = await findCommunityWashPoint(page, communityId);
  await page.mouse.click(point.x, point.y);
}

async function nodeCenter(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
}

async function elementCenter(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  });
}

async function firstEdgeMidpoint(page) {
  return page.locator(".edge").first().evaluate((edge) => {
    if (!(edge instanceof SVGPathElement)) throw new Error("edge should be an SVG path");
    const svg = edge.ownerSVGElement;
    if (!svg) throw new Error("edge should have an owner SVG");
    const length = edge.getTotalLength();
    const mid = edge.getPointAtLength(length / 2);
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: rect.left + (mid.x - viewBox.x) / viewBox.width * rect.width,
      y: rect.top + (mid.y - viewBox.y) / viewBox.height * rect.height
    };
  });
}

async function findCommunityWashPoint(page, communityId) {
  return page.evaluate((communityId) => {
    const wash = document.querySelector(`.community-wash[data-community-id="${CSS.escape(communityId)}"]`);
    if (!wash) throw new Error(`Missing community wash ${communityId}`);
    const rect = wash.getBoundingClientRect();
    const candidates = [
      [0.5, 0.18],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.82],
      [0.32, 0.32],
      [0.68, 0.68],
      [0.5, 0.5]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      if (document.elementFromPoint(x, y)?.closest?.(".community-wash") === wash) {
        return { x, y };
      }
    }
    throw new Error("Could not find exposed community wash point");
  }, communityId);
}

async function firstCommunityWashId(page) {
  return page.evaluate(() => {
    const wash = document.querySelector(".community-wash[data-community-id]");
    const id = wash?.getAttribute("data-community-id") || "";
    if (!id) throw new Error("Missing community wash id");
    return id;
  });
}

async function findBlankPoint(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing graph root");
    const rect = root.getBoundingClientRect();
    const blocked = ".node,.community-wash,.edge,.graph-toolbar,.mini-map,.graph-search,.drawer-panel-open";
    const xs = [0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88];
    const ys = [0.18, 0.32, 0.48, 0.64, 0.8, 0.9];
    for (const ry of ys) {
      for (const rx of xs) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !root.contains(hit)) continue;
        if (hit.closest(blocked)) continue;
        return { x, y };
      }
    }
    throw new Error("Could not find blank graph point");
  });
}

async function closeToolbarWithBlankClick(page) {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  const point = await findBlankPoint(page);
  const pointer = {
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true
  };
  await root.dispatchEvent("pointerdown", {
    ...pointer,
    buttons: 1
  });
  await root.dispatchEvent("pointerup", pointer);
}

async function waitForToolbarPanel(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".llm-wiki-graph-engine")?.dataset.toolbarPanel === state;
  }, state);
}

async function openToolbarFilters(page) {
  const state = await page.locator("[data-llm-wiki-graph-root='true']").evaluate((element) => element.dataset.toolbarPanel || "");
  if (state !== "filters") {
    await page.locator(".graph-toolbar-button").filter({ hasText: "筛选" }).click();
  }
  await waitForToolbarPanel(page, "filters");
  await page.waitForSelector('.graph-toolbar-panel[data-state="filters"] .community-legend-row');
}

async function openSearch(page) {
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  await root.click({ position: { x: 24, y: 24 } });
  await root.evaluate((element) => element.focus({ preventScroll: true }));
  await page.keyboard.press(searchShortcut());
  await waitForSearchState(page, "open");
}

async function waitForSearchState(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".graph-search")?.dataset.state === state;
  }, state);
}

function searchShortcut() {
  return process.platform === "darwin" ? "Meta+F" : "Control+F";
}

async function assertBoxInsideViewport(page, selector, label) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${label}: ${selector} should have a bounding box`);
  const viewport = page.viewportSize();
  assert.ok(viewport, `${label}: viewport should be available`);
  const debug = async () => JSON.stringify(await boxDebugSnapshot(page, selector), null, 2);
  assert.ok(box.x >= -1, `${label}: ${selector} should not overflow left\n${await debug()}`);
  assert.ok(box.y >= -1, `${label}: ${selector} should not overflow top\n${await debug()}`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label}: ${selector} should not overflow right\n${await debug()}`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label}: ${selector} should not overflow bottom\n${await debug()}`);
}

async function boxDebugSnapshot(page, selector) {
  return page.evaluate((selector) => {
    const target = document.querySelector(selector);
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const layer = document.querySelector("[data-viewport-layer='true']");
    const node = document.querySelector(".node[data-id='A']");
    const preview = document.querySelector(".graph-hover-preview");
    const rect = (element) => element ? window.__graphWorkbenchTest.roundRect(element.getBoundingClientRect()) : null;
    return {
      selector,
      target: rect(target),
      root: rect(root),
      rootScroll: root ? { left: root.scrollLeft, top: root.scrollTop } : null,
      layerTransform: layer?.style.transform || "",
      viewportAnimating: root?.dataset.viewportAnimating || "",
      nodeA: rect(node),
      preview: rect(preview),
      previewStyle: preview ? {
        left: preview.style.left,
        top: preview.style.top,
        state: preview.dataset.state || "",
        kind: preview.dataset.kind || ""
      } : null,
      previewComputed: preview ? {
        top: window.getComputedStyle(preview).top,
        left: window.getComputedStyle(preview).left,
        position: window.getComputedStyle(preview).position,
        offsetParentClass: preview.offsetParent?.className || "",
        offsetParentTag: preview.offsetParent?.tagName || "",
        offsetTop: preview.offsetTop,
        offsetLeft: preview.offsetLeft
      } : null,
      scroll: {
        x: window.scrollX,
        y: window.scrollY
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }, selector);
}

function assertValidMinimap(mini, label) {
  assert.ok(Number.isFinite(mini.x) && Number.isFinite(mini.y), `${label}: minimap position should be finite`);
  assert.ok(mini.width > 0 && mini.height > 0, `${label}: minimap size should be positive`);
}

function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function roundedPoint(point) {
  return {
    x: round(point.x),
    y: round(point.y)
  };
}

function roundObject(value) {
  if (Array.isArray(value)) return value.map(roundObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundObject(item)]));
  }
  if (typeof value === "number") return round(value);
  return value;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
