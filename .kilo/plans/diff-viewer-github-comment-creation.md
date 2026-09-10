# Create GitHub Comments From the Diff Viewer

## Goal

After checking out another person's PR in the current worktree, let the user select a line in the diff viewer and post a new inline comment to that PR. Keep local comments for agent feedback clearly separate from comments published to GitHub.

This is an implementation plan only. It does not authorize checkout operations or posting comments during planning.

## Existing Foundation

Source inspection shows that Agent Manager's PR Files view already creates GitHub inline comments, including multiline comments. The standalone Changes viewer loads GitHub threads and supports replies and other existing thread actions, but does not route new-comment creation. This work is primarily an integration and UX change, not a new GitHub API feature.

All paths below are relative to `packages/kilo-vscode/`.

| Area | Existing Implementation |
|---|---|
| Changes viewer and local comments | `webview-ui/diff-viewer/DiffViewerApp.tsx`, `review-controller.ts`, `review-annotations.ts` |
| Changes host and thread actions | `src/diff/DiffViewerProvider.ts`, `src/diff/comment-actions.ts` |
| GitHub thread rendering and safe display mapping | `webview-ui/diff-viewer/remote-comments.ts`, `remote-comment-renderer.tsx` |
| Snapshot-backed PR diff and composer | `webview-ui/agent-manager/pr/PRFiles.tsx`, `PRCommentForm.tsx` |
| Shared creation and snapshot contracts | `src/shared/pr-comment-actions.ts`, `src/shared/pr-patch.ts` |
| Validated GitHub writes | `src/agent-manager/pr/review-actions.ts` (`PRReviewActions`) |
| Existing host integration example | `src/agent-manager/pr-status-bridge.ts` |
| Worktree-scoped PR discovery | `src/diff/pr-poller.ts`, `src/agent-manager/PRStatusPoller.ts` |

Reuse `loadPRFiles`, `createReviewComment`, `PRDiffSnapshot`, and `PRCommentForm` with `action="line"`. The existing write handler validates the patch and fresh base/head revisions before posting through `gh`. No CLI endpoint, SDK regeneration, or new authentication system should be needed.

## Recommended UX

Use one inline composer with an explicit destination, not a global setting that silently changes what the existing comment action does.

| Element | Local Comment | GitHub Comment |
|---|---|---|
| Destination label | `Local` | `GitHub` |
| Helper text | `Saved locally. Not posted to GitHub. Send to the agent when ready.` | `Posts immediately to owner/repo#123. Visible to people with access to this PR.` |
| Submit action | `Save local comment` | `Post to GitHub` |
| Saved appearance | Local badge and existing edit/remove actions | GitHub badge, author, timestamp, and link |
| Agent submission | Included in the existing local-comment flow | Not included automatically |
| Publication | Never automatic | Only after the user selects the GitHub destination and posts |

- Keep the existing gutter action. Open the composer with `Local` selected by default, including on PR branches.
- Show the `Local | GitHub` destination control inside the composer. Do not persist a GitHub default across composers, sessions, or worktrees in the first version.
- Show a compact PR context label in the viewer header, for example `GitHub: owner/repo#123`, with an open-in-browser action.
- Show the target PR and authenticated GitHub account before publication. Use the same account and authentication path as existing replies.
- When GitHub commenting is unavailable, explain why beside the disabled destination. Keep local commenting available.
- In a local diff, show `Open PR changes to comment on GitHub` rather than pretending local coordinates are publishable. Switch to the snapshot-backed PR source and require a new line selection. Direct posting from arbitrary local diffs is deferred.
- Switching the destination preserves the typed text but does not save or publish it. Once saved or posted, a comment's destination does not change.
- Label existing GitHub reply buttons `Reply on GitHub` so replies and new comments share the same publication model.
- Keep local counts and the action to send comments to the agent separate from GitHub thread counts. Do not let a generic `Send comments` action publish GitHub drafts.
- Use text labels and existing icons, not color alone. Preserve the current visual style, keyboard flow, and narrow-panel layout.

### Example Composer

```text
src/example.ts:42
[ Local ] [ GitHub ]

GitHub: owner/repo#123  |  Posting as @reviewer
Posts immediately. Visible to people with access to this PR.

[ Comment text                                      ]

[ Cancel ]                          [ Post to GitHub ]
```

## First-Version Scope

- Create one published inline PR comment at a time, using the existing GitHub thread display and reply flow afterward.
- Support additions, deletions, valid context lines, and same-side multiline ranges through the existing PR patch validator. Reject cross-side or invalid hunk selections.
- Support PRs from forks, not only branches in the base repository.
- Work in the current worktree. The user checks out the PR through existing tools; a new checkout UI is not required.
- Keep local comments and GitHub composer drafts in separate state. Unposted GitHub text must never enter the local agent-feedback payload.
- Retain failed drafts while the viewer stays open, including across diff refreshes. Warn before an explicit action discards text. Cross-restart draft persistence is not required for this version.

