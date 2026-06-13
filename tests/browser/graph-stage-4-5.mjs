import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const target = process.env.GRAPH_STAGE_4_5_TARGET || "offline";
const offlineHtml = process.env.GRAPH_STAGE_4_5_OFFLINE_HTML || "";
const artifactDir = process.env.GRAPH_STAGE_4_5_ARTIFACT_DIR || "";

if (target !== "offline") {
  throw new Error(`Only the offline target is available for this stage 4.5 navigation slice: ${target}`);
}
assert.notEqual(offlineHtml, "", "GRAPH_STAGE_4_5_OFFLINE_HTML must point at generated HTML");

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

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, "stage-4.5-offline-navigation.png"), fullPage: true });
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
