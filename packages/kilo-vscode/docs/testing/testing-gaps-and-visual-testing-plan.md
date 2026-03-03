# Testing Gaps & Visual Testing Plan

## Context

The kilo-vscode extension has a layered UI architecture:

```
packages/ui/           ← upstream opencode UI (SolidJS components, forked)
packages/kilo-ui/      ← kilo-specific UI layer (~89 re-export stubs + ~33 CSS overrides)
packages/kilo-vscode/webview-ui/  ← extension webview (SolidJS app consuming kilo-ui)
packages/kilo-vscode/src/         ← extension host (TypeScript, VS Code API)
```

When opencode upstream merges land, `packages/ui` is the blast radius. Changes there ripple
through `packages/kilo-ui` (which re-exports everything) into the webview at runtime.

---

## Current Test Coverage Summary

### CI Workflows

| Workflow | Trigger | What it runs |
|----------|---------|--------------|
| `test.yml` – unit | Every PR + push to `main` | `bun turbo test` → `packages/opencode` + `packages/app` unit tests |
| `test.yml` – e2e | ~~Every PR~~ **Disabled** (`if: false`) | Playwright e2e against `packages/app` — disabled because packages/app is not actively maintained |
| `test-vscode.yml` – unit | PRs touching `packages/kilo-vscode/**`, `packages/ui/**`, or `packages/kilo-ui/**`; pushes to `dev` | `bun run test:unit` in `packages/kilo-vscode` |
| `typecheck.yml` | Every PR + push to `main` | `bun typecheck` across all packages |

### What IS tested (and where it runs in CI)

| Area | Tests | CI Coverage |
|------|-------|-------------|
| Extension host logic (TypeScript) | 48 bun unit tests in `tests/unit/` | ✅ `test-vscode.yml` |
| Message contract (extension ↔ webview) | `message-contract.test.ts` | ✅ `test-vscode.yml` |
| UI contract (kilo-ui ↔ upstream) | `kilo-ui-contract.test.ts` – runtime ToolRegistry, getToolInfo, DataProvider checks | ✅ `test-vscode.yml` |
| Worktree / git operations | `worktree-manager.test.ts` | ✅ `test-vscode.yml` |
| Autocomplete | `autocomplete-*.test.ts` | ✅ `test-vscode.yml` |
| Web app (packages/app) | Unit tests | ✅ `test.yml` |
| opencode CLI logic | bun unit tests in `packages/opencode/test/` | ✅ `test.yml` |
| UI components | Storybook stories (48 stories) | ❌ Manual only — never runs in CI |

### What IS NOT tested

| Area | Gap | Risk |
|------|-----|------|
| `packages/ui` component rendering | Zero automated rendering tests | **Critical** – upstream merges silently break UI |
| `packages/kilo-ui` CSS overrides | No visual/snapshot tests | CSS classes can vanish after a merge |
| Webview UI message rendering | No rendering tests for the chatview | Tool renderers, message display can break entirely |
| `kilocode_change` marker preservation | No comprehensive automated check that markers weren't reverted | Merges can silently trample kilocode customizations |
| VSCode-specific overrides (`VscodeToolOverrides`) | No rendering test that the overrides actually work | `bash` defaultOpen behavior can silently break |
| `TaskToolExpanded` component | No test | Child session rendering logic can break |
| `VscodeSessionTurn` component | No test | Core chat rendering, zero coverage |
| Theme / CSS variable integrity | No visual regression | Color and spacing regressions after merges |

---

## Testing Gaps – Details

### 1. `packages/ui` – Zero Rendering Tests

`packages/ui` has 50+ SolidJS components and a large [`message-part.tsx`](../../../ui/src/components/message-part.tsx) (~1980 lines). The
only existing test mechanism is Storybook stories in `packages/kilo-ui/src/stories/`, which are
**manual only** — they require a human to open a browser and look.

When upstream opencode merges land, components like [`Message()`](../../../ui/src/components/message-part.tsx:477),
[`UserMessageDisplay()`](../../../ui/src/components/message-part.tsx:665),
[`AssistantMessageDisplay()`](../../../ui/src/components/message-part.tsx:503) may have their
props, data-attributes, or DOM structure changed. There is nothing to catch this.

**Key coupling points that need monitoring:**
- [`ToolRegistry`](../../../ui/src/components/message-part.tsx:908) – tool registrations could be renamed or removed
- [`getToolInfo()`](../../../ui/src/components/message-part.tsx:169) – return shape can change; `VscodeSessionTurn` depends on it
- [`PART_MAPPING`](../../../ui/src/components/message-part.tsx:110) – part renderers could change
- [`DataProvider`](../../../ui/src/context/data.tsx:31) props – the `onOpenFile` kilocode_change could be removed

