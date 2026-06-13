# Stage 4.5 Execution Plan: Graph Usability Finish

> Source spec: `workbench/docs/stage-4.5-design.md`
> Progress ledger: `workbench/docs/stage-4.5-progress.json`
> Plan level: L - phased plan. The work spans the shared graph engine, offline HTML, workbench drawer UX, selection semantics, search, legend, density rendering, and browser verification.

## Spec Review Gate

Ready: yes.

Blocking gaps: none.

Drift risks:
- `stage-4.5-design.md` revises `stage-4-design.md` D6. When the two conflict, stage 4.5 wins.
- Current branch is `stage-4` and contains the stage 4.5 design plus the stage-four graph-engine surface. Reviewed base commit is `f3a7ccd`. Execution must branch from that commit, or update this plan/progress with the newly reviewed base commit before implementation starts.
- The existing `tests/graph-html-search.regression-1.sh` intentionally asserts that the old search UI is absent. This stage must flip it to assert the new search UI exists.
- Browser-level smoothness checks depend on available tooling. Add repeatable browser regression coverage for core graph interactions; use Codex in-app Browser evidence as a Codex-only supplement, not as the sole portable test path.
- This plan intentionally keeps the complete stage 4.5 outcome. Do not reduce it to a minimal shortcut graph fix during execution; reduce only accidental implementation complexity.
- The atlas layout must be synchronized before any viewport fit, focus, or transform write. Reading-drawer layout changes can otherwise make node transforms and SVG edge transforms use different host dimensions.

Required fixes before code execution: none.

## Goal

Finish graph usability stage 4.5 without changing the product direction:

- Smooth zoom, pan, fit, minimap viewport, and zoom-linked density.
- Single click reads a page; selection is an upgraded state through Shift, community, legend, or `+ neighbors`.
- Workbench uses the existing right drawer for reading and selection; offline HTML keeps an internal reader.
- Search and community legend work in both hosts.
- Nodes are visually slimmer by default and reveal a hover preview card sourced from existing content.
- Learning queue, learning path, notes, drawer browser history, inertial scrolling, AI-generated summaries, and full mobile touch gestures stay out of scope.

## Source Documents

- `workbench/docs/stage-4.5-design.md`: primary source of truth.
- `workbench/docs/stage-4-design.md`: stage-four engine, selection, pin, watcher, and capability contracts.
- `AGENTS.md`, `platforms/codex/AGENTS.md`, `README.md`, `SKILL.md`: repo and skill constraints.
- `docs/solutions/ui-bugs/graph-wash-null-safety-and-label-truncation-fix-2026-04-21.md`: graph DOM safety and runtime-test lessons.
- `docs/solutions/developer-experience/graph-style-simplification-to-wash-only-2026-04-20.md`: keep one graph style and keep regression assertions aligned with shipped UI.
- Existing implementation inspected:
  - `packages/graph-engine/src/index.ts`
  - `packages/graph-engine/src/render/static-renderer.ts`
  - `packages/graph-engine/src/render/model.ts`
  - `packages/graph-engine/src/model/atlas.ts`
  - `packages/graph-engine/src/model/legacy-helpers.ts`
  - `packages/graph-engine/src/select/index.ts`
  - `packages/graph-engine/src/types.ts`
  - `workbench/web/src/components/GraphPanel.tsx`
  - `workbench/web/src/components/RightDrawer.tsx`
  - `workbench/web/src/App.tsx`
  - `workbench/web/src/lib/api.ts`
  - `workbench/web/src/lib/graph-selection.ts`
  - `workbench/server/src/graph.ts`
  - `workbench/server/src/pages.ts`
  - `scripts/build-graph-html.sh`
  - graph regression scripts under `tests/`

## Execution Rules

- Create a dedicated branch before code execution: `codex/feat-stage-4-5-graph-usability`.
- Do not run this ledger on `main` or directly on `stage-4`.
- Make a clean-start commit containing the plan/progress files and no code changes if they are not already committed.
- Run `git log --oneline -15` and the smoke check before each work unit.
- Smoke check: `npm run test -w @llm-wiki/graph-engine`.
- Commit each verified work unit and record its hash in `workbench/docs/stage-4.5-progress.json`. In this phased plan, each numbered task inside a phase is a work unit unless the plan explicitly says otherwise.
- Never commit when required verification fails.
- Never push, merge, or amend automatically.
- Advance from one verified phase to the next without asking the user.
- The executing agent may update status, evidence, commit, decision log, residual risk, and turn log fields in the progress file. If implementation discovers a wrong or impossible acceptance criterion, stop, record the blocker, update the plan/progress through a review note, and do not keep implementing stale criteria.
- Preserve unrelated user changes. Current known unrelated untracked files are `docs/solutions/developer-experience/cross-platform-runtime-install-hints-path-safe-2026-04-28.md` and `test-report.md`.

## Baseline Smoke And Full Verification Commands

Fast checks used during most work units:

```bash
npm run test -w @llm-wiki/graph-engine
npm run typecheck
npm run build -w @llm-wiki-agent/web
```

Workbench focused checks:

```bash
node --import tsx --test workbench/web/test/*.test.ts
node --import tsx --test workbench/server/src/*.test.ts workbench/server/src/digest/*.test.ts
```

Offline graph checks:

```bash
bash tests/graph-html-search.regression-1.sh
bash tests/graph-html-minimap.regression-1.sh
bash tests/graph-html-density.regression-1.sh
bash tests/graph-html-a11y.regression-1.sh
bash tests/graph-html-mobile.regression-1.sh
bash tests/graph-html-oriental-atlas-contract.regression-1.sh
bash tests/graph-html-oriental-design-contract.regression-1.sh
```

Repeatable browser graph checks to add during stage 4.5:

```bash
bash tests/graph-browser-stage-4-5.regression-1.sh --target workbench
bash tests/graph-browser-stage-4-5.regression-1.sh --target offline
```

Final pre-push depth:

```bash
bash install.sh --dry-run --platform codex
bash tests/regression.sh
if grep -r '/Users/kangjiaqi\|康佳琦' scripts/ templates/ tests/ SKILL.md; then exit 1; else exit 0; fi
```

Browser verification is required for UI phases. Use the workbench dev server and offline HTML fixture at these viewports:

- Desktop: 1440 x 960
- Tablet: 768 x 1024
- Mobile narrow: 390 x 844

Record screenshots or browser observations in the progress file for each relevant phase. The committed browser regression script is the portable gate. Codex runs may also use the Codex in-app Browser skill to open the same workbench/offline targets, capture screenshots, and record observed behavior, because that skill may not exist in Claude Code or CI.

## Implementation Surface Map

