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
    communitySummary: {},
    blankAndDoubleClick: {},
    returnGlobalState: {},
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
  await page.waitForSelector('[data-testid="graph-node-summary"]');
  evidence.drawer.opened = await drawerAndGraphSnapshot(page);
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "打开详情" }).click();
  await page.waitForSelector(".graph-reader-drawer");
  await waitForCommunityFocus(page, "t1", "open detail should enter the node community");
  await page.waitForFunction(() => document.querySelector(".node[data-id='A'][aria-pressed='true']"));
  evidence.drawer.detailRead = await drawerAndGraphSnapshot(page);
  evidence.blockedWheelTargets.drawer = await assertWheelDoesNotZoom(page, await elementCenter(page, ".drawer-panel-open"), "drawer");
  await resizeDrawer(page, -120);
  evidence.drawer.afterResize = await drawerAndGraphSnapshot(page);
  evidence.hover.withDrawer = await hoverNodeAndMeasure(page, "B");
  await assertBoxInsideViewport(page, ".graph-hover-preview", "hover preview with drawer open");
  await page.locator(".drawer-header button[aria-label='关闭']").click();
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });

  await resetGraphView(page, ["A", "B", "C"]);
  evidence.communitySummary.wash = await runCommunitySummaryWashCheck(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  evidence.communitySummary.legend = await runCommunitySummaryLegendCheck(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  evidence.communitySummary.coreList = await runCommunitySummaryCoreListFlow(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  evidence.blankAndDoubleClick = await runBlankAndDoubleClickCheck(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  evidence.returnGlobalState = await runReturnGlobalStatePreservationCheck(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  evidence.communityDrag = await runCommunityDragCheck(page);
  await resetGraphLayout(page);
  await resetGraphView(page, ["A", "B", "C"]);
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
  await page.waitForSelector('[data-testid="graph-node-summary"]');
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
  await openCommunitySummaryFromWash(page, "t1");
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await waitForViewportAnimationIdle(page);
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

async function runCommunitySummaryWashCheck(page) {
  return openCommunitySummaryFromWash(page, "t1");
}

async function runCommunitySummaryLegendCheck(page) {
  const before = await graphSnapshot(page);
  await openToolbarFilters(page);
  await page.locator('.graph-toolbar-panel[data-state="filters"] .community-legend-row[data-community-id="t1"]').click();
  await page.waitForSelector('[data-testid="graph-community-summary"]');
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  const after = await graphSnapshot(page);
  assert.equal(transformScale(after.transform), transformScale(before.transform), "legend community click should preserve the global zoom scale");
  assert.deepEqual(after.visibleNodes, ["A", "B", "C"], "legend community click should keep the global node set visible");
  return { before, after };
}

async function runCommunitySummaryCoreListFlow(page) {
  const summary = await openCommunitySummaryFromWash(page, "t1");
  const nodeLink = page.locator('[data-testid="graph-community-summary"] .graph-summary-node-link').filter({ hasText: "A" }).first();
  await nodeLink.hover();
  await page.waitForSelector(".graph-hover-preview[data-state='open'][data-kind='node']");
  const hover = await hoverPreviewSnapshot(page);
  await nodeLink.click();
  await page.waitForSelector('[data-testid="graph-node-summary"]');
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  const nodeSummary = await graphSnapshot(page);
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "进入社区" }).click();
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await waitForCommunityFocus(page, "t1", "node summary enter-community should focus the community");
  const focused = await graphSnapshot(page);
  return { summary, hover, nodeSummary, focused };
}

async function runBlankAndDoubleClickCheck(page) {
  const blockers = {};

  await openCommunitySummaryFromWash(page, "t1");
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await waitForCommunityFocus(page, "t1", "blank click setup should focus the community");
  await page.locator(".node[data-id='A']").click();
  await page.waitForSelector('[data-testid="graph-node-summary"]');
  const beforeBlankClick = await graphSnapshot(page);
  const blankClickPoint = await clickBlankPointThatClearsSelection(page, "A");
  await waitForCommunityFocus(page, "t1", "blank click should not leave community focus");
  const afterBlankClick = await graphSnapshot(page);
  assert.deepEqual(afterBlankClick.visibleNodes, ["A", "B"], "single blank click should preserve community visible nodes");

  const beforeBlankDouble = await graphSnapshot(page);
  const blankDoubleClickPoint = await doubleClickBlankPointThatReturnsGlobal(page);
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  await waitForNoGraphFocus(page, "true blank double click should return global");
  const afterBlankDouble = await graphSnapshot(page);
  assert.notDeepEqual(afterBlankDouble.visibleNodes, beforeBlankDouble.visibleNodes, "true blank double click should leave focused community");

  await openCommunitySummaryFromWash(page, "t1");
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForCommunityFocus(page, "t1", "node double-click setup should focus the community");
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await page.locator(".node[data-id='A']").dblclick();
  await page.waitForTimeout(160);
  await waitForCommunityFocus(page, "t1", "node double-click should not return global");
  assert.equal(await nodePinnedState(page, "A"), "false", "node double-click should not silently pin or unpin");
  blockers.node = await graphSnapshot(page);

  await resetGraphView(page, ["A", "B", "C"]);
  blockers.communityWash = await assertDoubleClickDoesNotReturnGlobal(page, () => findCommunityWashPoint(page, "t1"), "community wash");
  blockers.edge = await assertDoubleClickDoesNotReturnGlobal(page, () => firstEdgeMidpoint(page), "edge");

  await openToolbarFilters(page);
  blockers.toolbar = await assertDoubleClickDoesNotReturnGlobal(page, () => elementCenter(page, ".graph-toolbar-panel"), "toolbar panel");
  blockers.legend = await assertDoubleClickDoesNotReturnGlobal(page, () => elementCenter(page, ".community-legend-row"), "legend row");
  await closeToolbarWithBlankClick(page);
  await waitForToolbarPanel(page, "closed");

  await openSearch(page);
  blockers.search = await assertDoubleClickDoesNotReturnGlobal(page, () => elementCenter(page, ".graph-search-input"), "search input");
  await page.keyboard.press("Escape");
  await waitForSearchState(page, "closed");

  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  await clickNodeForSummary(page, "A", "drawer blocker setup");
  blockers.drawer = await assertDoubleClickDoesNotReturnGlobal(page, () => elementCenter(page, ".drawer-panel-open"), "right drawer");

  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  await clickNodeForSummary(page, "A", "fixed action setup");
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "固定位置" }).click();
  await page.waitForSelector(".node[data-id='A'][data-pinned='true']");
  await page.waitForSelector('[data-testid="graph-node-summary"] button:has-text("取消固定位置")');
  const fixed = await nodeSnapshot(page, "A");
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "取消固定位置" }).click();
  await page.waitForSelector(".node[data-id='A'][data-pinned='false']");
  await page.waitForSelector('[data-testid="graph-node-summary"] button:has-text("固定位置")');
  const unfixed = await nodeSnapshot(page, "A");

  return {
    beforeBlankClick: { ...beforeBlankClick, point: roundedPoint(blankClickPoint) },
    afterBlankClick,
    afterBlankDouble: { ...afterBlankDouble, point: roundedPoint(blankDoubleClickPoint) },
    blockers,
    explicitFixedAction: { fixed, unfixed }
  };
}