> **Note:** [`kilo-ui-contract.test.ts`](../../tests/unit/kilo-ui-contract.test.ts) now covers runtime checks
> for `ToolRegistry`, `getToolInfo`, and `DataProvider` exports. These are static contract tests,
> not rendering tests — they cannot catch DOM structure or CSS breakage.

### 2. `packages/kilo-ui` – CSS Overrides Untested

`packages/kilo-ui` has 33 CSS override files for upstream components. Examples:
- [`packages/kilo-ui/src/components/message-part.css`](../../../kilo-ui/src/components/message-part.css) – 116 lines
- [`packages/kilo-ui/src/components/markdown.css`](../../../kilo-ui/src/components/markdown.css) – custom markdown styling
- Component-specific overrides for `basic-tool`, `chat-input`, `prompt-input`, etc.

After a merge, upstream CSS can add new class names or change `data-*` attributes that
selector-based kilo overrides depended on. Nothing catches this.

### 3. `kilocode_change` Markers – No Comprehensive Regression Guard

There are 55 `kilocode_change` markers in `packages/ui`. Any upstream merge can silently
overwrite them. The existing [`kilo-ui-contract.test.ts`](../../tests/unit/kilo-ui-contract.test.ts)
checks for `onOpenFile`/`OpenFileFn` in `DataProvider`, but does not verify all 55 markers.

Key changes that must survive merges:
- [`data.tsx:29`](../../../ui/src/context/data.tsx:29) – `OpenFileFn` type (enables click-to-open in VS Code)
- [`data.tsx:38`](../../../ui/src/context/data.tsx:38) – `onOpenFile` prop on DataProvider
- [`marked.tsx:464`](../../../ui/src/context/marked.tsx:464) – custom markdown link handling
- [`message-part.tsx:1196`](../../../ui/src/components/message-part.tsx:1196) – `classList={{ clickable }}` on file paths
- [`message-part.tsx:1442`](../../../ui/src/components/message-part.tsx:1442) – `defaultOpen` on bash tool

### 4. Webview Chat Components – No Tests

`VscodeSessionTurn`, `TaskToolExpanded`, and `VscodeToolOverrides` are entirely untested.
They are VS Code-specific overrides of upstream rendering logic:

- [`VscodeSessionTurn.tsx`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx) – flat rendering (no "Gathered context" grouping)
- [`TaskToolExpanded.tsx`](../../webview-ui/src/components/chat/TaskToolExpanded.tsx) – child session tool listing
- [`VscodeToolOverrides.tsx`](../../webview-ui/src/components/chat/VscodeToolOverrides.tsx) – sets `bash` defaultOpen

### 5. Storybook Stories Exist But Are Unused in CI

`packages/kilo-ui` has 48 Storybook stories (Storybook 10) covering all UI components. They serve
as a development aid but are never built or checked in CI. There is no Chromatic, Backstop, or
snapshot pipeline.

---

## What's Already Been Done

The following items from the original plan have been completed:

### ✅ Phase 0 – CI Trigger Fix (DONE)

The `test-vscode.yml` workflow now includes `packages/ui/**` and `packages/kilo-ui/**` in the
`paths` filter, so upstream merge PRs run the extension unit tests. This was merged to `main`
in commit `1a7294ff7`.

### ✅ Phase 1.2, 1.3, 1.4 – Contract Tests (DONE)

[`kilo-ui-contract.test.ts`](../../tests/unit/kilo-ui-contract.test.ts) implements runtime
contract tests that go beyond the original plan's source-analysis approach:

| Test | What it checks | Method |
|------|---------------|--------|
| ToolRegistry tool names | All 7 tool names (`bash`, `task`, `read`, `write`, `glob`, `edit`, `todowrite`) are registered | Runtime — imports `ToolRegistry` via `Bun.spawnSync` in kilo-ui context and calls `ToolRegistry.render(name)` |
| `getToolInfo` export | Function exists and is exported | Runtime import check |
| `ToolInfo` type shape | `icon` and `title` fields present | Source regex on `message-part.tsx` |
| `DataProvider` + `useData` | Both are exported functions | Runtime import check |
| `onOpenFile` + `OpenFileFn` | Props still present in DataProvider source | Source analysis on `data.tsx` |

---

## Plan: Remaining Work

### Phase 1 – `kilocode_change` Preservation Test (Low effort, high value)

