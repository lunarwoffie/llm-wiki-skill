import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts"
];

const existingTypeOnlyFiles = [
  "sigma-coordinates.ts",
  "community-cloud-geometry.ts"
];

describe("Sigma global renderer refactor boundaries", () => {
  it("keeps shared helper modules from importing the renderer", async () => {
    for (const file of [...helperFiles, ...existingTypeOnlyFiles]) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']\.\/sigma-global-renderer(?:\.[jt]s)?["']/);
    }
  });

  it("keeps new Sigma internal helpers out of the render package barrel", async () => {
    const source = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    for (const file of helperFiles) {
      const moduleName = file.replace(/\.ts$/, "");
      assert.doesNotMatch(source, new RegExp(`from\\s+["']\\./${moduleName}(?:\\.js)?["']`));
    }
  });

  it("keeps the shared type file type-only", async () => {
    const source = await readFile(new URL("../src/render/sigma-global-types.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /^\s*export\s+(?!type\b|interface\b)/m);
  });
});