Out of scope: pending GitHub reviews, batch submission, approve/request-changes actions, editing/deleting published comments, thread resolution, automatic conversion of local comments, file-level comments, and comments on arbitrary uncommitted lines.

Existing edit/delete/resolve actions remain unchanged; they are not new work in this plan. Preserve the current GitHub.com-only write support. GitHub Enterprise support and detached-HEAD PR discovery are separate follow-ups.

## Correct PR and Line Targeting

The main correctness requirement is that the displayed source and line match the PR snapshot sent to GitHub. A local branch diff is not automatically the GitHub PR diff.

1. Resolve the checked-out PR using the existing worktree-scoped GitHub integration. Capture the host, base repository, PR number and URL, base/head SHAs, and state. Use the base repository for API writes, including fork PRs.
2. Reuse the current discovery order: bare `gh pr view`, branch lookup, then an exact local-HEAD SHA match. Preserve host-side branch and panel-generation checks. If discovery is ambiguous or unsupported, disable publication with a clear reason rather than introducing a PR picker in this first version.
3. Provide a clearly labeled `PR changes` source in the existing viewer using the existing `PRFiles` snapshot loader and GitHub patches. Do not use a worktree creation base or working-copy contents. Prefer a small extraction of shared rendering where needed over copying PR Files into a second implementation.
4. Bind the displayed patch and composer to a host-owned snapshot identity. Keep PR review content separate from uncommitted changes, so a dirty worktree does not invalidate a correctly loaded PR snapshot. Never reset, stash, or overwrite local files to enable commenting.
5. Validate the path, side, and line against a complete PR patch. Use `LEFT` for deleted lines and `RIGHT` for added lines. Map context lines to verified coordinates. Do not guess when a patch is truncated, a file is binary, or a rename cannot be mapped reliably.
6. Before publication, verify that the PR context and base/head revisions still match the snapshot. If they changed, preserve the text, refresh the diff, and require the user to select a valid line again. Do not silently retarget a draft.
7. GitHub can still change between validation and publication. Send the captured commit SHA, handle API rejection, and keep any successfully published comment attached to its actual commit, even if it becomes outdated immediately afterward.

Keep draft identity scoped to the worktree, PR, snapshot, path, side, and line. Ignore responses for a different viewer context; do not attach old drafts or responses to a newly checked-out PR.

## GitHub Write Contract

Reuse the extension's existing `gh` execution and authentication path. Do not introduce a token store or send credentials to the webview.

Use the review-comment endpoint, not a PR timeline comment:

```text
POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
```

Single-line request body:

```json
{
  "body": "The user's comment",
  "commit_id": "<captured PR head SHA>",
  "path": "src/example.ts",
  "line": 42,
  "side": "RIGHT"
}
```

- Use `line` and `side`, not the deprecated `position` field. Reuse the existing multiline support, which also sends `start_line` and `start_side`.
- Resolve the repository and commit from host-owned context. Validate all webview input, including nonempty text, integer line numbers, allowed sides, and membership in the loaded patch.
- Pass JSON safely through the existing process helper, with no shell interpolation of comment text.
- Correlate requests and results with a request ID. Disable repeat submission while the request is pending.
- On success, clear only the submitted draft and refresh the existing thread list. If thread refresh fails, report that publication succeeded and offer refresh, not another post.
- On authentication, permission, rate-limit, or invalid-line errors, retain the draft and show a specific next action. A network timeout can mean the write succeeded: show `Publication status unknown`, reload comments to check, and do not automatically retry the POST.
- Reuse existing logging conventions without recording comment bodies or credentials.

## Implementation Steps

### 1. Connect the Existing Host Actions

- Extend the standalone diff integration to route `loadPRFiles` and `createReviewComment` to `PRReviewActions`, following `pr-status-bridge.ts`.
- Supply the host-owned directory, validated PR context, result callback, and poll-refresh callback. Preserve the panel instance/open-generation/branch/PR target checks in `comment-actions.ts`.
- New-thread creation must work when a PR has zero existing threads. Do not apply the existing-thread membership requirement to creation.
- Enable only the required operations. Do not expose review submission or suggestion application as a side effect.

### 2. Add the PR Diff Source

- Add `PR changes` to the Changes viewer's source controls when a supported PR is detected.
- Reuse `PRFiles.tsx` and its snapshot-backed selection behavior. Adapt or extract only the shared pieces needed to fit the existing viewer layout and local-comment annotations.
- Keep the current local source and its comparison-base controls unchanged. Label the immutable PR source so it is not confused with working-copy changes.
- Preserve existing snapshot limits: complete patches only, at most 3,000 files, 4 MiB of snapshot data, and bounded retained snapshots. Surface unsupported files and expired snapshots as unavailable targets.
- Do not use `remote-comments.ts` as an inverse line mapper. Its safe display checks do not prove that a local selection is publishable.

### 3. Make the Destination Explicit