**File:** `packages/kilo-vscode/tests/unit/kilocode-changes-preserved.test.ts`

The existing `kilo-ui-contract.test.ts` covers `DataProvider` markers, but does not verify the
other ~50 markers. A comprehensive test should scan all `kilocode_change` positions.

```ts
import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const UI_SRC = path.resolve(import.meta.dir, "../../../../packages/ui/src")

// Critical kilocode_change markers that must survive upstream merges
const CRITICAL_MARKERS = [
  { file: "context/data.tsx", contains: ["onOpenFile", "OpenFileFn"] },
  { file: "context/marked.tsx", contains: ["kilocode_change"] },
  { file: "components/message-part.tsx", contains: ["defaultOpen // kilocode_change", "classList={{ clickable"] },
]

describe("kilocode_change markers preserved in packages/ui", () => {
  it("has expected marker count (alerts on large drops)", () => {
    const count = fs.readdirSync(UI_SRC, { recursive: true })
      .filter(f => f.toString().endsWith(".tsx") || f.toString().endsWith(".ts"))
      .reduce((n, f) => {
        const src = fs.readFileSync(path.join(UI_SRC, f.toString()), "utf-8")
        return n + (src.match(/kilocode_change/g) || []).length
      }, 0)
    // Current count: 55. If this drops significantly, something got clobbered.
    expect(count).toBeGreaterThanOrEqual(50)
  })

  for (const marker of CRITICAL_MARKERS) {
    it(`${marker.file} still has critical markers`, () => {
      const src = fs.readFileSync(path.join(UI_SRC, marker.file), "utf-8")
      for (const text of marker.contains) {
        expect(src, `Missing "${text}" in ${marker.file}`).toContain(text)
      }
    })
  }
})
```

---

### Phase 2 – Storybook Snapshot Testing (Medium effort)