async function runReturnGlobalStatePreservationCheck(page) {
  const nodeFlow = await runNodeReturnGlobalStateCheck(page);
  const resetLayout = await runResetLayoutDistinctFromReturnGlobalCheck(page);
  const communityFlow = await runCommunityReturnGlobalStateCheck(page);
  return { nodeFlow, resetLayout, communityFlow };
}

async function runNodeReturnGlobalStateCheck(page) {
  await resetGraphLayout(page);
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);

  await openSearch(page);
  await page.locator(".graph-search-input").fill("节点A");
  await page.waitForSelector(".node[data-id='A'][data-search-state='match']");
  await openToolbarFilters(page);
  await setTypeFilter(page, "entity", true);
  await setTypeFilter(page, "source", false);
  await waitForVisibleNodeIds(page, ["A", "B"], "source filter should hide C before return global");

  await clickNodeForSummary(page, "A", "return global node setup");
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "固定位置" }).click();
  await page.waitForSelector(".node[data-id='A'][data-pinned='true']");
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "打开详情" }).click();
  await page.waitForSelector(".graph-reader-drawer");
  await waitForCommunityFocus(page, "t1", "node detail return-global setup should enter community");
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await page.waitForSelector(".node[data-id='A'][aria-pressed='true']");
  const focused = await returnGlobalStateSnapshot(page);

  await resetGraphView(page, ["A", "B"]);
  await waitForNoGraphFocus(page, "return global should leave community focus");
  await page.waitForSelector('[data-testid="graph-node-summary"]');
  await page.waitForSelector(".node[data-id='A'][aria-pressed='true'][data-pinned='true']");
  await page.waitForSelector(".node[data-id='A'][data-search-state='match']");
  const returned = await returnGlobalStateSnapshot(page);

  assert.equal(returned.drawerTestId, "graph-node-summary", "selected node should still show the lightweight node summary after return global");
  assert.equal(returned.searchQuery, "节点A", "search query should remain visible after return global");
  assert.equal(returned.sourceFilterChecked, false, "type filter should remain active after return global");
  assert.equal(returned.nodeA.pinned, "true", "fixed position should remain after return global");
  assert.equal(returned.nodeA.pressed, "true", "selected node should remain selected after return global");
  assert.deepEqual(returned.visibleNodes, ["A", "B"], "active source filter should still shape the returned global view");

  await setTypeFilter(page, "source", true);
  await waitForVisibleNodeIds(page, ["A", "B", "C"]);
  return { focused, returned };
}

