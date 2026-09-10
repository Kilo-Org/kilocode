# Simplify the Diff Comment Implementation

## Goal

Reduce the diff size and structural complexity of the PR comment work without changing behavior. Optimize for reviewability and for keeping shared existing files close to their original shape.

## Current Size

| Area | Added |
|---|---|
| Existing tracked files | ~1124 insertions, 101 deletions across 18 files |
| New source modules | `pr-diff.ts`, `annotation-lifecycle.ts`, `diff-comment-forms.tsx`, `diff-comment-state.ts` (~285 lines) |
| New tests | 5 unit/fixture files |
| Untracked scratch | `.kilo/plans/diff-viewer-github-comment-creation.md` (remove from the shipped diff) |

The largest existing-file growth is `review-annotations.ts` (+310), `PRCommentForm.tsx` (+245), and `DiffViewerApp.tsx` (+165).

## Principles

- One owner for PR snapshot state and comment form creation. No parallel implementations.
- Production always mounts `PRCommentForm`. Do not keep imperative fallbacks that only tests use.
- Prefer collapsing props into one object over adding a prop per field.
- Keep keyboard, focus, and safety behavior exactly as tested.
- Do not edit shared upstream opencode files. This package is Kilo-owned.

## Proposals

### 1. Create comment forms inside `createReviewView` (high impact, medium risk)

`createDiffCommentForms` is instantiated in three places: `DiffPanel.tsx`, `FullScreenDiffView.tsx`, and `DiffViewerApp.tsx`. Two of them then pass it back into `createReviewView` through `localForm`/`remote`/`remoteAccessor` plus a `ReviewViewOverrides` layer.

Change:

- Create the forms once in `createReviewView` from `diffs`, `worktreeId`, and a single PR context.
- Delete the `createDiffCommentForms` blocks in `DiffPanel` and `FullScreenDiffView`.
- Remove `ReviewViewOverrides`, `ReviewViewProps.remote`, `ReviewViewProps.localForm`, and `ReviewViewProps.remoteAccessor`.
- `DiffViewerApp` keeps computing PR diffs and the snapshot for PR mode, but stops creating forms.

Estimated: −60 to −80 lines and one less indirection layer.

### 2. Collapse the four PR props into one `pr` context (high impact, low risk)

`prTarget`, `prSnapshot`, `prLoading`, and `prError` are threaded `AgentManagerApp` → `DiffPanelCache` → `DiffPanel`, plus three of them through `FullScreenDiffView`.

Change:

- Introduce `pr?: { target: PRTarget; snapshot?: PRDiffSnapshot; loading?: boolean; error?: string }`.
- Pass one prop per layer. `DiffPanelCache` drops four prop definitions and four call-sites to one.

Estimated: −15 to −20 lines and a smaller public surface.

### 3. Delete the unused non-mounted remote fallback (high impact, low risk)

Production always supplies `remote.mount`. `remote.submit`, `publish()`, `githubSubmitButton`, the non-mounted `hint`, and the `remoteMounted` branches in `update()` exist only for tests.

Change:

- Make `mount` required in `RemoteCommentConfig`.
- Delete `submit`, `publish()`, `githubSubmitButton`, the non-mounted hint, and the `handlers.remote && !handlers.localMount` branch.
- Update `tests/unit/review-annotations.test.ts` to always pass a mount.

Estimated: −60 to −80 lines in `review-annotations.ts`.

### 4. Evaluate removing `annotation-lifecycle.ts` (medium impact, needs a check first)

This module (32 lines + tests + `track` plumbing) exists because Pierre may replace annotation DOM without invoking button handlers.

Change:

- Add a focused test that rebuilds the same open draft twice and checks whether the mounted root is disposed.
- If Pierre reuses the wrapper for an open draft, dispose only on draft change, cancel, and complete (already partly handled in `review-controller.ts`), and delete the module plus the `track` handler.
- If Pierre does detach, keep it but reuse the existing mounted-registry pattern from `remote-comment-renderer.tsx` instead of adding a second `MutationObserver` implementation.

Estimated: −40 to −60 lines if removable.

### 5. Collapse the new `PRCommentForm` props into one variant (medium impact, low risk)

`submitOnEnter`, `onEscape`, `replaceBody`, and `inline` are four new props that are always set together by the diff composers.

Change:

- Replace with `variant?: "inline"`.
- `inline` implies submit-on-Enter, Escape-to-cancel, and body replacement on destination switch.
- Move the render-time `untrack` patch to a mount effect so it does not write during component creation.

Estimated: −15 to −25 lines and a clearer API.

### 6. Deduplicate PR context label CSS and strings (small, low risk)

Three near-identical rules for the same label: `.diff-pr-context` in `banners.css`, `.am-diff-pr-context` and `.am-review-pr-context` in `agent-manager.css`, including duplicated `svg` rules.

Change:

- Use `.diff-pr-context` in all three components and delete the other two rule sets.
- Reuse existing i18n keys where semantics match and drop duplicates such as `diffViewer.comment.postToGithub` if an equivalent `agentManager.pr.*` key exists.

Estimated: −20 CSS lines, −3 to −4 i18n keys.

### 7. Small host-side cleanup (small, low risk)

- `PRReviewActions.handle()` calls `checkBranch` and then `load()` calls it again. Keep one check per action.
- Reuse an existing git helper in `DiffViewerProvider` instead of the inline `execWithShellEnv` closure if one fits.

Estimated: −5 lines and one fewer `git rev-parse` per load.

### 8. Optional: use GitHub `additions`/`deletions` (neutral)

`review-actions.parse()` already reads `additions`/`deletions` but drops them, so `pr-diff.ts` re-counts patch lines. Adding the two fields to `PRFile` and using them removes the `counts()` helper.

Estimated: roughly neutral diff, one fewer parser.

## Recommended Order

| Order | Item | Why |
|---|---|---|
| 1 | 3, delete fallback | Largest reduction, no behavior risk |
| 2 | 5, one form variant | Unblocks reading the rest of `PRCommentForm` |
| 3 | 1 + 2, single form owner and `pr` object | Biggest structural win |
| 4 | 6 + 7, small dedupe | Cheap cleanup |
| 5 | 4, lifecycle decision | Needs a test first, keep if unproven |
| 6 | 8, optional | Neutral, do only if touching `parse()` anyway |

## Verification

- Keep the focused suites green: `inline-comment-form`, `review-annotations`, `annotation-lifecycle` (or its replacement), `pr-diff`, `pr-review-actions`, `pr-review-render`, `diff-comment-*`, `remote-comments`, `agent-manager-arch`.
- Re-run `bun run compile`, `bun run lint`, `bun run knip`, and `bun run check-kilocode-change`.
- Re-run the isolated VS Code checks for focus, Enter, Shift+Enter, Escape, preview, destination switch, local save, and GitHub post on the disposable test repo only.

## Non-Goals

- No behavior changes to keyboard, focus, or publication safety.
- No new features or UX changes beyond what is already merged in this branch.
- No changes to `packages/opencode/` or other shared upstream files.