- Add the destination control and exact-action button labels to the inline composer. Reuse `PRCommentForm action="line"` for the GitHub path rather than duplicating its pending, error, and correlation behavior.
- Keep the existing local `ReviewComment[]` format and agent submission route unchanged. Local records do not retain range endpoints, so never reconstruct a GitHub range from a saved local comment's selected text.
- Preserve range endpoints in the remote draft and bind it to the snapshot. Keep local and GitHub annotations distinct when both are displayed at the same line.
- Review current source/context-switch clearing behavior. Retain remote drafts during refresh, and warn before explicit navigation discards them. Never transfer a draft silently to another snapshot.
- Add localized copy, accessible destination labels, and existing-theme styling. Update any shared composer callers so Agent Manager PR Files keeps working.

### 4. Verify and Release

- Extend the focused tests below rather than duplicating existing patch-validation coverage.
- Run the extension checks and isolated VS Code flow before considering the implementation complete.
- Add one patch changeset for the extension, for example: `Post GitHub PR comments from the Changes viewer with explicit local and GitHub destinations.` No changeset is needed for this plan-only change.

## Verification Plan

### Focused Automated Coverage

| Existing Test | Add or Verify |
|---|---|
| `tests/unit/diff-comment-actions.test.ts` | New-operation routing, zero-thread creation, branch and panel checks, result correlation, refresh |
| `tests/unit/diff-comment-target.test.ts` | Stale generations, wrong worktrees, historical contexts without live write targets |
| `tests/unit/pr-review-actions.test.ts` | Reuse payload/range/revision coverage; add only missing adapter-specific and uncertain-write cases |
| `tests/unit/pr-review-render.test.ts` | Reused PR Files/form behavior remains intact |
| `tests/unit/diff-comment-render.test.ts` | Explicit destinations, correct action labels, pending/error state, drafts, no accidental agent submission |
| `tests/unit/remote-comments.test.ts` | New threads integrate with existing rendering without weakening anchor validation |
| `tests/unit/pr-comment-context.test.ts` | Dirty worktree, different HEAD/index, renames, missing objects, snapshot-pinned content |

Use real temporary Git repositories and existing implementation tests where possible. Use controlled GitHub boundary fixtures only where network writes or failure injection require them.

From `packages/kilo-vscode/`, run the affected tests with `bun test tests/unit/<file>.test.ts`, then `bun run typecheck`, `bun run lint`, `bun run compile`, `bun run knip`, and `bun run check-kilocode-change`. Run the broader `bun run test:unit` suite before release. If implementation adds or changes source URLs, run the repository's source-link extraction guard.

### Isolated UI Verification

Load `self-testing` and `vscode-self-test` and use the isolated VS Code harness with a disposable fixture workspace. Do not use Storybook as a substitute or real credentials in the automated harness.

1. Open Changes for a fixture PR with zero threads, select `PR changes`, create a GitHub comment, and verify the correct request, success state, thread display, and reply action through a controlled GitHub boundary.
2. Create a local comment on the same file. Verify the badge, local-only count, and agent submission route. Confirm that no GitHub write occurs.
3. Check additions, deletions, multiline ranges, renames, unsupported patches, a fork PR, and dirty/unpushed local changes.
4. Change the PR revisions or worktree while a form or request is active. Verify safe blocking, retained text, and no result appearing in the wrong context.
5. Exercise permission failure, authentication failure, timeout, double-click submission, and successful publication followed by failed refresh.
6. Inspect screenshots for keyboard access, narrow width, readable destination labels, and mixed local/GitHub threads. Check that Agent Manager's existing PR Files flow has no regression.

Separately, an authorized human smoke test on a disposable GitHub PR should confirm that a new comment appears on the correct line under the expected account, including a fork PR. Do not post to production discussions as an automated test. Report fixture-only verification as such if this live check is unavailable.

## Delivery Size

This is a medium-sized integration with an existing API foundation. Most work is in composing the two diff/comment UIs, preserving draft state, and keeping write targets safe. A new API client is unnecessary.

Prefer two focused implementation increments if needed: first connect the existing snapshot-backed PR view and creation handler to Changes; then add the explicit destination UX and regression coverage. Both are required for the user-facing feature to be complete. Avoid expanding the work into arbitrary local-to-PR line translation or a full review workflow.

## Acceptance Criteria

1. A user can check out another person's PR, open its diff, select an added or deleted line, choose `GitHub`, and post a new thread visible at the same location on GitHub.
2. The target repository, PR number, account, and immediate publication behavior are clear before posting.
3. Saving local comments and sending them to the agent work as before and never write to GitHub.
4. New GitHub comments use the existing thread display and can be replied to through the existing flow.
5. A fork PR posts to the base repository, not the fork's repository or another open worktree's PR.
6. Local-only lines cannot be published as if they were PR lines. A changed snapshot blocks submission and preserves the draft.
7. Failed or uncertain writes do not lose text, automatically retry, or claim success without evidence.
8. Switching branches, PRs, worktrees, or diff sources does not mix comment destinations, line anchors, or pending results.

## References

- [GitHub REST: Create a review comment](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request)
- [GitHub CLI: PR metadata](https://cli.github.com/manual/gh_pr_view)