async function runResetLayoutDistinctFromReturnGlobalCheck(page) {
  await page.locator('[data-testid="graph-node-summary"] button', { hasText: "打开详情" }).click();
  await page.waitForSelector(".graph-reader-drawer");
  await waitForCommunityFocus(page, "t1", "reset-layout distinction setup should enter community");
  await page.waitForSelector(".node[data-id='A'][data-pinned='true']");
  await resetGraphLayout(page);
  await waitForCommunityFocus(page, "t1", "reset layout should not return global");
  await waitForVisibleNodeIds(page, ["A", "B"]);
  await page.waitForSelector(".graph-reader-drawer");
  const afterResetLayout = await returnGlobalStateSnapshot(page);

  assert.equal(afterResetLayout.readerOpen, true, "reset layout should keep the current reader open");
  assert.equal(afterResetLayout.nodeA.pinned, "false", "reset layout should clear fixed position");
  assert.equal(afterResetLayout.nodeA.pressed, "true", "reset layout should not clear selection");
  assert.deepEqual(afterResetLayout.visibleNodes, ["A", "B"], "reset layout should preserve community focus");
  return afterResetLayout;
}

async function runCommunityReturnGlobalStateCheck(page) {
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  await openCommunitySummaryFromWash(page, "t1");
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForCommunityFocus(page, "t1", "community return-global setup should enter community");
  await waitForVisibleNodeIds(page, ["A", "B"]);
  const focused = await returnGlobalStateSnapshot(page);

  await resetGraphView(page, ["A", "B", "C"]);
  await waitForNoGraphFocus(page, "community return global should leave community focus");
  await page.waitForSelector('[data-testid="graph-community-summary"]');
  const returned = await returnGlobalStateSnapshot(page);

  assert.equal(returned.drawerTestId, "graph-community-summary", "selected community should still show community summary after return global");
  assert.deepEqual(returned.visibleNodes, ["A", "B", "C"], "community return global should restore the global node set");
  return { focused, returned };
}