Shared graph engine:
- `packages/graph-engine/src/model/legacy-helpers.ts`: reuse `zoomAtlasViewport`, `fitAtlasViewport`, `centerAtlasViewportOnPoint`, `atlasViewportToMinimapRect`, `buildSearchIndex`, `applySearchToNodeIds`, `buildSearchHaystack`, and `stripAtlasMarkdown`.
- `packages/graph-engine/src/render/model.ts`: extend renderable graph state for viewport-aware density, preview summaries, node visual state, and community legend data.
- `packages/graph-engine/src/render/static-renderer.ts`: remain the renderer entrypoint and lifecycle owner, but do not absorb all stage 4.5 behavior inline.
- New render-internal files to create unless an equivalent already exists:
  - `packages/graph-engine/src/render/viewport.ts`
  - `packages/graph-engine/src/render/search.ts`
  - `packages/graph-engine/src/render/legend.ts`
  - `packages/graph-engine/src/render/reader.ts`
  - `packages/graph-engine/src/render/preview.ts`
  - `packages/graph-engine/src/render/styles.ts`
- `packages/graph-engine/src/select/index.ts`: fix action table, single-node semantics, isolated-node action, and statistics conditions.
- `packages/graph-engine/src/types.ts`: add any stable public types for viewport, search state, reader state, new selection actions, a host callback that means selection changed, not ask the AI, an open-page payload carrying path plus node metadata, and a public method for clearing graph interaction state.
- `packages/graph-engine/test/*.test.ts`: unit coverage for viewport math wiring, action mapping, density, preview text, search, legend selection, open-page payload metadata, clear-interaction behavior, and dense-graph performance contracts.

Workbench web:
- `workbench/web/src/components/GraphPanel.tsx`: keep as host shell for graph engine lifecycle, loading, layout persistence, and event wiring. Do not put graph reader or graph selection UI back into this shell.
- New files to create unless implementation discovers an existing equivalent:
  - `workbench/web/src/components/GraphReader.tsx`
  - `workbench/web/src/components/GraphSelection.tsx`
- `workbench/web/src/components/RightDrawer.tsx`: support explicit graph reader and graph selection drawer modes without overloading the existing wiki and artifact preview modes.
- `workbench/web/src/App.tsx`: route graph node reads through `readPage`, replace the scattered drawer state fields with one discriminated drawer state object, maintain separate graph drawer state from normal wiki preview state, call the graph engine's clear-interaction method on Esc/drawer close/kb switch/view switch, and keep wikilink focus in sync.
- `workbench/web/src/lib/graph-selection.ts`: update payload wording and tests for new action labels.
- `workbench/web/src/index.css`: keep global variables, shared shell, and non-graph styles.
- New file to create: `workbench/web/src/graph.css` for graph panel, graph drawer content, graph selection, reader, preview, search, legend, compact node, and responsive graph styling.
- New web tests to create unless implementation discovers an equivalent:
  - `workbench/web/test/graph-drawer-state.test.ts`
  - `workbench/web/test/graph-reader.test.ts`
  - `workbench/web/test/graph-selection-drawer.test.ts`

Workbench server:
- `workbench/server/src/pages.ts` and `/api/page` stay the page-reading source. Do not add a backend endpoint for graph reading unless a hard blocker appears.
- `workbench/server/src/graph.ts` watcher/rebuild/diff stays as-is unless browser checks reveal an interaction with new graph UI.

Offline graph:
- `scripts/build-graph-html.sh`: keep graph data, layout, engine IIFE, marked, and purify embedding. Extend boot behavior only through engine capabilities and embedded reader behavior.
- Offline reader content must come from embedded `graph-data.json` node content. Do not use runtime `fetch()` to read sibling markdown files, because direct `file://` HTML cannot rely on those reads across browsers.
- `tests/lib/graph-html-engine-helpers.sh`: extend fixture helpers only when new offline assertions need stable setup.
- `tests/graph-html-*.sh`: update assertions to new DOM contracts.
- New browser regression harness to create:
  - `tests/graph-browser-stage-4-5.regression-1.sh`
  - `tests/browser/graph-stage-4-5.spec.ts` or the closest existing browser-runner equivalent.

## Ownership Boundaries

```text
GraphData + layout pins
        |
        v
@llm-wiki/graph-engine
  - viewport, search, legend, node visuals, hover preview
  - offline internal reader
  - selection facts and actions
        |
        +-- workbench onOpenPage({ path, node })
        |       v
        |   App readPage(kb, path) + node metadata -> RightDrawer GraphReader
        |
        +-- workbench onSelectionChange(selection)
                v
            RightDrawer GraphSelection -> explicit ask action -> buildSelectionPromptPayload -> ChatPanel

wheel / blank drag / search enter / legend click
        v
viewport state -> one content-layer transform -> minimap viewport rect

pin coordinates stay model coordinates; viewport state never enters PinMap
```

## What Already Exists

- Shared `@llm-wiki/graph-engine` package, IIFE/ESM build, and unit test command.
- Live simulation, pin persistence, graph watcher, diff queue, offline engine packaging.
- Selection system and prompt payload builder.
- `GraphPanel` with current selection floating panel.
- Right drawer with wiki and artifact preview.
- `/api/page` and `/api/refs` page-reading system.
- Search, viewport, minimap, density, and markdown cleaning helpers in `legacy-helpers.ts`.
- Dense graph fixture: `tests/fixtures/graph-interactive-dense/wiki/graph-data.json`.

## Phase 1: Smooth Viewport Navigation

Goal: make zoom, pan, fit, minimap viewport, and zoom-linked density work in both hosts with one engine implementation.

Visible result: the graph canvas scroll-zooms at the pointer, blank-space drag pans the graph, double-click on blank space fits the graph, the minimap shows the visible viewport, and dense graphs remain smooth.

Surfaces:
- `packages/graph-engine/src/model/legacy-helpers.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/viewport.ts`
- `packages/graph-engine/src/render/styles.ts`
- `packages/graph-engine/src/types.ts`
- `packages/graph-engine/test/helpers.test.ts`
- New file to create unless implementation discovers an existing equivalent: `packages/graph-engine/test/viewport.test.ts`
- `tests/graph-html-minimap.regression-1.sh`
- `tests/graph-html-density.regression-1.sh`

Tasks:

1.1 Introduce renderer viewport state and transform layer.
- Rework DOM so nodes, edges, and community wash share one transform target.
- Apply pan/zoom through `translate(...) scale(...)` on that target.
- Keep node model coordinates and pin positions unchanged.
- Verification: `npm run test -w @llm-wiki/graph-engine` exits 0 and includes assertions that viewport changes do not mutate pin coordinates.

