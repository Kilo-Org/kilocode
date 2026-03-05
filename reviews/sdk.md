# SDK Review — PR #6622 (OpenCode v1.2.16)

## Files Reviewed

| File                                      | Status   | Additions | Deletions |
| ----------------------------------------- | -------- | --------- | --------- |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts`   | modified | +664      | -33       |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | modified | +240      | -17       |
| `packages/sdk/openapi.json`               | modified | +998      | -49       |

## Summary

This change introduces **workspace** as a first-class concept in the SDK, driven by the upstream OpenCode v1.2.16 merge. The three main categories of changes are:

1. **New `Workspace` resource and `Workspace` class** — a new `experimental.workspace` namespace with `create`, `remove`, and `list` methods, plus a `Workspace` type.
2. **Universal `workspace?: string` query parameter** — added to **every** existing SDK method's parameters (60+ methods across all resource classes). This is pervasive but fully backward-compatible since the parameter is optional.
3. **New event types and type additions** — `EventWorkspaceReady`, `EventWorkspaceFailed` added to the `Event` union; `workspaceID?: string` added to `Session` and `GlobalSession`; `overflow?: boolean` added to `CompactionPart`.

Additionally, there is an **unresolved git merge conflict** in `openapi.json`.

## Detailed Findings

### `packages/sdk/js/src/v2/gen/sdk.gen.ts` (+664 / -33)

#### New class: `Workspace` (extends `HeyApiClient`)

A brand-new `Workspace` class is added under the `experimental` namespace with three methods:

- **`remove(parameters: { id: string, directory?: string, workspace?: string })`** — `DELETE /experimental/workspace/{id}`. Returns `ExperimentalWorkspaceRemoveResponses`. Has `400` error type (`BadRequestError`).
- **`create(parameters: { id: string, directory?: string, workspace?: string, branch?: string | null, config?: { directory: string, type: "worktree" } })`** — `POST /experimental/workspace/{id}`. Returns `ExperimentalWorkspaceCreateResponses`. Has `400` error type.
- **`list(parameters?: { directory?: string, workspace?: string })`** — `GET /experimental/workspace`. Returns `ExperimentalWorkspaceListResponses`.

The `Workspace` instance is exposed as a lazy getter on the `Experimental` class:

```ts
get workspace(): Workspace {
  return (this._workspace ??= new Workspace({ client: this.client }))
}
```

This means consumers access it as `client.experimental.workspace.create(...)`, `client.experimental.workspace.list()`, etc.

**Observations:**

- The `id` parameter on `create` and `remove` uses a path pattern `^wrk.*` (defined in openapi.json), meaning workspace IDs are expected to be prefixed with `wrk`.
- `branch` on `create` is `string | null` (nullable), not optional — this matches the OpenAPI `required: ["branch", "config"]` on the request body.
- The `config.type` field is a const literal `"worktree"`, suggesting workspaces currently only support worktree-based isolation.

#### Universal `workspace?: string` query parameter

Every existing method across all SDK classes now accepts an optional `workspace` query parameter. This affects:

- `Project` — `list`, `current`, `update`
- `Pty` — `list`, `create`, `remove`, `get`, `update`, `connect`
- `Config2` — `get`, `update`, `providers`
- `Tool` — `ids`, `list`
- `Worktree` — `remove`, `list`, `create`, `reset`, `diff`
- `Session` (experimental) — `list`
- `Resource` — `list`
- `Session2` — `list`, `create`, `status`, `delete`, `get`, `update`, `children`, `todo`, `init`, `fork`, `abort`, `unshare`, `share`, `diff`, `summarize`, `messages`, `prompt`, `deleteMessage`, `message`, `promptAsync`, `command`, `shell`, `revert`, `unrevert`
- `Part` — `delete`, `update`
- `Permission` — `respond`, `reply`, `list`
- `Question` — `list`, `reply`, `reject`
- `Oauth` — `authorize`, `callback`
- `Provider` — `list`, `auth`
- `Telemetry` — `capture`
- `CommitMessage` — `generate`
- `EnhancePrompt` — `enhance`
- `Organization` — `set`
- `Session3` (cloud) — `get`, `import`
- `Kilo` — `profile`, `fim`, `notifications`, `cloudSessions`
- `Find` — `text`, `files`, `symbols`
- `File` — `list`, `read`, `status`
- `Auth2` — `remove`, `start`, `callback`, `authenticate`
- `Mcp` — `status`, `add`, `connect`, `disconnect`
- `Control` — `next`, `response`
- Various TUI methods, `Instance`, `Path`, `Vcs`, `Command`, `App`, `Lsp`, `Formatter`, `EventSubscribe`

**Backward compatibility:** All `workspace` parameters are optional (`workspace?: string`). Existing callers that don't pass `workspace` will continue to work identically. No signatures changed in a breaking way — the new parameter is purely additive.

#### New type imports

Five new type imports are added at the top of the file:

- `ExperimentalWorkspaceCreateErrors`
- `ExperimentalWorkspaceCreateResponses`
- `ExperimentalWorkspaceListResponses`
- `ExperimentalWorkspaceRemoveErrors`
- `ExperimentalWorkspaceRemoveResponses`

---

### `packages/sdk/js/src/v2/gen/types.gen.ts` (+240 / -17)

#### New types

- **`Workspace`** — `{ id: string, branch: string | null, projectID: string, config: { directory: string, type: "worktree" } }`
- **`EventWorkspaceReady`** — `{ type: "workspace.ready", properties: { name: string } }`
- **`EventWorkspaceFailed`** — `{ type: "workspace.failed", properties: { message: string } }`
- **`ExperimentalWorkspaceRemoveData`**, **`ExperimentalWorkspaceRemoveErrors`**, **`ExperimentalWorkspaceRemoveResponses`**, **`ExperimentalWorkspaceRemoveResponse`**
- **`ExperimentalWorkspaceCreateData`**, **`ExperimentalWorkspaceCreateErrors`**, **`ExperimentalWorkspaceCreateResponses`**, **`ExperimentalWorkspaceCreateResponse`**
- **`ExperimentalWorkspaceListData`**, **`ExperimentalWorkspaceListResponses`**, **`ExperimentalWorkspaceListResponse`**

#### Modified types

- **`CompactionPart`** — new optional field: `overflow?: boolean`
- **`Session`** — new optional field: `workspaceID?: string`
- **`GlobalSession`** — new optional field: `workspaceID?: string`

#### `Event` union type changes

- **Added:** `EventWorkspaceReady`, `EventWorkspaceFailed` (2 new members)
- **Reordered:** `EventWorktreeReady` and `EventWorktreeFailed` moved from after `EventPtyDeleted` to before `EventPtyCreated`. This is a source-level reorder only; since TypeScript union types are unordered, this has zero runtime or type-checking impact.

#### Universal `workspace?: string` in Data types

Every `*Data` type (e.g., `ProjectListData`, `SessionCreateData`, `FileReadData`, etc.) now includes `workspace?: string` in its `query` object. This mirrors the changes in `sdk.gen.ts` and is purely additive.

**Backward compatibility:** All type changes are additive (new optional fields, new union members). No existing fields were removed, renamed, or changed from optional to required. No breaking changes.

---

### `packages/sdk/openapi.json` (+998 / -49)

#### CRITICAL: Unresolved git merge conflict

Lines 39-43 contain an unresolved merge conflict:

```json
<<<<<<< HEAD
            "source": "import { createKiloClient } from \"@kilocode/sdk\"..."