async function openCommunitySummaryFromWash(page, communityId) {
  await closeDrawerIfOpen(page);
  await resetGraphView(page, ["A", "B", "C"]);
  const before = await graphSnapshot(page);
  await clickCommunityWash(page, communityId);
  await page.waitForSelector('[data-testid="graph-community-summary"]');
  await waitForVisibleNodeIds(page, ["A", "B", "C"], "community summary wash click should stay global");
  const after = await graphSnapshot(page);
  assert.equal(transformScale(after.transform), transformScale(before.transform), "community wash click should preserve the global zoom scale");
  assert.deepEqual(after.visibleNodes, ["A", "B", "C"], "community wash click should keep the global node set visible");
  return { before, after };
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
  assert.ok(isPointInsideViewport(page, after.center), `dragged node should remain visible after refresh, distance=${pointerDistance.toFixed(1)}`);

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

function isPointInsideViewport(page, point) {
  const viewport = page.viewportSize();
  return Boolean(
    viewport
    && point.x >= 0
    && point.y >= 0
    && point.x <= viewport.width
    && point.y <= viewport.height
  );
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

async function resetGraphView(page, expectedVisibleNodeIds = null) {
  const before = await layerTransform(page);
  await page.locator("[data-llm-wiki-graph-root='true']").getByRole("button", { name: "回全图" }).click();
  await page.waitForTimeout(220);
  const after = await layerTransform(page);
  if (after === before) {
    await page.waitForTimeout(120);
  }
  if (expectedVisibleNodeIds) await waitForVisibleNodeIds(page, expectedVisibleNodeIds);
}

async function resetGraphLayout(page) {
  await page.getByRole("button", { name: "重置布局" }).click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll(".node")].every((node) => node.getAttribute("data-pinned") !== "true");
  }, undefined, { timeout: 3000 });
}

async function returnGlobalStateSnapshot(page) {
  return roundObject(await page.evaluate(() => {
    const nodeSnapshot = (id) => {
      const node = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
      return {
        present: Boolean(node),
        pressed: node?.getAttribute("aria-pressed") || "",
        pinned: node?.getAttribute("data-pinned") || "",
        searchState: node?.getAttribute("data-search-state") || ""
      };
    };
    const sourceFilter = document.querySelector('.graph-type-filter-option input[data-type="source"]');
    return {
      focus: document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus || "",
      visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort(),
      drawerTestId: document.querySelector(".drawer-panel-open [data-testid]")?.getAttribute("data-testid") || "",
      readerOpen: Boolean(document.querySelector(".graph-reader-drawer")),
      searchQuery: document.querySelector(".graph-search-input")?.value || "",
      sourceFilterChecked: sourceFilter instanceof HTMLInputElement ? sourceFilter.checked : null,
      nodeA: nodeSnapshot("A"),
      nodeB: nodeSnapshot("B"),
      nodeC: nodeSnapshot("C")
    };
  }));
}

