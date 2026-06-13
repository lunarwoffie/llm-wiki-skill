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

if (target !== "offline") {
  throw new Error(`Only the offline target is available for this stage 4.5 navigation slice: ${target}`);
}
assert.notEqual(offlineHtml, "", "GRAPH_STAGE_4_5_OFFLINE_HTML must point at generated HTML");
assert.notEqual(denseHtml, "", "GRAPH_STAGE_4_5_DENSE_HTML must point at generated dense HTML");

const browser = await chromium.launch();
try {
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
} finally {
  await browser.close();
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
