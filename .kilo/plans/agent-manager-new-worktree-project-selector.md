# Agent Manager — New Worktree Project Selector

Status: implemented 2026-08-06. The implementation is uncommitted.

This is Slice 4 item 6 ("Add project-aware New Worktree targeting") from
`agent-manager-multi-project-uniform-ui.md`, the last unimplemented item of that slice.
`agent-manager-multi-project-runtime.md:29` deferred it out of the backend-first scope.
Everything the extension side needs already exists; this is almost entirely a webview
change.

Implementation notes:

- The project catalog is passed into the dialog as an accessor so the picker reflects
  registry changes while it remains open.
- The per-project default-base resolver returns `undefined` when the project has no
  configured/local branch, allowing the backend-detected branch response to remain the
  fallback instead of being replaced by a hardcoded `main`.
- Branch, import-result, and worktree-ready messages carry `projectId` in multi-project
  mode, which makes fast project changes and cross-project creation activation safe.
- The slash-command hook accepts optional caller-owned commands; `/project` is scoped to
  this dialog and is hidden when multi-project mode is unavailable.

---

## Problem

With `kilo-code.new.experimental.multiProject` enabled, the New Worktree dialog has no
notion of which repository it targets, and the user cannot see or change it.

`Cmd+N` opens the dialog with no project at all:

```tsx
// AgentManagerApp.tsx:1870-1876
const showNewWorktreeDialog = () => {
  if (!loaded()) return
  expandSidebar()
  dialog.show(() => (
    <NewWorktreeDialog mode={mode} onClose={() => dialog.close()} defaultBaseBranch={repoDefaultBranch()} />
  ))
}
```

`projectId` is `undefined`, so every message the dialog sends omits it
(`agentManager.requestBranches` at `NewWorktreeDialog.tsx:321`,
`agentManager.createMultiVersion` at `:373`, `agentManager.importFromPR` at `:566`,
`agentManager.importFromBranch` at `:575`). The extension then silently falls back to the
active project in `messageProject()` (`AgentManagerProvider.ts:474`) before running the
message inside `ProjectScope`.

The result is correct but opaque:

- The dialog never shows which repository the worktree lands in.
- The only way to target a specific project is the per-project `+` button
  (`ProjectList.tsx:136-146`), which does pass `projectId` explicitly.
- `defaultBaseBranch` is resolved from the *active* project
  (`AgentManagerApp.tsx:261,272`), so even Advanced options' base-branch list and default
  badge are implicitly single-project.

The desired behavior, per the original request: the dialog should show the assigned
project and let the user change it. Defaulting to the last selected project is fine as a
default; it just must be visible and overridable.

---

## Design decisions

### Placement: inline with the tab switcher

The selector renders inside the New/Import pill row (`NewWorktreeDialog.tsx:620-699`),
right-aligned with a constrained width, so it is shared by both tabs without adding a
full-width form row.

```
┌─ New Worktree ──────────────────────────────┐
│  [ New ] [ Import ]       [ folder  kilocode ▾ ] │  ← inline, multiProject only
│  [ Worktree name (optional) ]                │
│  [ prompt … ]  Code ▾  GPT-5.6 ▾  None ▾     │
│  › Advanced options                          │
│  VERSIONS 1 2 3 4   ⧉ Compare Models         │
│  [        Create Worktree        ]           │
└──────────────────────────────────────────────┘
```

Rejected alternatives and why:

- **Inside Advanced options.** Wrong category. Advanced options holds refinements of a
  known target (branch name, base branch). The project *is* the target: changing it
  invalidates the branch list, base branch, default-branch badge, and setup scripts.
  Hiding it also fails the stated requirement of seeing which project is assigned.
- **A full-width row directly beneath the tabs.** It covered both tabs, but consumed
  unnecessary vertical space and made the project control look like a primary form field.
- **In the dialog title** (`New Worktree in [kilocode ▾]`). Reads nicely but requires
  widening `Dialog`'s `title` prop to accept JSX, which touches kilo-ui for one caller.

### Visibility

Render the row only when `multiProject` is true. With the flag off (the default) the
dialog stays byte-identical to today, so there is no regression surface for the
all-user path. When the flag is on but only the pinned project exists, still render it:
showing the target is informative and the requirement is explicitly about seeing the
assignment.

