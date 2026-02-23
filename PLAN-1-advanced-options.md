# Plan 1: Advanced Options for New Session (Base Branch + Branch Name)

## Summary

Rename "Create new worktree" to "Advanced" (or similar), and replace the current single-option worktree selector with a collapsible "Advanced options" section in the `NewSessionView`. When expanded, the user can:

1. **Configure a branch name** (or leave it auto-generated)
2. **Select a base branch** to create the worktree from (defaults to the repo's default branch)

This matches the UX shown in Screenshot 2 ("New" tab with Advanced options expanded).

---

## Current State

- **`NewSessionView`** (`packages/app/src/components/session/session-new-view.tsx`) — A simple informational display showing project root, current branch, and last modified time. The worktree selector is a basic option cycle: `["main", ...sandboxes, "create"]`.
- **`submit.ts`** (`packages/app/src/components/prompt-input/submit.ts`) — On prompt submit, if worktree selection is `"create"`, calls `client.worktree.create({ directory })` which auto-generates a random name and branches from the current HEAD.
- **`Worktree.create`** (`packages/opencode/src/worktree/index.ts`) — Server-side function that accepts an optional `name` and `startCommand`. It always creates a branch `opencode/{name}` from the current HEAD — there is no `baseBranch` parameter.
- **Worktree HTTP route** (`packages/opencode/src/server/routes/experimental.ts:89-113`) — The Hono route handler for `POST /experimental/worktree`. It validates the request body against `Worktree.create.schema` and delegates to `Worktree.create()`. The frontend calls this via the SDK's `client.worktree.create()` method. Currently only accepts `{ name?, startCommand? }` — no base branch support.

---

## Implementation Plan

### 1. Backend: Add `baseBranch` to Worktree.create

**File:** `packages/opencode/src/worktree/index.ts`

- Add `baseBranch` (optional string) to `CreateInput` schema
- In `Worktree.create()`:
  - If `baseBranch` is provided, validate it exists: `git show-ref --verify refs/heads/{baseBranch}` or `git rev-parse --verify {baseBranch}` (support both local and remote refs like `origin/feature-x`)
  - If `baseBranch` is a remote ref (e.g. `origin/feature`), fetch it first: `git fetch origin feature`
  - Change the `git worktree add` command to: `git worktree add --no-checkout -b opencode/{name} {directory} {baseBranch}`
  - The existing `git reset --hard` will then populate from the base branch

**Edge cases:**

- Invalid/nonexistent base branch → throw `CreateFailedError` with clear message
- Base branch is already checked out in another worktree → git will error; catch and surface as `CreateFailedError("Branch X is already checked out in worktree at Y")`
- Remote-only branch → accept `origin/branchname` format, or just `branchname` and try remote lookup

### 2. Backend: Add `branches` endpoint

**File:** `packages/opencode/src/server/routes/experimental.ts` (new endpoint)

Add `GET /experimental/branches` that returns the list of branches available in the repo:

```ts
// Response: Array of { name: string, isLocal: boolean, isRemote: boolean, lastCommitDate: number, isDefault: boolean }
```

Implementation:

- Run `git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:unix)' refs/heads/ refs/remotes/origin/`
- Parse output to build branch list
- Detect default branch via `git symbolic-ref refs/remotes/origin/HEAD` (or fallback to main/master)
- Merge local + remote entries, dedup by name (strip `origin/` prefix from remote refs)
- Sort: default branch first, then by commit date descending

### 3. SDK Regeneration

After adding the new endpoint and modifying the schema, run `./script/generate.ts` from root to regenerate `packages/sdk/js/`.

### 4. Frontend: Redesign NewSessionView

**File:** `packages/app/src/components/session/session-new-view.tsx`

Replace the current static display with:

#### 4a. Feature name input

- Add a text input at the top: "Feature name (press Enter to create)"
- This replaces the prompt-driven implicit creation — or keep it as the existing flow but add a visible input for optional naming
- On Enter: trigger the same submit flow but with the name pre-filled

#### 4b. Collapsible "Advanced options"

- Use the existing `Collapsible` component from `@opencode-ai/ui/collapsible`
- Default state: collapsed
- Trigger text: "Advanced options" with a chevron icon

#### 4c. Branch name field (inside Advanced)

- `TextField` component with placeholder "auto-generated"
- Label: "Branch name" with an "Edit prefix" link on the right (future: could link to settings)
- When empty: worktree creation uses auto-generated name (current behavior)
- When filled: passes as `name` to `Worktree.create`
- Auto-slug the input (lowercase, hyphens, strip special chars)

#### 4d. Base branch selector (inside Advanced)

- Use the `Select` or `Popover` + `List` component pattern
- Label: "Base branch"
- Shows currently selected branch with branch icon
- Default branch gets a `Tag` badge saying "default"
- Remote-only branches get a `Tag` badge saying "remote"
- Show relative commit time on each branch item
- Searchable via `List` component's built-in search
- Default selection: repo's default branch (from the new branches endpoint)

### 5. Frontend: State Management

**File:** `packages/app/src/pages/session.tsx`

Extend the `store` to include:

```ts
const [store, setStore] = createStore({
  // existing...
  newSessionWorktree: "main",
  // new fields:
  newSessionBranchName: "", // custom branch name (empty = auto)
  newSessionBaseBranch: null as string | null, // null = use default
  showAdvanced: false,
})
```

### 6. Frontend: Submit Flow Update

**File:** `packages/app/src/components/prompt-input/submit.ts`

When creating a new worktree (worktreeSelection === "create"):

- Pass the branch name and base branch to the API:
  ```ts
  const createdWorktree = await client.worktree.create({
    directory: projectDirectory,
    worktreeCreateInput: {
      name: branchName || undefined,
      baseBranch: baseBranch || undefined,
    },
  })
  ```

### 7. Frontend: Fetch branches data

**File:** `packages/app/src/context/global-sync/` or inline in the component

- Create a fetcher (or use `createResource`) for the branches endpoint
- Cache the result while the NewSessionView is mounted
- Pass to the base branch selector

### 8. i18n Strings

**File:** `packages/app/src/i18n/en.ts`

Add:

```ts
"session.new.advancedOptions": "Advanced options",
"session.new.branchName": "Branch name",
"session.new.branchName.placeholder": "auto-generated",
"session.new.branchName.editPrefix": "Edit prefix",
"session.new.baseBranch": "Base branch",
"session.new.baseBranch.default": "default",
"session.new.baseBranch.remote": "remote",
"session.new.featureName": "Feature name",
"session.new.featureName.placeholder": "Feature name (press Enter to create)",
"session.new.createWorkspace": "Create Workspace",
```

---

## Edge Cases to Handle

| Case                                           | Handling                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Branch name already exists                     | `Worktree.create` already retries with random suffix (26 attempts)                |
| Base branch doesn't exist                      | Backend validates and returns `CreateFailedError`                                 |
| Base branch is checked out in another worktree | git errors; surface as user-friendly message                                      |
| Remote-only branch selected as base            | Accept `origin/X` format; the `git worktree add ... origin/X` works               |
| Empty branch name                              | Use auto-generated (current behavior, no change needed)                           |
| Branch name with special chars                 | Slug/sanitize on frontend before sending                                          |
| No git repo (non-git project)                  | Worktree creation already throws `NotGitError`; Advanced options should be hidden |
| No remote configured                           | Branch list shows only local branches; no "remote" badges                         |
| Slow branch fetch (large repo)                 | Show loading spinner in the branch selector                                       |
| User opens Advanced then collapses             | Preserve state in the `store` so reopening retains selections                     |

---

## File Changes Summary

| File                                                       | Change                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/opencode/src/worktree/index.ts`                  | Add `baseBranch` to `CreateInput`; use it in `git worktree add` |
| `packages/opencode/src/server/routes/experimental.ts`      | Add `GET /experimental/branches` endpoint                       |
| `packages/app/src/components/session/session-new-view.tsx` | Major redesign: add Collapsible, TextField, branch selector     |
| `packages/app/src/pages/session.tsx`                       | Extend store with new state fields                              |
| `packages/app/src/components/prompt-input/submit.ts`       | Pass branchName + baseBranch to worktree create                 |
| `packages/app/src/i18n/en.ts`                              | Add new i18n strings                                            |
| `packages/sdk/js/`                                         | Regenerate after API changes                                    |