=======
            "source": "import { createKiloClient } from \"@opencode-ai/sdk..."
>>>>>>> kevinvandijk/opencode-v1.2.16
```

This is a **merge artifact that must be resolved before merging**. The correct resolution should use `@kilocode/sdk` (the Kilo-branded package name), not `@opencode-ai/sdk`.

Additionally, multiple `x-codeSamples` blocks in the new workspace endpoints reference `@opencode-ai/sdk` instead of `@kilocode/sdk`. These appear in:

- `POST /experimental/workspace/{id}` code sample
- `DELETE /experimental/workspace/{id}` code sample
- `GET /experimental/workspace` code sample

These should be corrected to `@kilocode/sdk` for consistency.

#### New endpoints

- **`POST /experimental/workspace/{id}`** — Create a workspace. Requires `id` (path, pattern `^wrk.*`), optional `directory` and `workspace` (query), body with `branch` (required, nullable) and `config` (required, `{ directory: string, type: "worktree" }`).
- **`DELETE /experimental/workspace/{id}`** — Remove a workspace. Requires `id` (path), optional `directory` and `workspace` (query). No request body.
- **`GET /experimental/workspace`** — List all workspaces. Optional `directory` and `workspace` (query).

#### New schema: `Workspace`

```json
{
  "id": "string (pattern: ^wrk.*)",
  "branch": "string | null",
  "projectID": "string",
  "config": { "directory": "string", "type": "worktree" (const) }
}
```

All four fields are required.

#### New event schemas

- `Event.workspace.ready` — `{ type: "workspace.ready", properties: { name: string } }`
- `Event.workspace.failed` — `{ type: "workspace.failed", properties: { message: string } }`

These are added to the `Event` `anyOf` union.

#### Modified schemas

- **`CompactionPart`** — added optional `overflow: boolean` (not in `required` array)
- **`Session`** — added optional `workspaceID: string` (not in `required` array)
- **`GlobalSession`** — added optional `workspaceID: string` (not in `required` array)
- **`Event` union** — reordered to put `worktree.*` and new `workspace.*` events before `pty.*` events

#### Universal `workspace` query parameter

Added to every single endpoint as an optional string query parameter. Consistent with the generated SDK changes.

---

## Risk to VS Code Extension

### Low Risk — Backward Compatibility

All changes are **additive and non-breaking**:

- The new `workspace?: string` parameter is optional everywhere. The VS Code extension currently never passes a `workspace` parameter, and all existing call sites (e.g., `client.session.create({ directory: workspaceDir })`, `client.session.list({ directory: dir, roots: true })`, `client.worktree.diff({ directory: wt.path, base: wt.parentBranch })`) will continue to work without modification.
- The new `workspaceID?: string` field on `Session` is optional. The extension accesses `session.id`, `session.slug`, `session.directory`, etc., but doesn't destructure or spread `Session` in a way that would break on an extra optional field.
- The new `overflow?: boolean` on `CompactionPart` is optional. The extension doesn't reference `CompactionPart` directly.
- The new `EventWorkspaceReady` and `EventWorkspaceFailed` event types are added to the `Event` union. The extension's `resolveEventSessionId()` in `connection-utils.ts` uses a `switch` statement with a `default: return undefined` fallback, so unknown event types are safely ignored.

### Medium Risk — Future Integration Opportunity

- The Agent Manager (`src/agent-manager/AgentManagerProvider.ts`) currently manages worktrees directly via `client.worktree.*` methods and custom session creation. The new `Workspace` abstraction may eventually replace or augment this, but the current code is unaffected.
- The extension's i18n already has `workspace.create.failed.title` strings, suggesting workspace support is planned — but the extension doesn't yet import or use `EventWorkspaceReady`, `EventWorkspaceFailed`, the `Workspace` type, or `client.experimental.workspace.*` methods.
- The `workspaceID` field on `Session` is not yet consumed by the extension. Once the extension adopts workspace-scoped sessions, it will need to pass `workspace` to relevant API calls and track `workspaceID` on sessions.

### Action Required

- **Must fix:** The unresolved merge conflict in `openapi.json` (lines 39-43) must be resolved before merge.
- **Should fix:** The `x-codeSamples` in the three new workspace endpoints reference `@opencode-ai/sdk` instead of `@kilocode/sdk`. These should be corrected for branding consistency (though they have no runtime impact since code samples are documentation-only).

## Overall Risk

**Low.** This is a clean, auto-generated SDK expansion. All changes are additive optional parameters, new optional type fields, new types/classes, and new event union members. No existing signatures were changed in a breaking way. The VS Code extension will compile and function identically without any code changes.

The only blocking issue is the **unresolved merge conflict in `openapi.json`**, which is a build/generation artifact that must be cleaned up before the PR merges.