### Default value

`props.projectId ?? activeProjectId()`. `activeProjectId()` already exists at
`AgentManagerApp.tsx:268` (`projectList().find((p) => p.active)?.id ?? currentProjectId()`).

No new persistence. The active project is already the durable "last selected" state
(persisted per project as `activeTarget` in each repo's `.kilo/agent-manager.json`, plus
the registry's ordering). Adding a separate "last dialog project" key would create a
second source of truth that can disagree with the sidebar.

### Reuse, no new CSS

The row uses the existing `am-advanced-field` + `am-nv-config-label` +
`am-selector-wrapper` + `am-selector-trigger` markup, i.e. exactly the structure the base
branch selector already uses at `NewWorktreeDialog.tsx:813-905`, with `DeferredPopover`
(already imported) instead of `BranchSelectPopover`.

### Component extraction

`NewWorktreeDialog.tsx` is already 1136 lines. The selector and its popover list go into a
new `webview-ui/agent-manager/ProjectSelect.tsx` (roughly `BranchSelect.tsx`'s role):
presentational, takes `projects`, `value`, `onSelect`, and labels, and owns nothing but
its own list rendering. The dialog keeps only the signal, the popover trigger, and the
effects.

Note: `webview-ui/agent-manager/NewWorktreeDialog.tsx` is not under a `maxLines` cap
(`tests/unit/agent-manager-arch.test.ts` caps `src/agent-manager/*.ts` only), but the file
is on the arch test's watched list and the caps exist to discourage exactly this kind of
growth.

---

## Changes

### 1. `webview-ui/agent-manager/ProjectSelect.tsx` (new)

Presentational popover body listing projects:

- Row = project label + dimmed root path (tooltip on the full root, matching
  `ProjectsSection.tsx:60`).
- Check mark on the selected project.
- Untrusted and missing projects are disabled and carry the same affordances the accordion
  uses: `lock` icon + trust hint, `warning` icon + missing hint
  (`ProjectsSection.tsx:67-75`). Selecting them is not possible; trust happens in the
  sidebar, not in this dialog. Keeps the dialog free of trust-flow branching.
- There is intentionally no Add project action in this picker. Project registration and
  trust management stay in the Agent Manager Projects toolbar.

### 2. `webview-ui/agent-manager/NewWorktreeDialog.tsx`

Props change:

```ts
export const NewWorktreeDialog: Component<{
  onClose: () => void
  projectId?: string            // now: initial value, not fixed target
  projects?: AgentProjectSnapshot[]     // omitted / empty => single-project, row hidden
  activeProjectId?: string
  defaultBase?: (projectId: string) => string   // replaces defaultBaseBranch?: string
  mode: ModeRouter
}>
```

`defaultBaseBranch?: string` must become a per-project lookup because each project has its
own configured default and its own local branch. `ProjectList.tsx:142` already computes
that expression (`state?.defaultBaseBranch ?? props.local[projectId]?.branch`); hoist it
into the callback so both call sites share it.

New state and derived values:

```ts
const [project, setProject] = createSignal(props.projectId ?? props.activeProjectId)
const [projectOpen, setProjectOpen] = createSignal(false)
const selectable = () => (props.projects ?? []).filter((p) => p.trusted && !p.missing)
const showProject = () => (props.projects?.length ?? 0) > 0
```

Every outbound message switches from `props.projectId` to `project()`:
`:321` `requestBranches`, `:373` `createMultiVersion`, `:566` `importFromPR`,
`:575` `importFromBranch`.

Reload branch data on project change, replacing the one-shot `onMount` request at `:319-321`:

```ts
createEffect(
  on(project, (id) => {
    setBranches([])
    setBranchSearch("")
    setHighlightedIndex(0)
    setBaseBranch(null)                       // custom base is project-specific
    setDefaultBranch(props.defaultBase?.(id) ?? "main")
    setBranchesLoading(true)
    vscode.postMessage({ type: "agentManager.requestBranches", projectId: id })
  }),
)
```

Drop stale branch replies in the `agentManager.branches` handler (`:520-525`).
`AgentManagerBranchesMessage` **already declares an optional `projectId`**
(`extension-messages.ts:939-945`, `src/agent-manager/types.ts:293-298`); the field is
simply never populated or read today. Without this guard, switching projects twice quickly
can race a wrong branch list into the base-branch popover:

```ts
if (ev.projectId && ev.projectId !== project()) return
```

Also replace the `if (!props.defaultBaseBranch) setDefaultBranch(ev.defaultBranch)` guard
at `:523` — with a per-project lookup, the guard must consult
`props.defaultBase?.(project())` instead of a fixed prop.

Preserved across a project change (all project-agnostic): prompt text and its
`advancedDialogPrompt` persistence, images, name, agent, model, variant, versions, compare
allocations, sandbox override.

Keyboard: add `project` to `WORKTREE_PROMPT_COMMANDS` so `/project` opens the popover,
consistent with mode/model/variant/sandbox already being reachable from the dialog's slash
menu (`:302-314`). Hide it from the list when `showProject()` is false, using the same
`hidden` set mechanism already used for `agents` / `variant` / `sandbox`.

### 3. `webview-ui/agent-manager/AgentManagerApp.tsx`

`showNewWorktreeDialog` (`:1870-1876`) passes the catalog and a per-project default
resolver instead of a single branch string:

```tsx
<NewWorktreeDialog
  mode={mode}
  onClose={() => dialog.close()}
  projects={multiProject() ? projectList() : undefined}
  activeProjectId={activeProjectId()}
  defaultBase={defaultBase}
/>
```

where `defaultBase(id)` reads `registry.ensure(id).defaultBaseBranch() ?? registry.ensure(id).localStats()?.branch ?? repoDetectedBranch() ?? "main"`.
`registry.ensure` and both store fields already exist
(`project/registry.ts:39`, `project/store.ts:62,67,113,123`).

### 4. `webview-ui/agent-manager/ProjectList.tsx`

`newWorktree(projectId)` (`:136-146`) passes the same `projects` / `activeProjectId` /
`defaultBase` props with `projectId` as the initial value, so the per-project `+` button
opens the dialog pre-scoped but still switchable. Its current inline
`state?.defaultBaseBranch ?? props.local[projectId]?.branch` expression is replaced by the
shared resolver passed down from `AgentManagerApp`.

### 5. `src/agent-manager/worktree-importer.ts`

Stamp `projectId` on all three `agentManager.branches` posts (`:27`, `:48`, `:54`). The
field is already in the type; the value is available from the ambient `ProjectScope`
context the message runs in (`AgentManagerProvider.ts:479`). Without this the stale-reply
guard in the webview is inert.

### 6. Activate the created worktree when the project differs

Creating in a non-active project currently leaves the sidebar where it is:
`createMultiVersion` never activates (no activation call in `provider-multi-version.ts`),
and the new worktree just appears in that project's accordion. That is right for the
per-project `+` button, but for `Cmd+N` where the user deliberately switched projects,
landing in the new worktree is what the flow implies.

Post an `agentManager.activateSelection` for the first created worktree when the chosen
project differs from the active one. `activateSelection` already handles readiness, trust,
and stale-target fallback (`project/messages.ts:76-99`), so this is one message, not new
machinery. Hook it to the existing `agentManager.worktreeSetup` / `multiVersionProgress`
handling in `AgentManagerApp.tsx:1453-1471`, which already carries `projectId`.

### 7. i18n

New keys in `webview-ui/agent-manager/i18n/en.ts` (near the existing
`agentManager.dialog.*` block at `:130`):

- `agentManager.dialog.project.select` — "Select project"
- `agentManager.dialog.project.untrusted` — "Trust this project in the sidebar first"
- `agentManager.dialog.project.missing` — "Repository not found"

Then translate the four keys into the other 20 locale files in that directory via the
`translator` subagent.

---

## Implementation order

1. `ProjectSelect.tsx` with the presentational list, plus i18n keys in `en.ts`.
2. Dialog: `project` signal, prop rename to `defaultBase`, route all four outbound
   messages through `project()`, render the row behind `showProject()`.
3. Dialog: `createEffect(on(project, …))` branch reload, base-branch reset, stale-reply
   guard.
4. Call-site updates in `AgentManagerApp.tsx` and `ProjectList.tsx`, shared `defaultBase`
   resolver.
5. `projectId` stamp in `worktree-importer.ts`.
6. `/project` slash command.
7. Post-create activation when the target project differs.
8. Locale fan-out.
9. Changeset (`minor`, user-facing): worktree creation targets an explicit project.

---

## Tests

Existing source-text unit tests already assert against this dialog and will need to stay
green: `tests/unit/new-worktree-dialog-sandbox.test.ts`,
`tests/unit/prompt-input-bidirectional.test.ts`, and the dialog entry in
`tests/unit/agent-manager-arch.test.ts`.

New coverage:

- The dialog posts `createMultiVersion` / `requestBranches` / `importFromBranch` /
  `importFromPR` with the *selected* project id, not the prop, after a project change.
- A `agentManager.branches` reply carrying a non-current `projectId` does not mutate the
  branch list (the race guard).
- Changing project clears `baseBranch` and re-derives `defaultBranch` from `defaultBase`.
- Prompt text survives a project change (no accidental reset through the shared
  `advancedDialogPrompt` cache).
- The row does not render when `projects` is empty, so the single-project dialog is
  unchanged.
- Untrusted and missing projects are not selectable.

Checks to run before declaring done, from `packages/kilo-vscode/`:
`bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run knip`.

---

## Manual verification

In the isolated harness (`bun run extension:isolated`) with
`kilo-code.new.experimental.multiProject` enabled and two repositories registered:

1. `Cmd+N` from project A shows "Project: A". Switch to B, create, and confirm the
   worktree lands in B's accordion and the sidebar activates it.
2. Switch project with Advanced options open and confirm the base-branch list and default
   badge follow the new project rather than showing A's branches.
3. Switch project rapidly back and forth and confirm the branch list matches the selected
   project (the race guard).
4. Type a prompt, switch project, confirm the prompt is retained.
5. Use the Import tab after switching project and confirm branches and PR import target
   the selected repository.
6. Turn the flag off and confirm the dialog is visually identical to today.

---

## Out of scope

- Trusting or removing a project from inside the dialog. Trust stays in the sidebar; the
  dialog only disables untrusted entries.
- Any change to how the active project is persisted.
- The quick-create path (`Cmd+Shift+N` → `agentManager.createWorktree`,
  `AgentManagerApp.tsx:1863-1867`). It has no dialog, so it keeps targeting the active
  project. Worth revisiting only if the explicit-target rule should apply there too.
- Per-project setup-script or agent selection in the dialog.

## Risks

- **Stale branch data** is the only real correctness risk, and it is why the `projectId`
  stamp plus the reply guard are mandatory rather than optional polish.
- **Prop signature change** (`defaultBaseBranch: string` → `defaultBase: (id) => string`)
  touches both call sites; a partial migration would silently show one project's default
  branch while creating in another.
- **Dialog file growth**; mitigated by extracting `ProjectSelect.tsx`.

---

# Appendix: exact UI and styling specification

Everything below is copy-paste ready. Class names, tokens, and icon names are all verified
against the current tree. Do not invent new tokens or new class names beyond the ones
listed here.

## A. Visual layout

```
┌─ New Worktree ─────────────────────────────────────────── X ─┐
│                                                              │
│  [ New ][ Import ]       [ 📁 kilocode             ⌃⌄ ]      │
│           └────────────────────────────────────────────┘     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Worktree name (optional)                             │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ prompt …                                             │    │
│  │  Code ▾   OpenAI / GPT-5.6 ▾   None ▾        ✨ 🔒 🎤 │    │
│  └──────────────────────────────────────────────────────┘    │
│  › Advanced options                                          │
│  VERSIONS [1][2][3][4]  [⧉ Compare Models]                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                   Create Worktree                    │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Open dropdown (anchored under the trigger, same width as the trigger):

```
           ┌────────────────────────────────────────────┐
           │ 📁 kilocode      ~/Documents/git/kilocode ✓│  ← .am-project-option-active
           │ 📁 cloud         ~/Documents/git/cloud     │
           │ 🔒 sample-app    ~/dev/sample-app          │  ← disabled, 50% opacity
           │ ⚠ old-repo       ~/dev/old-repo            │  ← disabled, 50% opacity
           └────────────────────────────────────────────┘
```

Rules:

- The selector is inline with the New/Import buttons inside the tab-switcher flex row, so
  it applies to New and Import alike.
- The project name and folder icon identify the scope without a separate visible label.
- The trigger is the same control as the Advanced options base-branch trigger
  (`.am-selector-trigger`), so the dialog has one visual language for "pick a thing".
- The row is **not rendered at all** when `props.projects` is empty or undefined. That is
  the single-project / flag-off case, which must stay pixel-identical to today.

## B. Exact icon names

Only these, from `packages/ui/src/components/icon.tsx`:

| Where | `Icon name` | Notes |
|---|---|---|
| Trigger left | `folder` | Always, regardless of project state. |
| Trigger right | `selector` | Same as every other `.am-selector-trigger`. |
| Option row, normal | `folder` | |
| Option row, untrusted | `lock` | Matches the sidebar accordion affordance. |
| Option row, missing | `warning` | Matches the sidebar accordion affordance. |
| Option row, selected | `check-small` | Right-aligned. |

All at `size="small"`. Do not use `folder-add-left`, `check`, or `plus`.

## C. New file: `webview-ui/agent-manager/ProjectSelect.tsx`

```tsx
// Project picker list for the New Worktree dialog

/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { AgentProjectSnapshot } from "../src/types/messages"

interface ProjectSelectProps {
  projects: AgentProjectSnapshot[]
  selected?: string
  onSelect: (id: string) => void
  labels: { untrusted: string; missing: string }
}

export const ProjectSelect: Component<ProjectSelectProps> = (props) => (
  <div class="am-dropdown-list">
    <For each={props.projects}>
      {(project) => {
        const blocked = () => !project.trusted || project.missing
        const hint = () => {
          if (project.missing) return props.labels.missing
          if (!project.trusted) return props.labels.untrusted
          return project.root
        }
        const icon = () => {
          if (project.missing) return "warning" as const
          if (!project.trusted) return "lock" as const
          return "folder" as const
        }
        return (
          <button
            class="am-project-option"
            classList={{ "am-project-option-active": props.selected === project.id }}
            disabled={blocked()}
            title={hint()}
            onClick={() => props.onSelect(project.id)}
            type="button"
          >
            <span class="am-project-option-left">
              <Icon name={icon()} size="small" />
              <span class="am-project-option-name">{project.label}</span>
              <span class="am-project-option-root">{project.root}</span>
            </span>
            <Show when={props.selected === project.id}>
              <Icon name="check-small" size="small" />
            </Show>
          </button>
        )
      }}
    </For>
  </div>
)
```

Notes for the implementer:

- Wrap in `.am-dropdown-list`, not a bare fragment: that class supplies the scroll cap and
  4px padding, and `.am-dropdown [data-slot="popover-body"]` zeroes the popover padding.
- No search input. A project list is short; adding one would need keyboard nav plumbing for
  no benefit.
- `props.labels` is passed in rather than calling `useLanguage()` here, matching how
  `BranchSelect` and `SidebarSearchMenu` take label props.

## D. Exact JSX inserted into `NewWorktreeDialog.tsx`

### D.1 Imports

Add to the existing type import block at lines 6-12:

```ts
  AgentProjectSnapshot,
```

Add after line 48 (`import { BranchSelect, BranchSelectPopover } …`):

```ts
import { ProjectSelect } from "./ProjectSelect"
```

`Icon`, `Show`, `DeferredPopover`, `createSignal`, `createEffect` are already imported.
`on` from `solid-js` must be added to the line 5 import list.

### D.2 Props

Replace the component signature at lines 84-89 with:

```tsx
export const NewWorktreeDialog: Component<{
  onClose: () => void
  /** Resolves the default base branch for one project. */
  defaultBase?: (projectId: string) => string | undefined
  /** Initial target project. The user can change it while the dialog is open. */
  projectId?: string
  /** Full project catalog. Empty or undefined hides the project row entirely. */
  projects?: () => AgentProjectSnapshot[]
  /** Project the sidebar currently has active; used as the default target. */
  activeProjectId?: string
  mode: ModeRouter
}> = (props) => {
```

### D.3 State

Immediately after line 101 (`const [tab, setTab] = createSignal<DialogTab>("new")`):

```tsx
const [project, setProject] = createSignal(props.projectId ?? props.activeProjectId)
const [projectOpen, setProjectOpen] = createSignal(false)
const projects = () => props.projects?.() ?? []
const showProject = () => projects().length > 0
const projectLabel = () => projects().find((p) => p.id === project())?.label ?? ""
```

`defaultBranch` (line 106) changes from `props.defaultBaseBranch ?? "main"` to:

```tsx
const [defaultBranch, setDefaultBranch] = createSignal(
  (project() && props.defaultBase?.(project()!)) || "main",
)
```

### D.4 The inline selector

Insert inside the tab switcher after the Import button:

```tsx
{/* Project scope — applies to both tabs. Hidden unless multi-project is on. */}
<Show when={showProject()}>
  <div class="am-nv-project-inline">
    <div class="am-selector-wrapper">
      <DeferredPopover
        open={projectOpen()}
        onOpenChange={setProjectOpen}
        placement="bottom-start"
        flip={false}
        sameWidth
        portal={false}
        deferDismiss
        class="am-dropdown"
        trigger={
          <button class="am-selector-trigger" type="button" disabled={starting() || isPending()}>
            <span class="am-selector-left">
              <Icon name="folder" size="small" />
              <Show
                when={projectLabel()}
                fallback={
                  <span class="am-selector-value am-selector-placeholder">
                    {t("agentManager.dialog.project.select")}
                  </span>
                }
              >
                <span class="am-selector-value">{projectLabel()}</span>
              </Show>
            </span>
            <span class="am-selector-right">
              <Icon name="selector" size="small" />
            </span>
          </button>
        }
      >
        <ProjectSelect
          projects={projects()}
          selected={project()}
          onSelect={(id) => {
            track("project_select", { changed: id !== props.activeProjectId })
            setProject(id)
            setProjectOpen(false)
          }}
           labels={{
             untrusted: t("agentManager.dialog.project.untrusted"),
            missing: t("agentManager.dialog.project.missing"),
          }}
        />
      </DeferredPopover>
    </div>
  </div>
</Show>
```

Critical details, in order of how easily they get wrong:

1. `placement="bottom-start"`, **not** `top-start`. The rest of this dialog uses
   `top-start` because those triggers sit near the bottom of the panel. This one sits at
   the top, so it must open downward.
2. `portal={false}` plus the escape CSS in section E.3. Do not switch to a portal unless
   the clipping fallback in E.3 is needed.
3. `sameWidth` so the dropdown matches the trigger width, consistent with the base-branch
   and compare-models popovers.
4. Never send the project label, root, or id as a telemetry property. `track` takes only
   the boolean shown above.

### D.5 Reactive reload on project change

Delete the one-shot request at lines 319-321 inside `onMount` and replace it with an effect
placed next to the other `createEffect` calls:

```tsx
// Project scope owns the branch data, the base branch, and the default badge.
// Prompt, name, model, agent, versions and attachments are project-agnostic and survive.
createEffect(
  on(project, (id) => {
    if (!id) return
    setBranches([])
    setBranchSearch("")
    setHighlightedIndex(0)
    setBaseBranch(null)
    setDefaultBranch(props.defaultBase?.(id) ?? "main")
    setBranchesLoading(true)
    vscode.postMessage({ type: "agentManager.requestBranches", projectId: id })
  }),
)
```

`on(project, …)` without `{ defer: true }` runs immediately, which replaces the removed
`onMount` request. Keep the textarea focus logic in `onMount` untouched.

In the `agentManager.branches` handler (lines 520-525), replace the body with:

```tsx
if (msg.type === "agentManager.branches") {
  const ev = msg as AgentManagerBranchesMessage
  if (ev.projectId && ev.projectId !== project()) return
  setBranches(ev.branches)
  const id = project()
  if (!id || !props.defaultBase?.(id)) setDefaultBranch(ev.defaultBranch)
  setBranchesLoading(false)
}
```

### D.6 Outbound project id

Four call sites change from `props.projectId` to `project()`:

| Line | Message |
|---|---|
| 321 (now inside the effect) | `agentManager.requestBranches` |
| 373 | `agentManager.createMultiVersion` |
| 566 | `agentManager.importFromPR` |
| 575 | `agentManager.importFromBranch` |

Grep afterwards: `props.projectId` must appear exactly once in the file, in the `project`
signal initializer.

## E. Exact CSS

All of it goes into `webview-ui/agent-manager/agent-manager.css`. No changes to kilo-ui.

### E.1 The inline selector

Insert directly after the `.am-tab-switcher-pill-active` rule (agent-manager.css:3614-3617),
before the `/* Import tab layout */` comment at line 3619:

```css
/* Project scope selector — inline with the New/Import tabs */

.am-nv-project-inline {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  flex: 0 1 260px;
  min-width: 0;
  margin-left: auto;
}

.am-nv-project-inline .am-selector-wrapper {
  width: 100%;
  min-width: 0;
}
```

The `flex: 0 1 260px` cap keeps the project control compact while allowing long project
names to truncate. `margin-left: auto` keeps it aligned to the right of the New/Import
buttons.

### E.2 The dropdown rows

Insert after the `.am-dropdown-empty` rule (agent-manager.css:3863-3868), before the
`/* Import empty state */` comment at line 3870:

```css
/* Project option rows in the New Worktree project dropdown.
   Deliberately distinct from .am-project-item, which styles the sidebar accordion. */

.am-project-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-base);
  font-size: var(--font-size-base);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.am-project-option:hover:not(:disabled) {
  background: var(--surface-inset-base-hover);
}

.am-project-option-active {
  background: var(--surface-inset-base);
}

.am-project-option:disabled {
  opacity: 0.5;
  cursor: default;
}

.am-project-option-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.am-project-option-left [data-component="icon"] {
  color: var(--text-weaker);
  flex-shrink: 0;
}

.am-project-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 45%;
}

.am-project-option-root {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-size: var(--kilo-font-size-11);
  color: var(--text-weaker);
}

```

Why not reuse `.am-branch-item`: it is defined twice (lines 3211 and 3810) and the earlier
definition sets `font-family: var(--font-mono, monospace)` on `.am-branch-item-name`, which
would render project labels in monospace. Reusing it also couples project rows to future
branch-row changes. `.am-project-item` is likewise off limits: it already styles the
sidebar project accordion header (line 325).

### E.3 Popover clipping escape

`[data-slot="dialog-body"]` is `overflow: hidden` in `packages/ui/src/components/dialog.css:99-105`,
and `[data-slot="dialog-content"]` is `overflow: auto` (line 38). The existing escape rules
at agent-manager.css:2822-2828 only match popovers **inside** `.am-nv-dialog`, and this row
is deliberately outside it. Without the following, the dropdown is clipped by the dialog.

Add to that same rule group (extend the existing selector list rather than duplicating the
declaration):

```css
[data-component="dialog"]:has(.am-nv-project-inline [data-component="popover-content"]) [data-slot="dialog-content"],
[data-component="dialog"]:has(.am-nv-project-inline [data-component="popover-content"]) [data-slot="dialog-body"] {
  overflow: visible;
}
```

Verification step, not optional: open the dropdown with four or more projects registered
and confirm no row is cut off and no inner scrollbar appears on the dialog. If it still
clips, the documented fallback is to drop `portal={false}` from the `DeferredPopover` in
D.4 and delete this rule; the dialog already sets `overflow: visible` on
`[data-slot="dialog-content"]` for portal-based dropdowns (agent-manager.css:2755-2760).

## F. i18n

Add to `webview-ui/agent-manager/i18n/en.ts`, immediately after
`"agentManager.dialog.namePlaceholder"`:

```ts
"agentManager.dialog.project.select": "Select project",
"agentManager.dialog.project.untrusted": "Trust this project in the sidebar first",
"agentManager.dialog.project.missing": "Repository not found",
```

Then add the same three keys to all 20 sibling locale files in that directory (`ar bs br da
de es fa fr it ja ko nl no pl ru th tr uk zh zht`) via the `translator` subagent.

## G. What must not change

- No new CSS variables or tokens. Only the ones listed above, all already in use in this
  file.
- No edits to `packages/kilo-ui/` or `packages/ui/`.
- No change to `.am-project-item`, `.am-branch-item`, `.am-selector-trigger`,
  `.am-nv-config-label`, or any other existing rule. The only existing rule touched is the
  `overflow: visible` selector group in E.3, and only by adding selectors to it.
- No new message types. `agentManager.requestBranches`, `agentManager.createMultiVersion`,
  `agentManager.importFromBranch`, and `agentManager.importFromPR` all already exist and
  already accept what is needed.
- With `props.projects` empty, the rendered dialog markup must be identical to before the
  change. Verify by toggling `kilo-code.new.experimental.multiProject` off.