1.2 Wire wheel zoom, blank drag pan, and blank double-click fit.
- Use `zoomAtlasViewport`, `fitAtlasViewport`, and clamped min/max scale based on fit scale from 0.5x to 4x.
- Normalize `deltaMode` so pixel and line wheel inputs have separate scaling constants.
- Use requestAnimationFrame so high-frequency events write DOM at most once per frame.
- Verification: engine tests assert pointer-centered zoom math, delta normalization, and rAF coalescing behavior.
- Verification: browser regression covers wheel zoom, blank drag pan, and blank double-click fit without relying only on manual observation.

1.3 Add minimap viewport rectangle and animated jumps.
- Use `atlasViewportToMinimapRect`.
- Double-click fit, search result focus, and legend focus may animate for about 200ms ease-out.
- Wheel and drag must have no CSS transition.
- Verification: `bash tests/graph-html-minimap.regression-1.sh` exits 0 and asserts minimap viewport markup plus update hook exists.

1.4 Upgrade density to use screen-effective density.
- Keep existing density modes but factor viewport scale into the chosen mode.
- Zoom out can downgrade to compact label or point; zoom in can restore card mode.
- Cross-fade the mode switch without changing graph coordinates.
- Verification: `bash tests/graph-html-density.regression-1.sh` exits 0 and dense fixture checks prove point/compact/card transitions are reachable.

Phase acceptance:
- `npm run test -w @llm-wiki/graph-engine` exits 0.
- `bash tests/graph-html-minimap.regression-1.sh` exits 0.
- `bash tests/graph-html-density.regression-1.sh` exits 0.
- Browser check at 1440 x 960: wheel zoom centers on pointer, blank drag pans, blank double-click fits.
- Browser check on `tests/fixtures/graph-interactive-dense` offline HTML: continuous wheel interaction for 3 seconds does not visually freeze; if frame-rate tracing is available, record at least 50fps; if tracing is unavailable, record the manual smoothness result and device.
- Progress file records evidence and commit hash.

Automatic advancement: after all acceptance items pass and evidence is recorded, continue to Phase 2 without asking.

Commit boundary: one commit per verified work unit. Record phase acceptance in the progress file after the phase checks pass; include that update with the last completed work-unit commit when possible.

## Phase 2: Reading Drawer And Selection Semantics

Goal: make node click mean reading, make selection an upgraded state, and fix the single-node action mapping bug.

Visible result: clicking a node opens the right drawer with the page body. Shift-click, community click, legend click, or `+ neighbors` opens selection state. No floating selection panel covers the graph.

Surfaces:
- `packages/graph-engine/src/select/index.ts`
- `packages/graph-engine/src/types.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/test/select.test.ts`
- `workbench/web/src/components/GraphPanel.tsx`
- New files to create: `workbench/web/src/components/GraphReader.tsx`, `workbench/web/src/components/GraphSelection.tsx`
- `workbench/web/src/components/RightDrawer.tsx`
- `workbench/web/src/App.tsx`
- `workbench/web/src/lib/graph-selection.ts`
- `workbench/web/test/graph-selection.test.ts`
- `workbench/web/src/index.css`
- `workbench/web/src/graph.css`

Tasks:

2.1 Reproduce and pin down Shift multi-select behavior.
- Use a real browser against the current graph before changing selection code.
- Record whether the root cause is drag capture, event target, rerender, or missing discoverability.
- Verification: progress file records the repro path, root cause, and a regression assertion added in the same work unit.

2.2 Fix selection action mapping.
- Add explicit single-node actions: `总结这一页`, `它和谁有关`, `在对话中引用`.
- Single isolated node also shows `帮它链入知识库`.
- Single node never receives `探索潜在联系`.
- Statistics are hidden for a single node, and zero isolated count is hidden in multi-node stats.
- Verification: `npm run test -w @llm-wiki/graph-engine` exits 0 with all six action-table scenarios from the design covered.

2.3 Change graph click routing.
- Plain node click calls `onOpenPage({ path, node })` and highlights the node in workbench; the payload includes title, node id, source path, Chinese type source data, date/source metadata when present, and enough relationship facts to decide whether to show the isolated-node action. In offline HTML it opens the internal reader and highlights the node.
- Shift-click adds/removes nodes and emits an explicit selection-change callback only when the host supports selection. Do not reuse `onAsk` for selection state; real ask actions happen only after the user clicks a drawer action button.
- Community click and legend click enter selection state.
- Add a public graph-engine method that clears selected node, manual selection, search focus highlight, and offline reader state without changing pins or viewport.
- `Esc`, drawer close, knowledge-base switch, and graph view switch call that same clear method so selection and highlight cannot remain after the drawer closes.
- Verification: engine render tests or browser evidence prove plain click does not open selection actions, and Shift-click does.
- Verification: repeatable browser regression proves plain click opens reader, Shift-click opens selection, and close/Esc clear the graph state.

2.4 Move workbench reading into the right drawer.
- Refactor drawer state in `App.tsx` into one discriminated state object before adding graph modes, so `closed`, `wiki`, `artifacts`, `graph-reader`, and `graph-selection` cannot hold contradictory stale fields.
- Create `GraphReader.tsx` for the graph reading body and actions; `RightDrawer` owns shell, size, fullscreen, and close behavior only.
- Right drawer supports an explicit graph reader state with title, Chinese type, date when available, source link only for source pages, two actions, and markdown body. Do not overload the existing generic wiki preview state for graph reader behavior.
- It reuses `readPage` and `MarkdownView` for body content, and uses the graph open-page payload for metadata and action availability. Do not parse drawer metadata out of markdown body unless the graph node lacks that field.
- It removes queue, learning path, notes, summary block, confidence list, and neighbor list from reader state.
- Wikilinks inside the drawer switch the drawer page and call graph focus for the linked node.
- Verification: `node --import tsx --test workbench/web/test/*.test.ts` exits 0, and browser checks prove wikilink navigation updates drawer content and graph highlight.
- Verification: web tests cover drawer-state transitions among closed/wiki/artifacts/graph-reader/graph-selection, and browser regression proves wikilink navigation updates drawer content and graph highlight.

2.5 Move workbench selection into the right drawer.
- Create `GraphSelection.tsx` for graph selection facts, hint, action buttons, free text, and `+ neighbors`; `GraphPanel` should only emit selection changes and call graph engine methods.
- Right drawer supports an explicit graph selection state that is separate from generic wiki preview and artifact preview state.
- Selection drawer shows structural facts only for selections with at least two nodes.
- First line includes `Shift+点击 增删节点`.
- Free text placeholder is `补充说明（可选）`.
- Action buttons remain the primary path.
- `+ 邻居` upgrades one node to node plus one-hop neighbors.
- Verification: browser checks prove single node has no stats and no `探索潜在联系`; Shift multi-select opens selection drawer with the hint.
- Verification: web tests cover `GraphSelection` single-node and multi-node rendering, and browser regression proves single node has no stats and no `探索潜在联系`; Shift multi-select opens selection drawer with the hint.

