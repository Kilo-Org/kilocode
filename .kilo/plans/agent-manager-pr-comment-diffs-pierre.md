# Plan: Pierre-backed Agent Manager PR comment diffs

## Problem

The Agent Manager PR panel renders each GitHub review comment's `diffHunk` as
plain text in `webview-ui/agent-manager/pr/PRComments.tsx`. The implementation
classifies lines with CSS classes and does not use syntax highlighting, Pierre's
line layout, real line anchors, or the diff theme used by the Agent Manager
review surfaces.

The side diff panel and full-screen review already render source diffs through
`@kilocode/kilo-ui/diff`, which is Kilo's Pierre-backed wrapper. Their local
review annotations also use Pierre's `DiffLineAnnotation` API. The PR comment
path currently has no reusable boundary with that implementation.

GitHub's `diffHunk` is only a hunk body beginning with `@@`. A direct call to
Pierre accepts the input but produces no usable hunk metadata. It must first be
wrapped in synthetic `---` and `+++` file headers so Pierre preserves the real
source line numbers.

## Goals

- Render PR comment hunks through the same `@kilocode/kilo-ui/diff` and Pierre
  path used by the Agent Manager side and full-screen diff viewers.
- Share the hunk normalization and code-diff rendering boundary instead of
  maintaining a second line renderer in the PR panel.
- Preserve real GitHub line ranges, additions/deletions, syntax highlighting,
  Kilo diff colors, and dark/light/high-contrast behavior.
- Make remote comments available as read-only annotations inside the existing
  Agent Manager diff views when their file and line can be matched safely.
- Keep unmatched, outdated, file-level, and otherwise unanchorable comments
  visible in the PR comment list rather than attaching them to the wrong line.
- Keep locally authored review comments and remote GitHub comments as separate
  data and state models.
- Preserve the current resolve/unresolve actions and polling behavior.

## Non-goals

- Do not replace the existing local review comment composer or its send-to-chat
  flow.
- Do not make the local diff viewer a complete replacement for GitHub's PR
  diff. The first inline phase only annotates the currently loaded worktree
  diff when the mapping is reliable.
- Do not add a second diff engine or manually duplicate Pierre's styles.
- Do not silently map an outdated GitHub comment to a nearby local line.
- Do not fetch the complete remote PR file diff in the first phase. Add that as
  a separate source only if inline comments must work when the worktree differs
  from the PR head.

## Current architecture

- `src/agent-manager/PRStatusPoller.ts:478-533` fetches the first comment in
  each GitHub review thread, including `path`, `line`, and `diffHunk`.
- `src/agent-manager/pr/am-pr-utils.ts:69-89` maps the GraphQL response into
  `PRComment`.
- `webview-ui/agent-manager/pr/PRComments.tsx:11-29` renders `diffHunk` with
  `DiffHunk`, a hand-written line classifier.
- `webview-ui/agent-manager/pr/pr-panel.css:287-320` owns the plain-text hunk
  styles that should be removed after the migration.
- `webview-ui/agent-manager/DiffPanel.tsx:726-755` renders code files through
  `@kilocode/kilo-ui/diff` and already passes hunk-bounded `patch` data.
- `webview-ui/diff-viewer/FullScreenDiffView.tsx:800-829` renders the same
  Pierre-backed code path for the full-screen review.
- `webview-ui/diff-viewer/review-annotations.ts` builds local review
  annotations and imperative annotation DOM for Pierre.
- `packages/kilo-ui/src/components/session-diff.ts` already preserves hunk
  header line numbers when normalizing partial patches.
- `AgentManagerApp.tsx:2635-2683` owns the side panel and
  `AgentManagerApp.tsx:2731-2759` owns the full-screen review. It already has
  the active PR and the local `reviewDiffs()` in the same component, so remote
  comments can be passed separately to both diff surfaces.

## Target design

### 1. Normalize remote hunk patches once

Extend the Kilo hunk normalization helper adjacent to
`packages/kilo-ui/src/components/session-diff.ts` with a small patch preparation
function. The helper should:

