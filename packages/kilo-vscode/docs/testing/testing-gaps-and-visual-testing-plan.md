# Testing Gaps & Visual Testing Plan

## Context

The kilo-vscode extension has a layered UI architecture:

```
packages/ui/           ← upstream opencode UI (SolidJS components, forked)
packages/kilo-ui/      ← kilo-specific UI layer (re-exports packages/ui + kilo-only CSS overrides)
packages/kilo-vscode/webview-ui/  ← extension webview (SolidJS app consuming kilo-ui)
packages/kilo-vscode/src/         ← extension host (TypeScript, VS Code API)
```

When opencode upstream merges land, `packages/ui` is the blast radius. Changes there ripple
through `packages/kilo-ui` (which re-exports everything) into the webview at runtime. No
automated tests currently catch regression in this chain.

---

## Current Test Coverage Summary

### What IS tested

| Area | Tests | Location |
|------|-------|----------|
| Extension host logic (TypeScript) | Unit tests with bun | `packages/kilo-vscode/tests/unit/` |
| Message contract (extension ↔ webview) | Static analysis tests reading source files | `tests/unit/message-contract.test.ts` |
| Worktree / git operations | Unit tests | `tests/unit/worktree-manager.test.ts` |
| Autocomplete | Unit + integration tests | `tests/unit/autocomplete-*.test.ts` |
| Web app (packages/app) | Playwright e2e | `packages/app/e2e/` |
| opencode CLI logic | bun unit tests | `packages/opencode/test/` |
| UI components (manual only) | Storybook stories | `packages/kilo-ui/src/stories/` |

### What IS NOT tested

| Area | Gap | Risk |
|------|-----|------|
| `packages/ui` component rendering | Zero automated rendering tests | **Critical** – upstream merges silently break UI |
| `packages/kilo-ui` CSS overrides | No visual/snapshot tests | CSS classes can vanish after a merge |
| Webview UI react to messages | No rendering tests for the chatview | Tool renderers, message display can break entirely |
| `ToolRegistry` registrations in `message-part.tsx` | No test that all expected tools are registered after a merge | An upstream rename/removal goes undetected |
| `getToolInfo()` return values | No contract test | Upstream may change tool output shape |
| `kilocode_change` preservations | No automated check that markers weren't reverted | Merges silently trample kilocode customizations |
| VSCode-specific overrides (`VscodeToolOverrides`) | No test that the overrides actually register | `bash` defaultOpen behavior can silently break |
| `TaskToolExpanded` component | No test | Child session rendering logic can break |
| `VscodeSessionTurn` component | No test | Core chat rendering, zero coverage |
| Theme / CSS variable integrity | No visual regression | Color and spacing regressions after merges |

---

## Testing Gaps – Details

### 1. `packages/ui` – Zero Rendering Tests

`packages/ui` has 50+ SolidJS components and a massive `message-part.tsx` (2000+ lines). The
only existing test mechanism is Storybook stories in `packages/kilo-ui/src/stories/`, which are
**manual only** — they require a human to open a browser and look.

When upstream opencode merges land, components like [`Message()`](../../../ui/src/components/message-part.tsx:480),
[`UserMessageDisplay()`](../../../ui/src/components/message-part.tsx:668),
[`AssistantMessageDisplay()`](../../../ui/src/components/message-part.tsx:506) may have their
props, data-attributes, or DOM structure changed. There is nothing to catch this.

**Key coupling points that need monitoring:**
- [`ToolRegistry`](../../../ui/src/components/message-part.tsx:911) – tool registrations could be renamed or removed
- [`getToolInfo()`](../../../ui/src/components/message-part.tsx:172) – return shape can change; `VscodeSessionTurn` depends on it
- [`PART_MAPPING`](../../../ui/src/components/message-part.tsx:113) – part renderers could change
- [`DataProvider`](../../../ui/src/context/data.tsx:55) props – the `onOpenFile` kilocode_change could be removed

### 2. `packages/kilo-ui` – CSS Overrides Untested

`packages/kilo-ui` overrides CSS for every upstream component. Examples:
- [`packages/kilo-ui/src/components/message-part.css`](../../../kilo-ui/src/components/message-part.css) – 116 lines
- [`packages/kilo-ui/src/components/markdown.css`](../../../kilo-ui/src/components/markdown.css) – custom markdown styling
- Component-specific overrides for `basic-tool`, `chat-input`, `prompt-input`, etc.

After a merge, upstream CSS can add new class names or change `data-*` attributes that
selector-based kilo overrides depended on. Nothing catches this.

### 3. `kilocode_change` Markers – No Regression Guard

There are 55 `kilocode_change` markers in `packages/ui`. Any upstream merge can silently
overwrite them. There is no test that verifies they still exist.

Key changes that must survive merges:
- [`data.tsx:55`](../../../ui/src/context/data.tsx:55) – `OpenFileFn` type (enables click-to-open in VS Code)
- [`data.tsx:67`](../../../ui/src/context/data.tsx:67) – `onOpenFile` prop on DataProvider
- [`marked.tsx:464`](../../../ui/src/context/marked.tsx:464) – custom markdown link handling
- [`message-part.tsx:1276`](../../../ui/src/components/message-part.tsx:1276) – `classList={{ clickable }}` on file paths
- [`message-part.tsx:1522`](../../../ui/src/components/message-part.tsx:1522) – `defaultOpen` on bash tool

### 4. Webview Chat Components – No Tests

`VscodeSessionTurn`, `TaskToolExpanded`, and `VscodeToolOverrides` are entirely untested.
They are VS Code-specific overrides of upstream rendering logic:

