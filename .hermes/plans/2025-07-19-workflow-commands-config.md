# Workflow Commands Configuration — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the placeholder Workflows tab in Agent Behaviour settings with a full-featured command management UI that allows per-command model selection, reasoning toggle, and custom command creation/editing.

**Issue:** https://github.com/Kilo-Org/kilocode/issues/10211

**Architecture:** The Workflows subtab currently shows a `<Placeholder>` stub. We'll replace it with a proper command management panel that reads from and writes to the existing `config.command` field (which already supports `template`, `description`, `agent`, `model`, `subtask`). The UI will list all discovered commands (from `.kilo/workflows/`, `.kilocode/workflows/`, and `config.command` entries), allow per-command overrides (model, reasoning), and support creating/editing custom commands inline.

**Tech Stack:** SolidJS, @kilocode/kilo-ui components (Select, TextField, Card, Button, Dialog, IconButton), existing useConfig/useSession hooks.

---

## Current State Analysis

### What already exists:
1. **`Config.Command` schema** (`packages/opencode/src/config/config.ts:776-782`):
   ```ts
   export const Command = z.object({
     template: z.string(),
     description: z.string().optional(),
     agent: z.string().optional(),
     model: ModelId.optional(),
     subtask: z.boolean().optional(),
   })
   ```
2. **WorkflowsMigrator** (`packages/opencode/src/kilocode/workflows-migrator.ts`) — discovers `.md` workflow files from global and project dirs, converts them to `Config.Command` objects.
3. **Config loading** (`config.ts:264`) merges `result.command` from file discovery.
4. **AgentBehaviourTab** (`packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx`) — has the tab structure, but workflows subtab is just:
   ```tsx
   case "workflows":
     return <Placeholder text={language.t("settings.agentBehaviour.workflowsPlaceholder")} />
   ```
5. **useConfig** hook — provides `config()` (reactive) and `updateConfig(partial)`.
6. **useSession** hook — provides `session.agents()`, `session.skills()`, etc.

### What needs to be added:
1. **Reasoning field** in `Config.Command` — currently missing, needs `reasoning: z.enum(["off", "low", "medium", "high"]).optional()` or similar.
2. **Workflows subtab UI** — full implementation with:
   - List of discovered commands (from workflows + config.command)
   - Per-command settings: model override, reasoning toggle, agent assignment
   - Create new custom command
   - Edit existing command template
   - Delete custom commands
3. **i18n strings** — for all new UI labels.
4. **Server endpoint** (if needed) — to persist command config changes. But `updateConfig` already handles writing to config file.

---

## Tasks

### Task 1: Add `reasoning` field to `Config.Command` schema

**Objective:** Extend the Command schema to support per-command reasoning level, matching the issue's requirement #3.

**Files:**
- Modify: `packages/opencode/src/config/config.ts:776-782`

**Step 1: Add the reasoning field**

```ts
export const Command = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: ModelId.optional(),
  reasoning: z.enum(["off", "low", "medium", "high"]).optional(), // kilocode_change
  subtask: z.boolean().optional(),
})
```

**Step 2: Verify typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: PASS (new optional field is backwards-compatible)

**Step 3: Commit**

```bash
git add packages/opencode/src/config/config.ts
git commit -m "feat(config): add reasoning field to Command schema"
```

---

### Task 2: Extend `CommandConfig` type in webview messages

**Objective:** Add the new fields to the frontend type so the webview can read/write them.

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages.ts` (around line 351)

**Step 1: Update CommandConfig interface**

```ts
export interface CommandConfig {
  command: string
  description?: string
  agent?: string
  model?: string
  reasoning?: "off" | "low" | "medium" | "high"
  subtask?: boolean
}
```

Wait — looking at the current type, it only has `command` and `description`. We need to expand it. But the config type mapping might need to be checked — look at how config is serialized.

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/types/messages.ts
git commit -m "feat(types): extend CommandConfig with model, reasoning, agent fields"
```

---

### Task 3: Create the WorkflowsSubtab component

**Objective:** Build the full workflows subtab UI component, extracted from AgentBehaviourTab for clarity.

**Files:**
- Create: `packages/kilo-vscode/webview-ui/src/components/settings/WorkflowsSubtab.tsx`

**Design:**

```
┌─────────────────────────────────────────────┐
│ Workflows (Commands)                          │
├─────────────────────────────────────────────┤
│ [+ New Command]                               │
│                                               │
│ ┌─── local-review ──────────────────────┐    │
│ │ Template: (truncated preview...)        │    │
│ │ Model:    [anthropic/claude-so… ▼]      │    │
│ │ Agent:    [code ▼]                      │    │
│ │ Reasoning: [off ▼]                      │    │
│ │                           [Edit] [Delete]│   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ ┌─── local-review-uncommitted ──────────┐    │
│ │ ...                                     │    │
│ └─────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
```

The component will:
1. Read `config().command` to get all registered commands
2. Display each command in a Card with its settings
3. Provide model selection dropdown (reuse model list from ModelsTab)
4. Provide reasoning level dropdown (off/low/medium/high)
5. Provide agent selection dropdown
6. "New Command" button opens a dialog for creating custom commands
7. "Edit" button opens dialog for editing template/description
8. "Delete" button (only for custom commands, not file-based workflows)

**Step 1: Create the component file** (~250 lines)