- Accept a relative file path and a GitHub `diffHunk`.
- Preserve a complete patch unchanged if the input already has file headers.
- Add `--- a/<file>` and `+++ b/<file>` headers to a hunk-only payload.
- Preserve `@@` ranges, context, additions, deletions, and no-newline markers.
- Return a normalized `ViewDiff` or `FileDiffMetadata` suitable for the
  existing `@kilocode/kilo-ui/diff` wrapper.
- Return an explicit invalid result for empty or malformed hunks.
- Avoid reconstructing full source files. The result must remain hunk-bounded.

Add focused tests for a hunk-only payload, a complete patch, a hunk starting at
a non-trivial line number, paths containing spaces, and malformed input. The
test must assert that Pierre reports the original hunk start rather than line 1.

### 2. Extract a shared Pierre code-diff fragment

Add a small webview component under `webview-ui/diff-viewer/`, for example
`PierreDiffFragment.tsx`. It should own the common code-only invocation of
`@kilocode/kilo-ui/diff`:

- `before` and `after` file contents or hunk-derived fallback contents.
- hunk-bounded `patch` data.
- `diffStyle`.
- stable `sizeKey` when the fragment is inside a virtualized file row.
- optional Pierre annotations and annotation renderer.
- optional gutter and line-number handlers.
- `virtualized={false}` only for the small, hunk-bounded PR fragment.

Migrate the code branch in `DiffPanel.tsx` and
`FullScreenDiffView.tsx` to this fragment. Keep Markdown and image rendering
outside it. Do not eagerly call `processFile` for normal full-file rows; pass
the patch through the existing deferred `Diff` path so rapid session switching
and fast review scrolling retain their current performance characteristics.

Use the fragment from a new `PRCommentDiff.tsx` component. That component
should:

- Normalize the comment hunk with the shared helper.
- Render a unified, compact, read-only Pierre diff.
- Avoid local review gutters, draft composers, and send-to-chat actions.
- Render nothing when the hunk cannot be normalized, allowing the comment card
  to remain useful without an empty diff box.

This makes the PR card and regular Agent Manager diffs share the actual Kilo
Pierre wrapper, patch handling, theme behavior, and future fixes without
forcing PR-specific data into the local worktree diff type.

### 3. Replace the PR card hunk renderer

Update `webview-ui/agent-manager/pr/PRComments.tsx`:

- Remove `DiffHunk` and its `Index` import.
- Render `PRCommentDiff` above the comment header when `diffHunk` and `file`
  are available.
- Keep the author, file/line label, Markdown body, copy action, resolved state,
  and resolve/unresolve action unchanged.
- Keep the existing resolve result listener, but extract any reusable
  worktree/thread action state if the inline annotation also needs it.

Delete the old `.am-pr-diff-line*` and `.am-pr-diff-hunk` rules from
`pr-panel.css`. Retain only a compact wrapper rule for spacing, width, and
height if Pierre's existing diff styles do not cover those layout concerns.

### 4. Extend the remote PR comment data contract

Add the GitHub fields needed for safe line anchoring to both the extension-side
and webview-side PR comment mirrors:

- `side`, mapped to `additions` for GitHub `RIGHT` and `deletions` for
  GitHub `LEFT`.
- `startLine` and `startSide` for multi-line comments when available.
- `originalLine` and `originalSide` or an equivalent `outdated` marker when
  GitHub reports that the current line is unavailable.

Update `GhComment`, the GraphQL query, `parseComments`, and the corresponding
unit fixtures. Keep `line` optional. A missing line, missing path, unknown
side, or outdated comment must be treated as unanchorable, not as an addition
on line 1.

Update the PR status change signature in `PRStatusPoller` to include a stable
remote-comment signature such as comment/thread ID, path, current line, side,
resolved state, and hunk. This ensures changed comment content or anchors are
forwarded even when total and unresolved counts remain unchanged.

### 5. Add read-only remote annotations to the existing diff viewers

Create a pure helper under `webview-ui/diff-viewer/` that converts remote PR
comments into `DiffLineAnnotation` values for one `WorktreeFileDiff`:

- Match the relative file path exactly after the same path normalization used
  by the worktree diff.
- Require a current `line` and a known `side`.
- Verify that the target line is represented by the loaded hunk-bounded patch.
- Preserve the comment/thread ID in metadata for stable annotation identity.
- Support a multi-line range in metadata even if Pierre anchors the annotation
  at the comment's ending line.
- Exclude comments that cannot be mapped. They remain available in the PR list.

Keep this annotation list separate from `reviewComments()` and the local
`AnnotationMeta` composer state. The combined Pierre annotation input may use a
small discriminated union, but local CRUD handlers must never receive a remote
comment.

Add a read-only remote annotation renderer that shares the existing PR comment
body/action primitives where practical:

- Show author, location, resolved state, and Markdown body.
- Provide the existing resolve/unresolve action through the same
  `worktreeId` and `threadId` message contract.
- Provide an external GitHub link when `url` exists.
- Do not show edit, delete, local send-to-chat, or draft controls.
- Use the existing Agent Manager annotation surface and design tokens rather
  than introducing a second comment card style.

Pass `remoteComments={activePR()?.pr.comments?.comments ?? []}` separately to
`DiffPanel` and `FullScreenDiffView` from `AgentManagerApp.tsx`. Keep remote
annotations disabled for a scope that is not the selected PR worktree or when
the local diff cannot be proven compatible.

### 6. Preserve a useful PR list and provide navigation

The PR comment list remains the source of truth for comments that are not
inline-capable. It should also remain available for users who prefer the PR
overview.

Add an optional `onShowInDiff` callback to the PR comment card. When an inline
capable comment is activated, switch to the relevant diff surface, open the
file, and scroll to the annotation. Use a focus request keyed by comment ID
and file/line rather than a one-off DOM query so virtualized rows can mount
before scrolling.

The first implementation may keep the comment visible in both the PR list and
the diff annotation. Do not remove it from the list until navigation and the
unmatched fallback are verified. Avoid duplicate resolve requests when the
same thread is displayed in both places.

### 7. Keep the remote source boundary explicit

The current `reviewDiffs()` is a local/worktree diff and can include edits that
are not on GitHub. Inline display must therefore be conservative:

- Use inline annotations only when the selected worktree and diff scope are the
  active PR context.
- Require the target file and line/side to exist in the current patch.
- If PR head metadata is added to the status contract, compare it with the
  selected worktree HEAD before enabling inline annotations.
- Fall back to the Pierre-rendered PR hunk card for stale, unmatched, or
  incomplete comments.

If a later requirement is to show every PR comment against GitHub's exact PR
head regardless of local worktree state, add a separate remote PR diff source
using the GitHub file patch API. Do not approximate that behavior by anchoring
against unrelated local changes.

## Ordered implementation slices

### Slice A: shared Pierre hunk rendering

1. Add the hunk-only patch normalizer and unit tests near
   `packages/kilo-ui/src/components/session-diff.ts`.
2. Add `PierreDiffFragment` and `PRCommentDiff` under
   `packages/kilo-vscode/webview-ui/diff-viewer/`.
3. Migrate the code branches in `DiffPanel.tsx` and
   `FullScreenDiffView.tsx` to the shared fragment without changing behavior.
4. Replace `DiffHunk` in `PRComments.tsx` and remove the obsolete line CSS.
5. Add a PR panel Storybook story containing added, deleted, modified, and
   malformed/missing-hunk comments.

### Slice B: remote comment contract and fallback-safe mapping

1. Extend GitHub query fields and host/webview PR comment types.
2. Add side/range/outdated parsing and tests.
3. Add the PR status comment signature so comment updates are not lost.
4. Add pure remote annotation eligibility and mapping helpers with tests.

### Slice C: inline remote comments

1. Add remote annotation metadata and the read-only renderer.
2. Add separate `remoteComments` props to `DiffPanel` and
   `FullScreenDiffView`.
