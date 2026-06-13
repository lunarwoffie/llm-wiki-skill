import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const target = process.env.GRAPH_STAGE_4_5_TARGET || "offline";
const offlineHtml = process.env.GRAPH_STAGE_4_5_OFFLINE_HTML || "";
const denseHtml = process.env.GRAPH_STAGE_4_5_DENSE_HTML || "";
const artifactDir = process.env.GRAPH_STAGE_4_5_ARTIFACT_DIR || "";
const workbenchUrl = process.env.GRAPH_STAGE_4_5_WORKBENCH_URL || "";

if (target !== "offline" && target !== "workbench") {
  throw new Error(`Unknown stage 4.5 browser target: ${target}`);
}
assert.notEqual(offlineHtml, "", "GRAPH_STAGE_4_5_OFFLINE_HTML must point at generated HTML");
assert.notEqual(denseHtml, "", "GRAPH_STAGE_4_5_DENSE_HTML must point at generated dense HTML");

const browser = await chromium.launch();
try {
  if (target === "workbench") {
    await runWorkbenchChecks(browser);
  } else {
    await runOfflineChecks(browser);
  }
} finally {
  await browser.close();
}

async function runOfflineChecks(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(offlineHtml).href);

  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");

  const initial = await layerTransform(page);
  await page.mouse.move(64, 120);
  await page.mouse.wheel(0, -600);
  const zoomed = await waitForLayerTransform(page, initial);
  assert.notEqual(zoomed, initial, "wheel zoom should update the content layer transform");
  assert.notEqual(zoomed, "translate(0px, 0px) scale(1)", "wheel zoom should leave the default viewport");

  await page.mouse.move(72, 132);
  await page.mouse.down();
  await page.mouse.move(190, 182, { steps: 4 });
  await page.mouse.up();
  const panned = await waitForLayerTransform(page, zoomed);
  assert.notEqual(panned, zoomed, "blank drag should pan through the content layer transform");

  await page.mouse.dblclick(48, 132);
  const fitted = await waitForLayerTransform(page, panned);
  assert.notEqual(fitted, panned, "blank double-click should fit the graph through the content layer transform");

  await page.keyboard.down("Shift");
  await page.locator(".node").nth(0).click();
  await page.locator(".node").nth(1).click();
  await page.keyboard.up("Shift");
  const selectedAfterShiftClick = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(selectedAfterShiftClick, 2, "Shift-clicking two nodes should keep both nodes selected in the graph");

  await page.keyboard.press("Escape");
  await expectNoPressedNodes(page, "Escape should clear Shift-click selections");

  const transformBeforeReader = await layerTransform(page);
  await page.locator(".node").nth(0).click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  const pressedAfterPlainClick = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(pressedAfterPlainClick, 1, "plain node click should highlight one readable node");
  assert.match(
    await page.locator(".graph-reader .graph-reader-title").innerText(),
    /\S/,
    "plain node click should open the internal reader with a title"
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector(".graph-reader[data-state='closed']");
  await expectNoPressedNodes(page, "Escape should clear the reader highlight");
  assert.equal(
    await layerTransform(page),
    transformBeforeReader,
    "clearing graph interaction should not reset the viewport transform"
  );

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "stage-4.5-offline-navigation.png"), fullPage: true });
  }

  const densePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await densePage.goto(pathToFileURL(denseHtml).href);
  await densePage.waitForSelector("[data-llm-wiki-graph-root='true']");
  await densePage.waitForSelector("[data-viewport-layer='true']");

  const denseInitial = await layerTransform(densePage);
  const frameSamplePromise = densePage.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;
    function tick() {
      frames += 1;
      const elapsed = performance.now() - start;
      if (elapsed >= 3000) {
        resolve({ frames, durationMs: elapsed, fps: frames / (elapsed / 1000) });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }));

  const denseRoot = densePage.locator("[data-llm-wiki-graph-root='true']");
  const wheelStartedAt = Date.now();
  while (Date.now() - wheelStartedAt < 3000) {
    await denseRoot.dispatchEvent("wheel", {
      deltaY: -180,
      deltaMode: 0,
      clientX: 520,
      clientY: 420,
      bubbles: true,
      cancelable: true
    });
    await densePage.waitForTimeout(50);
  }
  const frameSample = await frameSamplePromise;
  const denseZoomed = await layerTransform(densePage);
  assert.notEqual(denseZoomed, denseInitial, "continuous dense wheel interaction should keep updating the viewport");
  assert.ok(frameSample.fps >= 50, `dense wheel interaction should stay at or above 50fps, got ${frameSample.fps.toFixed(1)}fps`);

  if (artifactDir) {
    await densePage.screenshot({ path: path.join(artifactDir, "stage-4.5-offline-dense-wheel.png"), fullPage: true });
    await fs.writeFile(
      path.join(artifactDir, "stage-4.5-offline-dense-wheel.json"),
      `${JSON.stringify({
        viewport: "1440x960",
        durationMs: Math.round(frameSample.durationMs),
        frames: frameSample.frames,
        fps: Math.round(frameSample.fps * 10) / 10,
        transformChanged: denseZoomed !== denseInitial
      }, null, 2)}\n`
    );
  }
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  const selector = "[data-viewport-layer='true']";
  await page.waitForFunction(
    ({ selector, previous }) => {
      const element = document.querySelector(selector);
      return Boolean(element && element.style.transform && element.style.transform !== previous);
    },
    { selector, previous },
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function expectNoPressedNodes(page, message) {
  const pressed = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(pressed, 0, message);
}

async function runWorkbenchChecks(browser) {
  assert.notEqual(workbenchUrl, "", "GRAPH_STAGE_4_5_WORKBENCH_URL must point at the workbench dev server");
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(workbenchUrl);
  await page.waitForSelector(".app-shell");

  const kbButton = page.getByRole("button", { name: /Stage 4\.5 Workbench Test|workbench-kb/ });
  if (await kbButton.count()) {
    await kbButton.click();
  }
  await page.getByRole("button", { name: /图谱/ }).click();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.locator(".node[data-id='A']").click();

  await page.waitForSelector(".drawer-panel-open");
  const drawer = page.locator(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  await drawer.getByText("这是节点A的正文").waitFor();
  await drawer.getByRole("button", { name: "在对话中引用" }).waitFor();
  await drawer.getByRole("button", { name: "它和谁有关" }).waitFor();
  assert.equal(await drawer.getByText("学习队列").count(), 0, "graph reader should not show learning queue");
  assert.equal(await drawer.getByText("摘要").count(), 0, "graph reader should not show a summary block");
  assert.equal(await drawer.getByText("相邻节点").count(), 0, "graph reader should not show a neighbor section");

  await drawer.getByRole("link", { name: "wiki/entities/B.md" }).click();
  await drawer.locator(".drawer-title", { hasText: "wiki/entities/B.md" }).waitFor();
  await drawer.getByText("这是节点B的正文").waitFor();
  const focused = await page.locator(".node[aria-pressed='true']").count();
  assert.equal(focused, 1, "wikilink navigation should keep one graph node highlighted");
  assert.equal(await page.locator(".graph-selection-panel").count(), 0, "selection should not use the old floating canvas panel");

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "stage-4.5-workbench-reader.png"), fullPage: true });
  }

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "closing the graph reader should clear the graph highlight");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='A']").click();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "选区" }).waitFor();
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  assert.equal(await drawer.locator(".graph-selection-fact").count(), 0, "single-node selection should hide structural facts");
  assert.equal(await drawer.getByText("探索潜在联系").count(), 0, "single-node selection should not show group exploration");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='B']").click();
  await page.keyboard.up("Shift");
  await drawer.getByText("Shift+点击 增删节点").waitFor();
  await drawer.getByText("总结这一组").waitFor();
  assert.ok(await drawer.locator(".graph-selection-fact").count() >= 3, "multi-node selection should show structural facts");

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "Escape should clear the workbench selection drawer and graph highlights");
  await runWorkbenchMobileChecks(browser);
}

async function runWorkbenchMobileChecks(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    window.localStorage.setItem("llm-wiki-agent-main-view", "graph");
  });
  await page.goto(workbenchUrl);
  await page.waitForSelector(".app-shell");
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.locator(".node[data-id='A']").click();

  await page.waitForSelector(".drawer-panel-open");
  const drawer = page.locator(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "节点A" }).waitFor();
  await drawer.getByText("这是节点A的正文").waitFor();
  assert.equal(await page.locator(".graph-selection-panel").count(), 0, "mobile should not use the old floating canvas panel");

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "mobile Escape should clear the graph reader highlight");

  await page.keyboard.down("Shift");
  await page.locator(".node[data-id='A']").click();
  await page.keyboard.up("Shift");
  await page.waitForSelector(".drawer-panel-open");
  await drawer.locator(".drawer-title", { hasText: "选区" }).waitFor();
  await drawer.getByText("Shift+点击 增删节点").waitFor();

  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-panel-open", { state: "detached" });
  await expectNoPressedNodes(page, "mobile Escape should clear the selection drawer and graph highlights");
}