Phase acceptance:
- `npm run test -w @llm-wiki/graph-engine` exits 0.
- `node --import tsx --test workbench/web/test/*.test.ts` exits 0.
- `npm run build -w @llm-wiki-agent/web` exits 0.
- Browser check at 1440 x 960 and 390 x 844 proves node click opens reader, Shift-click opens selection, Esc closes/clears, and no selection panel overlays the canvas.
- Browser check proves reader state has no learning queue, no summary block, no confidence list, and no neighbor section.
- Progress file records evidence and commit hash.

Automatic advancement: after all acceptance items pass and evidence is recorded, continue to Phase 3 without asking.

Commit boundary: one commit per verified work unit. Record phase acceptance in the progress file after the phase checks pass; include that update with the last completed work-unit commit when possible.

## Phase 3: Search And Community Legend

Goal: restore graph search and add a community legend that explains color, highlights communities, selects communities, and flies the viewport to them.

Visible result: Cmd/Ctrl+F opens graph search, query highlights matches and fades others, Enter cycles/focuses results, Esc clears. The left-top legend shows color, community name, and page count.

Surfaces:
- `packages/graph-engine/src/model/legacy-helpers.ts`
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/search.ts`
- `packages/graph-engine/src/render/legend.ts`
- `packages/graph-engine/src/render/styles.ts`
- `packages/graph-engine/test/learning.test.ts`
- New file to create unless implementation discovers an existing equivalent: `packages/graph-engine/test/search-and-legend.test.ts`
- `tests/graph-html-search.regression-1.sh`
- `tests/graph-html-styles.regression-1.sh`
- `workbench/web/src/components/GraphPanel.tsx`
- `workbench/web/src/index.css`

Tasks:

3.1 Add graph-scoped search UI.
- Cmd/Ctrl+F opens search when graph view is focused and does not hijack normal browser search outside the graph.
- Query uses `buildSearchIndex`, `buildSearchHaystack`, and `applySearchToNodeIds`.
- Matches highlight; non-matches fade.
- Empty query restores all nodes.
- Verification: engine tests assert match sets and DOM state; `bash tests/graph-html-search.regression-1.sh` is flipped to assert new search UI exists.
- Verification: engine tests assert match sets, cached index reuse, and DOM state; `bash tests/graph-html-search.regression-1.sh` is flipped to assert new search UI exists.

3.2 Add result cycling and viewport focus.
- Enter focuses the next match.
- Focus uses the viewport animation path from Phase 1.
- Esc exits search and restores visual state.
- Verification: browser check records Cmd/Ctrl+F, query, Enter, and Esc behavior in workbench and offline HTML.
- Verification: repeatable browser regression records Cmd/Ctrl+F, query, Enter, and Esc behavior in workbench and offline HTML.

3.3 Add community legend.
- Legend row contains color swatch, community label, and page count.
- Hover highlights a community and fades others.
- Click selects the community, opens selection drawer in workbench, and focuses the viewport on the community.
- Collapse state is stored in localStorage and not written to the knowledge base.
- Verification: engine tests assert legend data; browser check proves hover, click, collapse, and reload persistence.
- Verification: engine tests assert legend data and selection payloads; repeatable browser regression proves hover, click, collapse, and reload persistence.

3.4 Keep host behavior consistent.
- Offline HTML uses an engine-owned selection panel or internal selection drawer that shows the selected pages, structural facts, and Shift hint, but never shows ask actions.
- Workbench legend selection flows into right drawer selection.
- Verification: `bash tests/graph-html-insights.regression-1.sh` exits 0 and asserts offline selection facts exist while offline ask actions remain absent.

Phase acceptance:
- `npm run test -w @llm-wiki/graph-engine` exits 0.
- `bash tests/graph-html-search.regression-1.sh` exits 0.
- `bash tests/graph-html-styles.regression-1.sh` exits 0.
- `bash tests/graph-html-insights.regression-1.sh` exits 0.
- Browser checks at 1440 x 960 and 768 x 1024 prove search and legend work in workbench and offline HTML, including offline community and Shift selections with visible facts but no ask buttons.
- Progress file records evidence and commit hash.

Automatic advancement: after all acceptance items pass and evidence is recorded, continue to Phase 4 without asking.

Commit boundary: one commit per verified work unit. Record phase acceptance in the progress file after the phase checks pass; include that update with the last completed work-unit commit when possible.

## Phase 4: Slim Nodes And Hover Preview

Goal: reduce default node noise while preserving useful preview information on hover.

Visible result: default card nodes show one title line and a type color strip; weight and type text disappear from default state. Hover shows a preview card with title, Chinese type, and two to three lines of summary extracted from content.

Surfaces:
- `packages/graph-engine/src/render/model.ts`
- `packages/graph-engine/src/render/static-renderer.ts`
- `packages/graph-engine/src/render/preview.ts`
- `packages/graph-engine/src/render/styles.ts`
- `packages/graph-engine/src/model/legacy-helpers.ts`
- `packages/graph-engine/test/render-model.test.ts`
- `packages/graph-engine/test/helpers.test.ts`
- `tests/graph-html-density.regression-1.sh`
- `tests/graph-html-drawer-neighbors.regression-1.sh`
- `tests/graph-html-long-label.regression-1.sh`
- `workbench/web/src/index.css`

Tasks:

4.1 Slim default node DOM and CSS.
- Remove default visible type text and weight number.
- Keep the left type color strip and one title line.
- Hover or selected node may expand to the existing richer card shape.
- Verification: render tests and offline HTML assertions prove `.node-kind` and weight number are not visible in default card state while selected/hover can still expose details.

4.2 Add hover preview card.
- Use `stripAtlasMarkdown` and existing content; do not add graph-data summary requirements.
- Extract the first useful paragraph after frontmatter and heading removal.
- Content-empty nodes show title and type without throwing.
- Preview appears after about 300ms, is read-only, follows node hover, and disappears on leave.
- Verification: unit tests cover content, frontmatter, wikilink, empty content, and truncation cases.

4.3 Preserve dense-mode behavior.
- Point and compact nodes also support hover preview.
- Dense fixture still downgrades correctly and does not render every node as a full card.
- Verification: `bash tests/graph-html-density.regression-1.sh` exits 0 and includes preview assertions for point/compact modes.

Phase acceptance:
- `npm run test -w @llm-wiki/graph-engine` exits 0.
- `bash tests/graph-html-density.regression-1.sh` exits 0.
- `bash tests/graph-html-long-label.regression-1.sh` exits 0.
- Browser check on dense fixture proves preview appears for card, compact, and point nodes, and no preview appears for empty content beyond title/type.
- Browser checks at 1440 x 960 and 390 x 844 prove text does not overflow node cards or preview cards.
- Progress file records evidence and commit hash.

Automatic advancement: after all acceptance items pass and evidence is recorded, continue to Phase 5 without asking.

Commit boundary: one commit per verified work unit. Record phase acceptance in the progress file after the phase checks pass; include that update with the last completed work-unit commit when possible.

## Phase 5: Integration, Offline HTML, Themes, And Release Docs

Goal: prove the whole stage works together and update release-facing docs if the implementation changes shipped behavior.

Visible result: workbench and offline HTML share the new graph experience across light/dark themes and across desktop/mobile viewports.

Surfaces:
- `scripts/build-graph-html.sh`
- `packages/graph-engine/src/render/static-renderer.ts`
- `workbench/web/src/components/GraphPanel.tsx`
- `workbench/web/src/components/RightDrawer.tsx`
- `workbench/web/src/index.css`
- `workbench/web/src/graph.css`
- `tests/graph-html-*.sh`
- `README.md`
- `CHANGELOG.md`

Tasks:

5.1 Verify offline HTML capabilities and reader meta.
- Offline HTML keeps no ask buttons.
- Offline reader uses Chinese type and date metadata, and keeps source link only for source pages.
- Offline search, legend, navigation, hover preview, and localStorage pins work after a reload.
- Verification: graph-html regression scripts and browser check against generated fixture pass.
- Verification: graph-html regression scripts and repeatable browser checks against generated fixture pass.

5.2 Verify workbench theme and responsive behavior.
- Shan-shui and mo-ye themes work for navigation, drawer reader, selection, search, legend, and hover preview.
- Drawer becomes usable on 390 x 844 without incoherent overlap.
- Verification: browser screenshots or observations recorded for 1440 x 960, 768 x 1024, and 390 x 844 in light and dark themes.
- Verification: repeatable browser checks and screenshots or observations are recorded for 1440 x 960, 768 x 1024, and 390 x 844 in light and dark themes.

5.3 Run full project verification.
- Run all fast checks, focused graph regressions, and full `tests/regression.sh`.
- Run repeatable browser graph checks for workbench and offline targets.
- Run `bash install.sh --dry-run --platform codex`.
- Run the privacy scan command.
- Verification: every command exits as specified and is recorded in the progress file.

5.4 Update docs and release notes if code changed behavior.
- Add top `CHANGELOG.md` entry with date and stage 4.5 changes.
- Update `README.md` graph feature text to match the shipped experience if it still mentions removed learning queue/path/notes as current graph features.
- Do not update docs for plan-only changes.
- Verification: `rg -n "学习队列|从这里开始|札记笔记" README.md CHANGELOG.md workbench/docs/stage-4.5-plan.md` output is reviewed so no current-feature wording conflicts with stage 4.5.

Phase acceptance:
- `npm run typecheck` exits 0.
- `npm run build -w @llm-wiki-agent/web` exits 0.
- `npm run test -w @llm-wiki/graph-engine` exits 0.
- `node --import tsx --test workbench/web/test/*.test.ts` exits 0.
- `node --import tsx --test workbench/server/src/*.test.ts workbench/server/src/digest/*.test.ts` exits 0.
- `bash tests/graph-browser-stage-4-5.regression-1.sh --target workbench` exits 0.
- `bash tests/graph-browser-stage-4-5.regression-1.sh --target offline` exits 0.
- `bash tests/regression.sh` exits 0.
- `bash install.sh --dry-run --platform codex` exits 0.
- Privacy scan command exits 0.
- Browser verification evidence is recorded for all named viewports and both themes.
- `workbench/docs/stage-4.5-progress.json` records final residual risk.

Automatic advancement: after all acceptance items pass and evidence is recorded, mark the ledger complete and report without pushing, merging, or amending.

Commit boundary: one commit per verified work unit. Record phase acceptance in the progress file after the phase checks pass; include that update with the last completed work-unit commit when possible.

## Test And Evaluation Plan

Automated checks:
- Engine tests cover viewport math wiring, selection mapping, open-page payload metadata, clear-interaction state, search matching and cached index reuse, legend selection, preview extraction, density behavior, pin coordinate separation, and no high-frequency full repaint during pan/zoom.
- Web tests cover graph selection prompt payload, drawer state wiring, `GraphReader`, `GraphSelection`, wikilink graph focus, and API helper behavior.
- Server tests cover unchanged graph APIs and page reading if touched.
- Offline regression scripts cover generated HTML content, old UI removal, new UI presence, internal reader content, no runtime markdown fetch, complete non-AI selection facts, single-file packaging, minimap, density, a11y, mobile, and design contracts.
- Browser regression script covers core workbench and offline graph interactions. Codex in-app Browser checks may add screenshots and observations, but do not replace the committed regression script.

Browser checks:
- Workbench graph on a real KB or representative fixture at 1440 x 960, 768 x 1024, and 390 x 844.
- Offline `knowledge-graph.html` opened directly from fixture output.
- Interactions: wheel zoom, blank pan, double-click fit, node read, wikilink drawer navigation, Shift multi-select, `+ neighbors`, Cmd/Ctrl+F search, Enter cycle, Esc clear, legend hover/click/collapse, hover preview, light/dark theme.

Manual checks allowed only for:
- Mouse wheel and trackpad feel.
- Frame-rate trace if local tooling cannot capture performance data.

### Required Coverage Diagram

```text
CODE PATHS                                                   USER FLOWS
[+] graph-engine viewport                                    [+] Navigate graph canvas [-> browser]
  ├── [GAP] wheel delta normalization and pointer focus         ├── [GAP] wheel zoom centers on pointer
  ├── [GAP] blank drag pan with rAF coalescing                  ├── [GAP] blank drag pans without node drift
  ├── [GAP] double-click fit and minimap viewport rect          └── [GAP] blank double-click fits visible graph
  └── [GAP] clearInteraction leaves pins and viewport intact

[+] graph-engine read/selection callbacks                    [+] Read and select pages [-> browser]
  ├── [GAP] onOpenPage({ path, node }) metadata payload         ├── [GAP] plain click opens reader, not actions
  ├── [GAP] onSelectionChange separate from ask action          ├── [GAP] Shift-click opens selection drawer
  ├── [GAP] single-node action table, isolated and linked       ├── [GAP] + neighbors upgrades one node
  └── [GAP] offline non-AI selection facts, no ask buttons      └── [GAP] Esc/close/kb/view switch clears state

[+] workbench drawer                                         [+] Reader drawer [-> browser]
  ├── [GAP] discriminated drawer state transitions              ├── [GAP] wikilink changes drawer page and focus
  ├── [GAP] GraphReader loading/error/body/action states        ├── [GAP] mobile drawer has no overlap
  └── [GAP] GraphSelection facts/actions/free text states       └── [GAP] reader omits queue/path/notes/summary

[+] search, legend, preview                                  [+] Explore graph [-> browser]
  ├── [GAP] search index built once per graph data              ├── [GAP] Cmd/Ctrl+F query, Enter cycle, Esc clear
  ├── [GAP] legend hover/click/collapse persistence             ├── [GAP] legend selects community and focuses viewport
  ├── [GAP] preview extraction empty/markdown/frontmatter       └── [GAP] hover preview works in card/compact/point
  └── [GAP] lazy preview cache avoids pre-rendering dense graph

COVERAGE TARGET: 100% of listed paths must have unit, shell regression, or browser regression coverage before the ledger can complete.
```

### Browser Regression Contract

- Add a portable browser regression harness before accepting any UI phase. Prefer the repo's existing Node workspace and `node:test` style for assertions; use Playwright or the closest existing browser runner only after probing availability and documenting setup.
- The harness must start the workbench server on port 8787 and the Vite web app on port 5180, fail fast if either port is occupied, and clean up both processes on exit.
- The harness must generate an offline fixture in a temp directory, open the generated `knowledge-graph.html` directly or through a local static server when the browser runner cannot drive `file://`, and keep the product requirement that double-clicked HTML works offline.
- The harness must store screenshots or traces under `workbench/docs/stage-4.5-artifacts/` or `/tmp` first and then copy into that directory. The progress file records artifact paths.
- The harness must run against both the workbench dev server and a generated offline fixture. It must verify DOM state after actions, not only save screenshots.
- Required workbench checks: node click opens graph reader, Shift-click opens graph selection, `+ neighbors` changes selection size, Esc and drawer close clear graph state, wikilink navigation updates drawer and graph focus, search keyboard flow works, legend selection opens graph selection, mobile drawer does not overlap graph controls.
- Required offline checks: node click opens internal reader from embedded content, no runtime `fetch()` is needed for markdown, Shift/community/legend selection shows facts and Shift hint, ask buttons are absent, search and preview work.
- Codex in-app Browser checks are encouraged for Codex execution: use them to capture screenshots and inspect the live page at the required viewports. Because Claude Code and CI may not expose that skill, Codex Browser evidence is additive and cannot replace the committed script.

### Interaction State Contract

- Graph engine owns graph-local interaction state: selected node, manual selection, search focus, legend focus, hover preview, offline reader state, and viewport. Workbench owns drawer content, loading/error state, chat prompt dispatch, and artifact/wiki drawer modes.
- All graph-to-workbench transitions go through explicit callbacks: `onOpenPage({ path, node })` for reader and `onSelectionChange(selection)` for selection. Asking AI only happens after a drawer action button.
- Workbench drawer close, Esc, knowledge-base switch, and main-view switch call the same public `clearInteraction()` method. This clears highlight/search/selection/preview/offline reader state without changing pins or viewport.
- Esc priority order: close graph search first, then close hover/preview affordance if open, then close graph drawer/selection and clear interaction, then leave browser/default handling alone. Tests cover each priority.
- Click-vs-drag rule: pointer movement beyond a small threshold becomes drag/pan and suppresses click/open. Plain node click opens reader only after pointerup below threshold. Shift-click toggles selection. Blank drag pans. Blank double-click fits. Node dragging for pins keeps pointer capture and does not open reader on release.
- Cmd/Ctrl+F opens graph search only when the graph view is active and focus is inside the graph shell or its toolbar, and not when a text input, textarea, drawer editor, or browser page outside the graph is focused.
- Graph data changes invalidate search index, legend data, preview cache, selected node, and drawer graph metadata when the referenced node/path disappears. Existing drawer page content may remain only if `/api/page` still reads the path; graph focus must clear when no node matches.
- Wikilink focus resolves by normalized wiki path first (`source_path`, `path`, `source`), then by exact node id only if unambiguous. Duplicate titles never decide focus. Missing graph nodes still open the page but do not leave stale graph focus.
- Community legend labels use `learning.communities[].label` or atlas community labels; fallback is the community id. Tests cover missing labels and stable page counts.
- Markdown for offline reader and preview must use the existing marked plus DOMPurify boundary before `innerHTML`. Preview text may use stripped plain text. No new raw markdown-to-HTML path may bypass sanitization.
- Mobile scope: full pinch/pan gesture support remains out of scope, but tap-to-read, Shift-equivalent selection affordance, search, legend, drawer close, and keyboard/focus preview fallback must be usable at 390 x 844.

### Fixture-First Requirements

Create or extend fixtures before feature code relies on them:
- Metadata fixture with source page, topic/entity page, date/source metadata, Chinese type labels, and source link eligibility.
- Empty-content and frontmatter-heavy fixture for reader and preview extraction.
- Wikilink fixture with exact path links, duplicate labels, missing graph node, and normal markdown links.
- Selection fixture with linked single node, isolated single node, two linked nodes, two unlinked nodes, multi-community selection, and community selection.
- Dense fixture with at least 200 nodes, community labels, mixed content length, and enough edges to exercise point/compact/card density.
- Offline fixture with embedded content and no sibling markdown reads.

### Performance Guardrails

- Pan and zoom must update one content-layer transform and minimap viewport state; they must not rebuild the graph DOM or write every node/edge position on every wheel or pointermove.
- requestAnimationFrame coalescing must be covered by tests so one burst of wheel/pointer events produces at most one DOM write per frame.
- Search index and legend data must be built once per graph data or visibility snapshot, not once per keystroke.
- Hover preview extraction must be lazy and cached per node; dense graphs must not pre-render every preview card.
- Dense fixture browser evidence must cover at least 3 seconds of continuous wheel/pan interaction. Record trace or frame-rate data when available; otherwise record Codex Browser or manual observation as supplemental evidence and keep the script gate in place.

## Not In Scope

- Learning queue.
- "Start here" learning path.
- Notes.
- Drawer back/forward history.
- Inertial scrolling.
- AI-generated true summaries stored in graph data.
- Full mobile touch gesture system.
- New backend reading endpoint.
- Canvas rendering backend.
- Fixing already generated old HTML files; users regenerate after this stage.

## Failure Modes And Recovery

- Host layout is measured before drawer or grid width changes settle. User sees nodes and edges drift apart after focus or fit. Planned guard: synchronize host dimensions before viewport fit/focus/transform writes and cover drawer-open focus with browser evidence.
- Viewport transform mutates node or pin coordinates. User sees pins jump after zoom. Planned guard: engine tests assert PinMap and model coordinates are unchanged after viewport operations.
- Wheel or pointermove does heavy DOM work. User sees stutter on dense graphs. Planned guard: transform-layer tests and dense fixture browser check.
- Shift multi-select still routes as plain click or drag. User cannot build manual selections. Planned guard: browser repro first, regression assertion after fix, visible Shift hint.
- Single-node selection shows multi-node actions. User sees `探索潜在联系` on one page. Planned guard: action-table tests for all six design rows.
- Drawer page path cannot be read. User sees an error instead of silent failure. Planned guard: reuse `/api/page` and test path validation.
- Drawer mode and content fields drift apart. User sees stale wiki body, stale artifact title, or stale graph selection in the wrong drawer mode. Planned guard: use one discriminated drawer state object and tests for switching wiki/artifact/graph-reader/graph-selection/closed.
- Drawer closes while graph state remains selected. User sees a stale highlight or selected community after Esc/close/switch. Planned guard: one clear-interaction method and browser checks for Esc, close button, knowledge-base switch, and view switch.
- Search state survives Esc or no-results silently hides graph. User sees stale fades. Planned guard: search tests for empty query, no result, Enter, and Esc.
- Offline selection only highlights nodes without showing facts. User cannot tell what the exported graph selected. Planned guard: offline browser and regression checks assert selection facts are visible and ask actions are absent.
- Hover preview crashes on empty content. User sees broken graph. Planned guard: preview extraction tests for empty content.
- Offline reader tries to fetch markdown files from a generated `file://` HTML. User sees blank or blocked reader content in local browser. Planned guard: assert reader content is rendered from embedded graph node content.
- Offline and workbench diverge. User regenerates HTML and gets a different feature set. Planned guard: shared engine assertions plus workbench and offline browser checks.
- Dense graph performance regresses because preview/search/legend work runs inside high-frequency input handlers. User sees lag while panning or searching. Planned guard: performance-contract tests and dense browser regression assert no full DOM repaint in pan/zoom and no eager preview rendering.
- Keyboard handling order is ambiguous. User presses Esc and the wrong layer closes or stale graph state survives. Planned guard: explicit Esc priority tests for search, preview, drawer, and clear-interaction paths.
- Browser search is hijacked outside the graph. User presses Cmd/Ctrl+F in chat or normal page content and graph search steals focus. Planned guard: graph focus-model tests and browser regression around input/drawer focus.
- Pointer gestures conflict. User drags a node or pans blank canvas and accidentally opens a reader or changes selection. Planned guard: click-vs-drag threshold tests and browser regression for drag suppression.
- Cached search, legend, preview, or drawer metadata survives a graph rebuild. User sees stale node labels or selected pages. Planned guard: graph-data cache invalidation tests keyed by build date and node/edge content.
- Markdown sanitization is bypassed by a new preview or reader path. User sees unsafe embedded HTML execute. Planned guard: unit tests prove preview is plain text or sanitized HTML before insertion.

## Worktree Parallelization Strategy

| Step | Modules touched | Depends on |
|---|---|---|
| Engine viewport/search/legend/preview internals | `packages/graph-engine/src`, `packages/graph-engine/test` | none |
| Workbench drawer reader/selection | `workbench/web/src`, `workbench/web/test` | Engine callback contracts |
| Offline HTML and shell regressions | `scripts`, `tests`, `packages/graph-engine/src/render` | Engine reader/selection contracts |
| Browser regression harness | `tests/browser`, `tests`, `workbench/web`, offline fixture output | Workbench and offline DOM contracts |
| Release docs | repo docs | Shipped behavior verified |

Parallel lanes:
- Lane A: engine internals first. This lane defines the public callback and clear-interaction contracts.
- Lane B: workbench drawer can start after the engine contracts are typed.
- Lane C: offline HTML can start after engine internal reader and selection contracts are stable.
- Lane D: browser regression harness starts once workbench and offline DOM contracts exist, then runs across all lanes before final acceptance.

Execution order: launch Lane A first, then B and C can proceed in parallel once contracts compile. Lane D validates both. Docs wait until all behavior is verified.

Conflict flags: Lane A and C both touch graph-engine render internals. Coordinate the renderer file split before parallelizing those two lanes.

## Implementation Tasks

- [ ] **T1 (P1, human: ~3h / CC: ~25min)** - tests - Add repeatable browser regression for stage 4.5 graph interactions.
  - Surfaced by: Test Review D11.
  - Files: `tests/graph-browser-stage-4-5.regression-1.sh`, `tests/browser/graph-stage-4-5.spec.ts`, workbench/offline fixtures as needed.
  - Verify: both browser regression commands exit 0 for workbench and offline targets.
- [ ] **T2 (P1, human: ~2h / CC: ~20min)** - graph-engine - Cover callback boundaries, clear interaction, and open-page metadata with tests.
  - Surfaced by: Architecture and Test Review.
  - Files: `packages/graph-engine/src/types.ts`, `packages/graph-engine/src/index.ts`, `packages/graph-engine/src/render/*`, `packages/graph-engine/test/*.test.ts`.
  - Verify: `npm run test -w @llm-wiki/graph-engine` exits 0.
- [ ] **T3 (P1, human: ~2h / CC: ~20min)** - workbench - Add drawer state, reader, and selection tests.
  - Surfaced by: Code Quality and Test Review.
  - Files: `workbench/web/test/graph-drawer-state.test.ts`, `workbench/web/test/graph-reader.test.ts`, `workbench/web/test/graph-selection-drawer.test.ts`.
  - Verify: `node --import tsx --test workbench/web/test/*.test.ts` exits 0.
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** - performance - Add dense graph performance contracts.
  - Surfaced by: Performance Review.
  - Files: `packages/graph-engine/test/*.test.ts`, `tests/graph-browser-stage-4-5.regression-1.sh`.
  - Verify: engine tests prove rAF coalescing, cached search, lazy preview, and no full repaint in pan/zoom; dense browser regression passes.
- [ ] **T5 (P1, human: ~3h / CC: ~25min)** - interaction contracts - Lock Esc, focus, click-vs-drag, cache invalidation, fixture, and sanitization behavior before UI code fans out.
  - Surfaced by: Codex outside voice review.
  - Files: `packages/graph-engine/src/render/*`, `packages/graph-engine/test/*.test.ts`, `workbench/web/test/*.test.ts`, `tests/fixtures/*`, `tests/graph-browser-stage-4-5.regression-1.sh`.
  - Verify: engine, web, offline shell, and browser regressions cover each interaction contract.

## Decision Log

| Decision | Reason | Rejected Alternative | Source |
|---|---|---|---|
| Use L phased plan | More than 10 verifiable units across engine, web, offline, and tests | Flat checklist | `spec-to-goal-plan` sizing rule |
| Reuse existing viewport/search/markdown helpers | They already exist in graph-engine and are protected by tests | Reimplement math and text cleaning in renderer | `legacy-helpers.ts`, stage 4.5 D4.5-1/D4.5-5/D4.5-7 |
| Put workbench reading and selection in right drawer | Avoids floating panel covering nodes and matches existing preview mental model | Keep graph floating selection panel | stage 4.5 D4.5-2/D4.5-3/D4.5-4 |
| Keep offline reader inside engine | Offline HTML has no server API or React drawer | Add an offline-only host branch in build script | stage 4 D3 capabilities model |
| Separate selection-change callbacks from ask actions | Selection is a graph state transition; asking AI is a later drawer command | Keep using `onAsk` as the selection notification name | `/plan-eng-review` D3, 2026-06-13 |
| Pass page path plus node metadata when opening graph reader | The reader needs title, type, source/date metadata, and action availability; markdown body parsing would be brittle | Pass only path and infer metadata from markdown | `/plan-eng-review` D4, 2026-06-13 |
| Add explicit right-drawer graph reader and graph selection modes | Generic wiki preview state cannot safely carry graph metadata, selection, and close/clear behavior | Reuse the generic wiki preview mode with extra flags | `/plan-eng-review` D5, 2026-06-13 |
| Add a public graph clear-interaction method | Drawer close, Esc, kb switch, and view switch must clear highlights and selections through one tested path | Rely on indirect focus/selection side effects | `/plan-eng-review` D6, 2026-06-13 |
| Split graph reader and graph selection into dedicated components | `GraphPanel` and `RightDrawer` are already shell components; embedding full graph drawer content there would make the complete stage hard to test and maintain | Keep split optional and inline the new UI if convenient | `/plan-eng-review` D7, 2026-06-13 |
| Split graph-engine renderer internals by feature | `static-renderer.ts` is already over 1000 lines and stage 4.5 adds several independent UI subsystems | Keep adding viewport/search/legend/reader/preview/styles inline | `/plan-eng-review` D8, 2026-06-13 |
| Refactor workbench drawer state into one discriminated object | Scattered drawer fields can create contradictory mode/content/loading combinations once graph reader and graph selection are added | Keep adding fields to the existing independent state variables | `/plan-eng-review` D9, 2026-06-13 |
| Move workbench graph styles into `graph.css` | `index.css` is already large and graph 4.5 adds enough dedicated styling to deserve a focused file | Continue adding all graph styles to `index.css` | `/plan-eng-review` D10, 2026-06-13 |
| Treat search and legend as engine features | Both hosts need the same behavior | Implement separate workbench and offline UIs | stage 4 D3, stage 4.5 D4.5-5/D4.5-6 |
| Give offline HTML a complete non-AI selection panel | The author chose full stage 4.5, and exported graphs still need visible selected facts even without chat actions | Only highlight offline selections | `/plan-eng-review` D2, 2026-06-13 |
| Browser checks are required evidence | UI smoothness and overlay issues are not proven by string tests | Rely only on regression scripts | graph null-safety solution and AGENTS verification rule |
| Require repeatable browser interaction tests plus Codex Browser supplemental evidence | Core graph behavior crosses engine, React drawer, generated HTML, keyboard, and pointer interactions; scripts make it repeatable while Codex Browser gives live visual evidence in Codex runs | Treat browser observations as enough without a committed script | `/plan-eng-review` D11, 2026-06-13 |
| Add dense-graph performance contracts | Smoothness can regress even when DOM strings and unit tests pass | Rely on subjective feel checks only | `/plan-eng-review` performance review, 2026-06-13 |
| Absorb outside-voice hardening without reducing scope | Codex outside voice found underspecified focus, Esc, pointer, fixture, cache, security, branch, and commit-boundary details; these are implementation guardrails, not product scope cuts | Leave the plan ambiguous and rely on executor judgment | `/plan-eng-review` outside voice, 2026-06-13 |
| Base execution branch on a commit containing stage 4.5 design and graph-engine | Current `main` may not contain the design branch yet | Always branch from `main` and rediscover missing files | repo state on 2026-06-13 |
| Keep the complete stage 4.5 scope with complexity guard | The author chose full outcome over shortcut delivery; scope risk should be handled by reusing host shells first, not by cutting user-visible goals | Reduce to a minimal graph fix | `/plan-eng-review` D1, 2026-06-13 |

## /goal Starter

```text
/goal Implement /Users/kangjiaqi/Desktop/project/llm-wiki-skill/workbench/docs/stage-4.5-plan.md by following its execution ledger.

Each turn:
1. Read /Users/kangjiaqi/Desktop/project/llm-wiki-skill/workbench/docs/stage-4.5-progress.json, then the current work unit in the plan.
2. Before work, ensure the branch and clean-start commit exist per the plan, then run `git log --oneline -15` and the plan's smoke check.
3. Work only on the current work unit.
4. After verification passes: update progress status/evidence/log fields only, commit that work unit, record the hash. Never commit failed verification. Never push, merge, or amend.
5. When a phase's acceptance checks all pass, record it and continue to the next phase without asking.

Done when every work unit is complete, every acceptance check is proven, and final risk is recorded.

Stop and report if a product decision is missing, the plan conflicts with the latest direction, or unrelated worktree changes cannot be safely separated.
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | not required for this plan review |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 | issues found, absorbed | outside voice found focus, Esc, pointer, fixture, cache, security, branch, and commit-boundary hardening items |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR | 13 issues, 0 critical gaps, 0 unresolved decisions |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | UI work remains covered by browser and responsive checks in this plan |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | not required for this plan review |

- **CODEX:** outside voice ran and its substantive findings were folded into the plan as guardrails, not scope cuts.
- **CROSS-MODEL:** both reviews agree this should stay complete, but must be protected by explicit interaction contracts and repeatable browser tests.
- **VERDICT:** ENG CLEARED - ready to implement after creating the dedicated feature branch from reviewed base commit `f3a7ccd`.
NO UNRESOLVED DECISIONS