- [`VscodeSessionTurn.tsx`](../../webview-ui/src/components/chat/VscodeSessionTurn.tsx) – flat rendering (no "Gathered context" grouping)
- [`TaskToolExpanded.tsx`](../../webview-ui/src/components/chat/TaskToolExpanded.tsx) – child session tool listing
- [`VscodeToolOverrides.tsx`](../../webview-ui/src/components/chat/VscodeToolOverrides.tsx) – sets `bash` defaultOpen

### 5. Storybook Stories Exist But Are Unused in CI

`packages/kilo-ui` has 50 Storybook stories covering all UI components. They serve as a
development aid but are never built or checked in CI. There is no Chromatic, Backstop, or
snapshot pipeline.

---

## Plan: Testing Strategy

### Phase 1 – Static Contract Tests (Low effort, high value)

These are pure TypeScript/text analysis tests similar to the existing
[`message-contract.test.ts`](../../tests/unit/message-contract.test.ts).

#### 1.1 – `kilocode_change` Preservation Test

**File:** `packages/kilo-vscode/tests/unit/kilocode-changes-preserved.test.ts`

Test that all critical `kilocode_change` positions in `packages/ui` still exist after a merge.
For each tracked change, verify the marker comment is present in the source.

```ts
// Example approach:
it("onOpenFile prop is still present in DataProvider", () => {
  const src = readFileSync("packages/ui/src/context/data.tsx", "utf-8")
  expect(src).toContain("onOpenFile")
  expect(src).toContain("kilocode_change")
})
```

This is cheap to write and immediately catches merge regressions.

#### 1.2 – `ToolRegistry` Tool Name Contract Test

**File:** `packages/kilo-vscode/tests/unit/tool-registry-contract.test.ts`

The webview overrides specific tool names (`"bash"`, `"task"`) in
[`VscodeToolOverrides.tsx`](../../webview-ui/src/components/chat/VscodeToolOverrides.tsx) and
[`TaskToolExpanded.tsx`](../../webview-ui/src/components/chat/TaskToolExpanded.tsx).

Test that the tool names those files reference are still registered in upstream `message-part.tsx`.

```ts
const TOOL_NAMES_WE_DEPEND_ON = ["bash", "task", "read", "write", "glob", "edit", "todowrite"]

it("all tools overridden or used by kilo are still registered in ToolRegistry", () => {
  const src = readFileSync("packages/ui/src/components/message-part.tsx", "utf-8")
  for (const name of TOOL_NAMES_WE_DEPEND_ON) {
    expect(src, `Tool "${name}" no longer registered`).toContain(`name: "${name}"`)
  }
})
```

#### 1.3 – `getToolInfo()` Return Shape Contract

`VscodeSessionTurn` calls `getToolInfo()` from `@kilocode/kilo-ui/message-part`. Test that its
return type still has the fields the webview depends on (`icon`, `title`, `description`).

```ts
it("getToolInfo still exports expected shape fields", () => {
  const src = readFileSync("packages/ui/src/components/message-part.tsx", "utf-8")
  // ToolInfo interface must still have these fields
  expect(src).toMatch(/icon\s*:/)
  expect(src).toMatch(/title\s*:/)
})
```

#### 1.4 – `DataProvider` Props Contract Test

Verify the `onOpenFile` kilocode prop still exists in `DataProvider`:

```ts
it("DataProvider still accepts onOpenFile prop", () => {
  const src = readFileSync("packages/ui/src/context/data.tsx", "utf-8")
  expect(src).toContain("onOpenFile")
  expect(src).toContain("OpenFileFn")
})
```

---

### Phase 2 – Storybook Snapshot Testing (Medium effort)

Add snapshot (screenshot) testing to the existing Storybook setup in `packages/kilo-ui` using
**Storybook's built-in `@storybook/addon-storyshots`** approach or `storycap` + image diffing.

The recommended tool given the existing setup is **[Chromatic](https://www.chromatic.com/)** –
it integrates directly with Storybook and requires minimal setup.

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
- `getDirectory(path)` – path splitting utility
- `getFilename(path)` – path splitting utility
- `unwrapError(message)` – JSON error unwrapping logic

These are pure functions. Extract them to a util file and add unit tests.

**File:** `packages/kilo-vscode/tests/unit/session-turn-utils.test.ts`

#### 3.2 – `TaskToolExpanded` helpers

[`TaskToolExpanded.tsx`](../../webview-ui/src/components/chat/TaskToolExpanded.tsx) contains:
- `getSessionToolParts(store, sessionId)` – filters assistant message parts

Extract and test with mock store shapes.

**File:** `packages/kilo-vscode/tests/unit/task-tool-expanded-utils.test.ts`

---

### Phase 4 – Storybook-Based Rendering Tests (Medium effort)

Use **`@storybook/test`** (built into Storybook 8+, included in the current `storybook@10`) to
add interaction/render assertions to stories. This is distinct from visual snapshots — it checks
DOM structure.

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

| Priority | Action | Effort | Benefit |
|----------|--------|--------|---------|
| 🔴 P0 | `kilocode_change` preservation test | 1 hour | Immediately catches merge regressions |
| 🔴 P0 | `ToolRegistry` contract test | 1 hour | Catches tool name renames/removals |
| 🔴 P0 | `DataProvider` props contract test | 30 min | Guards `onOpenFile` kilocode_change |
| 🟠 P1 | Add Chromatic to CI | Half day | Visual diff on every upstream merge |
| 🟠 P1 | Add kilo-specific Storybook stories | 1 day | Fills coverage of kilo overrides |
| 🟡 P2 | Extract + test webview util functions | 2 hours | Prevents logic regressions |
| 🟡 P2 | Storybook play tests for kilocode_changes | Half day | Runtime verification of custom behavior |
| 🟢 P3 | Upstream merge checklist doc | 30 min | Process safety net |

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