Key implementation details:
- Use `config().command ?? {}` to get all commands as `Record<string, CommandConfig>`
- Use `createMemo` for derived lists
- Reuse `Select` component from `@kilocode/kilo-ui/select` for dropdowns
- Reuse `Card`, `Button`, `IconButton`, `Dialog`, `TextField` from kilo-ui
- For model selection, use the available models from `session.providers()` or the model list

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/settings/WorkflowsSubtab.tsx
git commit -m "feat(settings): create WorkflowsSubtab component with command management UI"
```

---

### Task 4: Wire WorkflowsSubtab into AgentBehaviourTab

**Objective:** Replace the `<Placeholder>` stub with the new `<WorkflowsSubtab>`.

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx` (line ~761)

**Step 1: Import and render**

```tsx
// Add import
import WorkflowsSubtab from "./WorkflowsSubtab"

// Replace in renderSubtabContent():
case "workflows":
  return <WorkflowsSubtab />
```

**Step 2: Verify it renders** — run `bun run extension` and check the Workflows tab.

**Step 3: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx
git commit -m "feat(settings): wire WorkflowsSubtab into AgentBehaviourTab"
```

---

### Task 5: Add i18n strings for workflows UI

**Objective:** Add translation keys for all new UI elements in the English locale (other locales can be added later or by translators).

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/i18n/en.ts`

**Step 1: Add new keys**

```ts
"settings.agentBehaviour.workflows.title": "Commands & Workflows",
"settings.agentBehaviour.workflows.newCommand": "New Command",
"settings.agentBehaviour.workflows.model": "Model Override",
"settings.agentBehaviour.workflows.model.description": "Model to use for this command (overrides default)",
"settings.agentBehaviour.workflows.agent": "Agent",
"settings.agentBehaviour.workflows.agent.description": "Agent mode to use for this command",
"settings.agentBehaviour.workflows.reasoning": "Reasoning",
"settings.agentBehaviour.workflows.reasoning.description": "Reasoning level for this command",
"settings.agentBehaviour.workflows.reasoning.off": "Off",
"settings.agentBehaviour.workflows.reasoning.low": "Low",
"settings.agentBehaviour.workflows.reasoning.medium": "Medium",
"settings.agentBehaviour.workflows.reasoning.high": "High",
"settings.agentBehaviour.workflows.template": "Template",
"settings.agentBehaviour.workflows.description": "Description",
"settings.agentBehaviour.workflows.delete": "Delete Command",
"settings.agentBehaviour.workflows.edit": "Edit",
"settings.agentBehaviour.workflows.noCommands": "No commands configured. Create one or add workflow files to .kilo/workflows/.",
"settings.agentBehaviour.workflows.create.title": "Create Command",
"settings.agentBehaviour.workflows.create.name": "Command Name",
"settings.agentBehaviour.workflows.create.name.placeholder": "e.g. my-review",
"settings.agentBehaviour.workflows.edit.title": "Edit Command",
"settings.agentBehaviour.workflows.confirmDelete": "Are you sure you want to delete the command \"{name}\"?",
```

**Step 2: Commit**

```bash
git add packages/kilo-vscode/webview-ui/src/i18n/en.ts
git commit -m "feat(i18n): add workflow commands UI strings"
```

---

### Task 6: Implement command CRUD operations

**Objective:** Wire up create, update, delete operations for commands through the config update mechanism.

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/WorkflowsSubtab.tsx`

**Key operations:**

1. **Create command**: `updateConfig({ command: { ...config().command, [name]: { template, description, model, reasoning } } })`
2. **Update command**: same merge approach for individual field changes
3. **Delete command**: rebuild the `command` record without the deleted key

**Step 1: Implement and test**
**Step 2: Commit**

```bash
git commit -m "feat(settings): implement command CRUD in workflows tab"
```

---

### Task 7: Verify end-to-end and clean up

**Objective:** Final verification pass.

**Step 1: Typecheck**
```bash
cd ~/Code/kilocode && bun turbo typecheck
```

**Step 2: Run extension**
```bash
bun run extension
```
- Navigate to Settings → Agent Behaviour → Workflows tab
- Verify commands list appears
- Verify model/reasoning dropdowns work
- Verify create/edit/delete operations work

**Step 3: Final commit**
```bash
git add -A
git commit -m "feat: commands configuration in workflows tab (#10211)"
```

---

## Files Touched Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/opencode/src/config/config.ts` | Modify | Add `reasoning` to Command schema |
| `packages/kilo-vscode/webview-ui/src/types/messages.ts` | Modify | Extend CommandConfig type |
| `packages/kilo-vscode/webview-ui/src/components/settings/WorkflowsSubtab.tsx` | Create | Full workflows subtab UI |
| `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx` | Modify | Wire new subtab |
| `packages/kilo-vscode/webview-ui/src/i18n/en.ts` | Modify | Add i18n strings |

## Risks & Mitigations

- **Model list**: Need to check how to get available models in the webview. The `ModelsTab` already has this — may need to pass providers data or use a shared hook.
- **Config persistence**: `updateConfig` writes to the opencode config file. Workflow files in `.kilo/workflows/` are read-only (managed by the user on disk). Only `config.command` entries can be created/deleted from the UI.
- **kilocode_change markers**: All new Kilo-specific code must NOT have `kilocode_change` markers in `packages/kilo-vscode/` or `packages/kilo-ui/` per the CI check.