3. Combine local and remote annotations without changing local comment CRUD.
4. Add focus/navigation from a PR comment to the matching diff line.
5. Keep unanchorable comments in the PR list and show a Pierre hunk there.

### Slice D: verification and release metadata

1. Run focused unit tests, typecheck, lint, and the Agent Manager architecture
   checks after each slice.
2. Run the extension build/compile check after the shared webview component is
   wired into both entry points.
3. Add one patch changeset describing that Agent Manager PR review comments use
   the Pierre diff renderer and can appear inline in matching diffs.
4. Perform the manual scenarios below and capture a visual regression story if
   the repository's existing visual test setup covers PR panels.

## Tests

Add or update these focused tests:

- `packages/kilo-ui/src/components/session-diff.test.ts`: GitHub hunk header
  preparation, real line anchors, malformed input, and no-newline handling.
- `packages/kilo-vscode/tests/unit/am-pr-utils.test.ts`: GraphQL side/range
  parsing, missing line/path behavior, and preservation of `diffHunk`.
- `packages/kilo-vscode/tests/unit/pr-comment-diff.test.ts`: normalized
  comment fragments use a file header, keep additions/deletions, and reject
  invalid hunks.
- `packages/kilo-vscode/tests/unit/pr-comment-annotations.test.ts` or
  `review-comments.test.ts`: exact path matching, RIGHT/LEFT side mapping,
  partial patch line eligibility, multi-line metadata, duplicate lines, and
  unmatched fallback behavior.
- `packages/kilo-vscode/tests/unit/agent-manager-pr-status.test.ts` or the
  existing poller tests: same counts with changed hunk/body still emit a new
  PR status, while identical comment signatures remain deduplicated.
- Existing diff viewer tests: local annotations, deferred patch rendering,
  scroll preservation, and rapid session switching remain unchanged.

Run from `packages/kilo-vscode/`:

```sh
bun test tests/unit/am-pr-utils.test.ts tests/unit/review-comments.test.ts tests/unit/pr-comment-diff.test.ts
bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change
bun run compile
```

Run the relevant `packages/kilo-ui` session-diff test from that package as well.
No SDK regeneration or source-link extraction should be needed unless the
implementation adds a new user-facing URL or changes a backend endpoint.

## Manual validation

1. Open an Agent Manager worktree with a PR containing a comment whose hunk
   starts far from line 1. Verify the PR card shows Pierre syntax highlighting,
   correct additions/deletions, and the original line numbers.
2. Test added, deleted, modified, empty, malformed, and no-newline hunks in
   dark, light, and high-contrast themes. Missing or malformed hunks must not
   leave a broken empty diff surface.
3. Open the Agent Manager side diff and full-screen review for the same
   worktree. Verify local comments still compose, edit, delete, and send to
   chat exactly as before.
4. Verify a current GitHub comment with a matching file, side, and line appears
   inline in both diff surfaces, and that its resolve/unresolve action updates
   both the inline annotation and PR card after polling.
5. Click a mapped PR comment and verify the correct file row opens and the
   viewport reaches the comment line even when file rows are virtualized.
6. Test an outdated comment, a file-level comment, a missing-side comment, a
   comment outside the local patch, and a worktree with extra uncommitted edits.
   Verify none is attached to a wrong line and each remains visible in the PR
   comment list with its Pierre hunk when available.
7. Switch worktrees rapidly and scroll quickly through a large review. Verify
   remote annotation updates do not cause full-file eager parsing or persistent
   scroll jumps.

## Acceptance criteria

- No PR comment hunk uses the old `.am-pr-diff-line*` renderer.
- PR comment hunks and normal Agent Manager code diffs use the same
  `@kilocode/kilo-ui/diff` Pierre-backed component and theme path.
- Shared code owns patch preparation and the common code-diff invocation.
- Remote comments are never mixed into local review comment persistence or
  send-to-chat payloads.
- Inline annotations appear only for verified file/line/side matches.
- Every comment remains discoverable in the PR panel, including comments that
  cannot be placed inline.
- Local diff rendering performance safeguards and existing review behavior stay
  intact.