Add snapshot (screenshot) testing to the existing Storybook setup in `packages/kilo-ui` using
**[Chromatic](https://www.chromatic.com/)** – it integrates directly with Storybook and requires
minimal setup.

#### 2.1 – Setup Chromatic

```bash
bun add --dev chromatic -w packages/kilo-ui
```

Add to `packages/kilo-ui/package.json`:
```json
"scripts": {
  "chromatic": "chromatic --project-token=$CHROMATIC_PROJECT_TOKEN --build-script-name=build-storybook"
}
```

#### 2.2 – Add CI Job

Add to `.github/workflows/test.yml` (or a new `visual-tests.yml`):

```yaml
visual:
  name: visual regression
  runs-on: blacksmith-4vcpu-ubuntu-2404
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0  # required for Chromatic TurboSnap
    - uses: ./.github/actions/setup-bun
    - run: bun run build-storybook
      working-directory: packages/kilo-ui
    - uses: chromaui/action@latest
      with:
        projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
        workingDir: packages/kilo-ui
        buildScriptName: build-storybook
        onlyChanged: true  # TurboSnap — only test stories affected by changed files
```

**Note:** Chromatic baseline images are stored on their service (free tier available for OSS).
When upstream merges change upstream components, Chromatic surfaces the visual diff for review.

#### 2.3 – Stories to Prioritize

The following stories cover the highest-risk upstream components and must be in good shape:

| Story file | Components | Upstream risk |
|-----------|-----------|---------------|
| `message-part.stories.tsx` | `Message`, `AssistantMessageDisplay`, `UserMessageDisplay` | Very high |
| `session-turn.stories.tsx` | `SessionTurn` | High |
| `basic-tool.stories.tsx` | `BasicTool` | High (bash, default tools) |
| `markdown.stories.tsx` | `Markdown` | Medium |
| `diff.stories.tsx` | `Diff` | Medium |
| `code.stories.tsx` | `Code` | Medium |

Add kilo-specific stories for:
- `message-part.stories.tsx` – story with `onOpenFile` wired up (tests `kilocode_change` at runtime)
- New story: `vscode-tool-overrides.stories.tsx` – renders tools with kilo overrides applied
- New story: `task-tool-expanded.stories.tsx` – renders the kilo `TaskToolExpanded` component

---

### Phase 3 – Unit Tests for Webview Utilities (Low effort)

Several helper functions in the webview are untested despite having pure business logic:

#### 3.1 – `VscodeSessionTurn` helpers

[`VscodeSessionTurn.tsx`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx) contains:
- [`getDirectory(path)`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx:31) – path splitting utility
- [`getFilename(path)`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx:37) – path splitting utility
- [`unwrapError(message)`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx:43) – JSON error unwrapping logic

These are pure functions. Extract them to a util file and add unit tests.

**File:** `packages/kilo-vscode/tests/unit/session-turn-utils.test.ts`

#### 3.2 – `TaskToolExpanded` helpers

[`TaskToolExpanded.tsx`](../../webview-ui/src/components/chat/TaskToolExpanded.tsx) contains:
- `getSessionToolParts(store, sessionId)` – filters assistant message parts

Extract and test with mock store shapes.

**File:** `packages/kilo-vscode/tests/unit/task-tool-expanded-utils.test.ts`

---

### Phase 4 – Storybook-Based Rendering Tests (Medium effort)

Use **`@storybook/test`** (built into Storybook 10) to add interaction/render assertions
to stories. This is distinct from visual snapshots — it checks DOM structure.

**Example for `message-part.stories.tsx`:**
```tsx
export const WithOpenFile: Story = {
  args: { onOpenFile: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // Verify file path is rendered as clickable
    const filePath = canvas.getByText("src/counter.tsx")
    await expect(filePath).toHaveClass("clickable")
    await userEvent.click(filePath)
    await expect(args.onOpenFile).toHaveBeenCalledWith("src/counter.tsx")
  }
}
```

This verifies the `kilocode_change` that adds `classList={{ clickable }}` and `onClick` on file
paths in the `read` tool renderer actually works end-to-end.

Add these play tests to:
- `message-part.stories.tsx` – clickable file paths, tool rendering states
- `basic-tool.stories.tsx` – `defaultOpen` prop behavior

---

### Phase 5 – Upstream Merge Checklist (Process)

Until full automation is in place, create a merge checklist:

**File:** `packages/kilo-vscode/docs/testing/upstream-merge-checklist.md`

```markdown
## After every opencode upstream merge into packages/ui

- [ ] Run `bun turbo typecheck` – catch type-level breakage
- [ ] Check new/changed exports: `git diff packages/ui/package.json`
- [ ] Verify kilocode_change markers: `grep -rn "kilocode_change" packages/ui/src/`
- [ ] Run `bun test tests/unit/` from packages/kilo-vscode
- [ ] Open Storybook (`bun run storybook` in packages/kilo-ui) and spot-check:
  - message-part story (text, tool calls, file paths clickable)
  - session-turn story
  - basic-tool story (bash open by default)
- [ ] Load the extension in VS Code Extension Development Host
  - Verify chat messages render
  - Verify tool calls render
  - Verify clicking a file path opens it in editor
```

---

## Priority Order

| Priority | Action | Effort | Status |
|----------|--------|--------|--------|
| ~~🔴 P0~~ | ~~Fix `test-vscode.yml` trigger to include `packages/ui/**` and `packages/kilo-ui/**`~~ | ~~5 min~~ | ✅ Done |
| ~~🔴 P0~~ | ~~`ToolRegistry` contract test~~ | ~~1 hour~~ | ✅ Done (`kilo-ui-contract.test.ts`) |
| ~~🔴 P0~~ | ~~`DataProvider` props contract test~~ | ~~30 min~~ | ✅ Done (`kilo-ui-contract.test.ts`) |
| 🔴 P0 | `kilocode_change` preservation test | 1 hour | TODO |
| 🟠 P1 | Add Chromatic to CI | Half day | TODO |
| 🟠 P1 | Add kilo-specific Storybook stories | 1 day | TODO |
| 🟡 P2 | Extract + test webview util functions | 2 hours | TODO |
| 🟡 P2 | Storybook play tests for kilocode_changes | Half day | TODO |
| 🟢 P3 | Upstream merge checklist doc | 30 min | TODO |

---

## What Visual Regression Testing Catches

When opencode upstream changes `packages/ui`:

| Upstream change | Without visual tests | With Chromatic |
|----------------|---------------------|----------------|
| Tool renderer `data-*` attribute rename | Silent CSS breakage | Chromatic flags diff |
| Message layout restructure | Silent visual regression | Chromatic flags diff |
| CSS class rename that kilo-ui overrides depended on | Silent styling breakage | Chromatic flags diff |
| New component with unstyled default | Unstyled component in prod | Story shows new state |
| Component removed | TypeScript error (if exported types change) or silent rendering gap | Chromatic flags missing story or error |

The key insight: **CSS regressions are invisible to TypeScript**. CSS class renames from upstream
break kilo's `packages/kilo-ui` overrides silently. Only visual tests (screenshot diffing or
browser-based assertions) can catch this class of bug.
