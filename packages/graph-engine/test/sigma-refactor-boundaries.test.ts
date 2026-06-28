import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const renderDir = new URL("../src/render/", import.meta.url);

const rendererBoundaryExcludedFiles = new Set(["sigma-global-renderer.ts"]);
const existingTypeOnlyFiles = ["community-cloud-geometry.ts"];

describe("Sigma global renderer refactor boundaries", () => {
  it("keeps shared helper modules from importing the renderer", async () => {
    for (const file of [...await sigmaHelperFiles(), ...existingTypeOnlyFiles]) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']\.\/sigma-global-renderer(?:\.[jt]s)?["']/);
    }
  });

  it("keeps new Sigma internal helpers out of the render package barrel", async () => {
    const source = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    for (const file of await sigmaHelperFiles()) {
      const moduleName = file.replace(/\.ts$/, "");
      assert.doesNotMatch(source, new RegExp(`from\\s+["']\\./${moduleName}(?:\\.js)?["']`));
    }
  });

  it("keeps the shared type file type-only", async () => {
    const source = await readFile(new URL("../src/render/sigma-global-types.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /^\s*export\s+(?!type\b|interface\b)/m);
  });
});

async function sigmaHelperFiles(): Promise<string[]> {
  const entries = await readdir(renderDir);
  return entries
    .filter((file) => file.startsWith("sigma-") && file.endsWith(".ts"))
    .filter((file) => !rendererBoundaryExcludedFiles.has(file))
    .sort();
}