async function closeDrawerIfOpen(page) {
  const button = page.locator(".drawer-header button[aria-label='关闭']");
  if (await button.count()) {
    await button.first().click();
    await page.waitForSelector(".drawer-panel-open", { state: "detached" });
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

async function hoverPreviewSnapshot(page) {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const preview = document.querySelector(".graph-hover-preview");
    if (!root || !preview) throw new Error("Missing hover preview snapshot elements");
    return {
      kind: preview.getAttribute("data-kind") || "",
      state: preview.getAttribute("data-state") || "",
      preview: window.__graphWorkbenchTest.relativeRect(preview.getBoundingClientRect(), root.getBoundingClientRect()),
      title: preview.querySelector(".graph-hover-preview-title")?.textContent || ""
    };
  });
  await assertBoxInsideViewport(page, ".graph-hover-preview", "drawer core-node hover preview");
  return roundObject(snapshot);
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

async function currentGraphFocus(page) {
  return page.evaluate(() => document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus || "");
}

async function waitForCommunityFocus(page, communityId, label) {
  try {
    await page.waitForFunction((communityId) => {
      return document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus === `community:${communityId}`;
    }, communityId, { timeout: 5000 });
  } catch (err) {
    const diagnostics = await page.evaluate(() => {
      const host = document.querySelector(".graph-host");
      return {
        focus: host?.dataset.llmWikiGraphFocus || "",
        engineMounted: host?.dataset.llmWikiGraphEngine || "",
        visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort(),
        drawer: document.querySelector(".drawer-panel-open article")?.className || "",
        summaryTestId: document.querySelector(".drawer-panel-open [data-testid]")?.getAttribute("data-testid") || "",
        readerOpen: Boolean(document.querySelector(".graph-reader-drawer"))
      };
    });
    assert.fail(`${label}: expected community:${communityId}, got ${JSON.stringify(diagnostics)} (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function waitForNoGraphFocus(page, label) {
  try {
    await page.waitForFunction(() => {
      return !document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus;
    }, undefined, { timeout: 5000 });
  } catch (err) {
    const diagnostics = await page.evaluate(() => {
      const host = document.querySelector(".graph-host");
      return {
        focus: host?.dataset.llmWikiGraphFocus || "",
        visibleNodes: [...document.querySelectorAll(".node")].map((item) => item.dataset.id).sort()
      };
    });
    assert.fail(`${label}: expected no graph focus, got ${JSON.stringify(diagnostics)} (${err instanceof Error ? err.message : String(err)})`);
  }
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

async function waitForViewportAnimationIdle(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return root?.dataset.viewportAnimating !== "true";
  }, undefined, { timeout: 3000 });
}

async function waitForVisibleNodeIds(page, expected, label = "visible node ids") {
  try {
    await page.waitForFunction((expected) => {
      const actual = [...document.querySelectorAll(".node")].map((node) => node.dataset.id).sort();
      return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
    }, expected, { timeout: 5000 });
  } catch (err) {
    const diagnostics = await page.evaluate(() => ({
      expected,
      actual: [...document.querySelectorAll(".node")].map((node) => node.dataset.id).sort(),
      hostFocus: document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus || "",
      rootFocus: document.querySelector("[data-llm-wiki-graph-root='true']")?.dataset.focus || "",
      drawer: document.querySelector(".drawer-panel-open")?.getAttribute("class") || ""
    }), expected);
    assert.fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(diagnostics)} (${err instanceof Error ? err.message : String(err)})`);
  }
}

async function clickCommunityWash(page, communityId) {
  const point = await findCommunityWashPoint(page, communityId);
  await page.mouse.click(point.x, point.y);
}

async function clickBlankPoint(page) {
  const point = await findBlankPoint(page);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function doubleClickBlankPoint(page) {
  const point = await findBlankPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  return point;
}

async function clickBlankPointThatClearsSelection(page, nodeId) {
  const candidates = await findBlankPointCandidates(page);
  const diagnostics = [];
  const root = page.locator("[data-llm-wiki-graph-root='true']");
  for (const point of candidates) {
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
    await page.waitForTimeout(120);
    const selected = await page.locator(`.node[data-id="${cssString(nodeId)}"]`).evaluate((node) => node.getAttribute("aria-pressed") || "");
    if (selected === "false") return point;
    diagnostics.push(await graphInteractionDiagnostics(page, point));
  }
  assert.fail(`could not find a true blank click point that clears selection: ${JSON.stringify(diagnostics)}`);
}

async function doubleClickBlankPointThatReturnsGlobal(page) {
  const candidates = await findBlankPointCandidates(page);
  const diagnostics = [];
  for (const point of candidates) {
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(180);
    const focus = await currentGraphFocus(page);
    const visibleNodes = await page.evaluate(() => [...document.querySelectorAll(".node")].map((node) => node.dataset.id).sort());
    if (!focus && visibleNodes.includes("C")) return point;
    diagnostics.push({ ...(await graphInteractionDiagnostics(page, point)), focus, visibleNodes });
  }
  assert.fail(`could not find a true blank double-click point that returns global: ${JSON.stringify(diagnostics)}`);
}

async function assertDoubleClickDoesNotReturnGlobal(page, pointFactory, label) {
  await openCommunitySummaryFromWash(page, "t1");
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForCommunityFocus(page, "t1", `${label} setup should focus the community`);
  await waitForVisibleNodeIds(page, ["A", "B"]);
  const before = await graphSnapshot(page);
  const point = await pointFactory();
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(180);
  await waitForCommunityFocus(page, "t1", `${label} double click should not return global`);
  const after = await graphSnapshot(page);
  assert.deepEqual(after.visibleNodes, ["A", "B"], `${label} double click should preserve community focus`);
  return { before, after, point: roundedPoint(point) };
}

async function graphInteractionDiagnostics(page, point) {
  return page.evaluate(({ point }) => {
    const hit = document.elementFromPoint(point.x, point.y);
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const node = document.querySelector(".node[data-id='A']");
    return {
      point,
      hitTag: hit?.tagName || "",
      hitClass: hit instanceof Element ? hit.className : "",
      hitNodeId: hit instanceof Element ? hit.closest(".node")?.getAttribute("data-id") || "" : "",
      rootFocus: root?.dataset.focus || "",
      selected: node?.getAttribute("aria-pressed") || "",
      drawer: document.querySelector(".drawer-panel-open")?.getAttribute("class") || ""
    };
  }, { point });
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

async function clickNodeForSummary(page, id, label) {
  await ensureNodeInteractable(page, id);
  const point = await nodeCenter(page, id);
  await page.mouse.click(point.x, point.y);
  try {
    await page.waitForSelector('[data-testid="graph-node-summary"]', { timeout: 5000 });
  } catch (err) {
    const diagnostics = await graphInteractionDiagnostics(page, point);
    throw new assert.AssertionError({
      message: `${label}: node ${id} click should open node summary, got ${JSON.stringify(diagnostics)}`,
      actual: err,
      expected: "graph-node-summary",
      operator: "strictEqual"
    });
  }
}

async function nodePinnedState(page, id) {
  return page.locator(`.node[data-id="${cssString(id)}"]`).evaluate((node) => node.getAttribute("data-pinned") || "");
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
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const toClientPoint = (point) => ({
      x: rect.left + (point.x - viewBox.x) / viewBox.width * rect.width,
      y: rect.top + (point.y - viewBox.y) / viewBox.height * rect.height
    });
    const fractions = [0.5, 0.42, 0.58, 0.35, 0.65, 0.25, 0.75];
    for (const fraction of fractions) {
      const point = toClientPoint(edge.getPointAtLength(length * fraction));
      if (document.elementFromPoint(point.x, point.y)?.closest?.(".edge") === edge) return point;
    }
    const mid = toClientPoint(edge.getPointAtLength(length / 2));
    throw new Error(`Could not find exposed edge point near first edge; midpoint=${JSON.stringify(mid)}`);
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
  return (await findBlankPointCandidates(page))[0];
}

async function findBlankPointCandidates(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing graph root");
    const rect = root.getBoundingClientRect();
    const blocked = ".node,.community-wash,.edge,.graph-toolbar,.mini-map,.graph-search,.drawer-panel-open";
    const nodes = [...document.querySelectorAll(".node")].map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const washes = [...document.querySelectorAll(".community-wash")].map((wash) => {
      const box = wash.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const xs = [0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.88];
    const ys = [0.18, 0.32, 0.48, 0.64, 0.8, 0.9];
    const points = [];
    for (const ry of ys) {
      for (const rx of xs) {
        const x = rect.left + rect.width * rx;
        const y = rect.top + rect.height * ry;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !root.contains(hit)) continue;
        if (hit.closest(blocked)) continue;
        const tooClose = [...nodes, ...washes].some((point) => Math.hypot(point.x - x, point.y - y) < 120);
        if (tooClose) continue;
        points.push({ x, y });
      }
    }
    if (points.length) return points;
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

async function setTypeFilter(page, type, enabled) {
  await openToolbarFilters(page);
  const input = page.locator(`.graph-type-filter-option input[data-type="${cssString(type)}"]`);
  await input.waitFor();
  const checked = await input.isChecked();
  if (checked !== enabled) {
    await input.click();
    await page.waitForFunction(({ type, enabled }) => {
      const input = document.querySelector(`.graph-type-filter-option input[data-type="${CSS.escape(type)}"]`);
      return input instanceof HTMLInputElement && input.checked === enabled;
    }, { type, enabled });
  }
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

function transformScale(transform) {
  const match = String(transform).match(/scale\(([^)]+)\)/);
  return match ? Number(match[1]) : 1;
}
