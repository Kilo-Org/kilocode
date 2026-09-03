# Plan: GitHub-style PR review comments in the Agent Manager PR panel

## Problem

The PR panel in Agent Manager renders every GitHub review thread as one flat,
always-expanded card. The card has weak actions and no way to hand a comment to
the agent. Nine concrete defects:

1. **The unresolve button looks disabled.** A resolved card gets
   `opacity: 0.5` on the whole card
   ([`pr-panel.css:248`](../packages/kilo-vscode/webview-ui/agent-manager/pr/pr-panel.css#L248)),
   which dims the enabled `Unresolve comment` button
   ([`PRComments.tsx:96`](../packages/kilo-vscode/webview-ui/agent-manager/pr/PRComments.tsx#L96)).
   No `disabled` attribute is ever set, so the control works but reads as dead.
   This is the reported bug, and dimming is the wrong fix for "this thread is
   done".
2. **Nothing collapses.** Every thread, resolved or not, renders its full diff
   hunk plus its full Markdown body
   ([`PRComments.tsx:118-124`](../packages/kilo-vscode/webview-ui/agent-manager/pr/PRComments.tsx#L118-L124)).
   On a PR with 20 resolved threads, the 2 threads that still need work are
   buried behind hundreds of pixels of settled discussion.
3. **The actions are not prominent.** Copy is one ghost icon pushed into the
   header row
   ([`PRComments.tsx:80`](../packages/kilo-vscode/webview-ui/agent-manager/pr/PRComments.tsx#L80)),
   and resolve is a low-contrast bordered text button at the bottom
   ([`pr-panel.css:302`](../packages/kilo-vscode/webview-ui/agent-manager/pr/pr-panel.css#L302)).
   The local review comment cards are the opposite: a real action row with a
   primary send action.
4. **A PR comment cannot be sent to the agent.** Local diff review comments have
   `Send to chat` per comment and `Send all to chat` for the batch
   ([`review-annotations.ts:425-432`](../packages/kilo-vscode/webview-ui/diff-viewer/review-annotations.ts#L425-L432),
   [`DiffPanel.tsx:443-459`](../packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx#L443-L459)).
   GitHub PR comments have no equivalent, so the user copies text by hand and
   pastes it into the prompt as raw text.
5. **Only the first comment of a thread is fetched.**
   `comments(first: 1)` in
   [`PRStatusPoller.ts:492`](../packages/kilo-vscode/src/agent-manager/PRStatusPoller.ts#L492)
   and the matching parser
   ([`am-pr-utils.ts:69-89`](../packages/kilo-vscode/src/agent-manager/pr/am-pr-utils.ts#L69-L89))
   drop every reply. The reply usually holds the decision ("agreed, guard it"),
   so both the UI and any send-to-agent payload lose the important half of the
   conversation.
6. **No outdated state.** `isOutdated` is not queried, so a comment against code
   that no longer exists looks identical to a live one.
7. **Resolve failures are opaque.** The bridge drops the real `gh` error and
   posts `success: false` without the `error` field that the message type
   already declares
   ([`pr-status-bridge.ts:120-130`](../packages/kilo-vscode/src/agent-manager/pr-status-bridge.ts#L120-L130),
   [`types.ts:399-405`](../packages/kilo-vscode/src/agent-manager/types.ts#L399-L405)).
   The card shows `Failed to resolve thread.` for a permission error, a network
   error, and a stale thread ID alike.
8. **Strings are hardcoded English** in a webview that ships 21 locales.
9. **`createMemo` is used for a side effect**
   ([`PRComments.tsx:23`](../packages/kilo-vscode/webview-ui/agent-manager/pr/PRComments.tsx#L23))
   to reconcile the optimistic state with the poll result.

## Reference behavior: how GitHub does it

The target is GitHub's own review-thread model, not a new invention.

| GitHub behavior | Detail |
|---|---|
| Resolved thread collapses | In **Files changed**, a resolved thread renders as one compact row: avatar, author, the first line of the comment truncated, and a `Resolved` label. The body, the diff context, and the reply box are hidden. |
| The row is the disclosure | Clicking the collapsed row expands the full thread in place. Nothing is dimmed after it expands. |
| Unresolve is always live | The expanded thread keeps a normal, fully enabled `Unresolve conversation` button. GitHub never greys it out. |
| Resolve collapses immediately | `Resolve conversation` collapses the thread as soon as the mutation succeeds, which is the feedback that the action worked. |
| Outdated threads collapse too | A thread whose code changed gets an `Outdated` badge and starts collapsed. |
| Timeline summary | In **Conversation**, a resolved thread shows `<author> marked this conversation as resolved` with a `Show resolved` button. |
| Counts are visible | The header shows unresolved conversation counts, and the filter menu offers `Unresolved` / `Resolved` / `All`. |
| Replies stay in the thread | A collapsed row hints at thread size; expanding shows every reply in order. |

Two GitHub affordances are deliberately **not** copied: the conversation filter
dropdown (a 320px inspector panel does not have room for it, and two grouped
sections carry the same information), and reply composition (out of scope, see
Non-goals).

## Proposed UX

### Layout

```
──────────────────────────────────────────────
▾ COMMENTS                       3 unresolved
  ┌────────────────────────────────────────┐
  │  ➤  Send 3 unresolved to agent         │   primary, full width
  └────────────────────────────────────────┘

  ┌────────────────────────────────────────┐
  │ src/agent-manager/gh.ts:42             │   meta row
  │ ┌──────────── diff hunk ─────────────┐ │
  │ │ - const x = 1                      │ │
  │ │ + const x = 2                      │ │
  │ └────────────────────────────────────┘ │
  │ @alice                                 │
  │ This throws when gh is missing.        │   Markdown body
  │ ▸ Show 2 replies                       │
  │ ────────────────────────────────────── │
  │ [➤ Send] [Resolve]        ⧉  ↗  ⇥      │   action row
  └────────────────────────────────────────┘

  ┌────────────────────────────────────────┐
  │ src/pr/PRActions.ts:8       [Outdated] │   outdated: collapsed by default
  │ ▸ @bob  this mutation needs a timeout  │
  └────────────────────────────────────────┘

▸ Resolved (5)
```

With the resolved group open:

```
▾ Resolved (5)
  ▸ ✓ @bob    nit: rename this variable
  ▸ ✓ @alice  can we extract this helper?
  ▸ ✓ @bob    good catch, fixed in a9f21c3
```

### Interaction rules

1. **Grouping is derived from server state.** Unresolved threads render first,
   then a collapsible `Resolved (N)` group that starts closed. The section
   heading keeps the existing `N unresolved` count.
2. **Unresolved threads render expanded**, except outdated ones, which render
   collapsed with an `Outdated` badge (GitHub parity).
3. **Resolved threads render as one-line rows.** The row is a `<button>` with
   `aria-expanded`, showing a check icon, `@author`, and the first line of the
   body truncated to one line. Clicking it expands the same card the unresolved
   threads use, with `Unresolve` in place of `Resolve`.
4. **No opacity dimming on controls.** Remove
   `.am-pr-panel-comment-resolved { opacity: 0.5 }`. Resolved state is
   communicated by the collapsed row, the check icon, and a muted `Resolved`
   badge. Muting applies only to the row preview text, never to a button.
5. **Resolve gives immediate feedback.** On success the card leaves the
   unresolved group and a toast appears: `Comment resolved` with an `Undo`
   action that calls unresolve on the same thread. The resolved group is not
   auto-expanded, so the panel does not jump.
6. **Pending state does not move the layout.** Keep the button in place and show
   its spinner inside it, instead of swapping the whole row for a
   `Loading` line as today.
7. **Errors stay actionable.** Show the real reason, truncated to one line, and
   keep the button enabled for a retry. Offer `Open on GitHub` as the escape
   hatch.
8. **Replies are progressive.** The card shows the first comment and a
   `Show N replies` disclosure. Replies render with the same Markdown component,
   indented, and are always included in a send-to-agent payload even when the
   disclosure is closed.

### Action row

Order, left to right, always visible (not hover-only, because a hidden action in
a narrow inspector is an undiscovered action):

| Action | Control | Behavior |
|---|---|---|
| Send to agent | `Button variant="primary" size="small"` with the send glyph | Sends this thread, with replies, to the active session or the active side terminal |
| Resolve / Unresolve | `Button variant="secondary" size="small"` | GraphQL mutation, unchanged transport |
| Copy | `IconButton icon="copy" variant="ghost"` | Copies the full thread as Markdown, not only the first body as today |
| Open on GitHub | `IconButton icon="square-arrow-top-right" variant="ghost"` | Uses `comment.url`, currently fetched and unused |
| Open file | `IconButton icon="go-to-file" variant="ghost"` | `agentManager.openFile` with the worktree session and line; hidden when the thread has no file |

This mirrors the local review comment card, which pairs text buttons for the
primary verbs with ghost icon buttons for the utilities.

### Bulk send

- One primary, full-width button under the section heading:
  `Send 3 unresolved to agent`. It only renders when `unresolved > 0`.
- When a side terminal is the active destination, the label becomes
  `Send 3 unresolved to terminal`, following the same destination rule the diff
  panel already uses via `activeTerminalId`.
- Bulk send never resolves anything on GitHub. The agent has not fixed the code
  yet, so resolving would be a lie to the reviewer.
- Sent threads get a `Sent` badge for the rest of the session, kept in a
  per-worktree `Set<threadId>` in `AgentManagerApp`, next to the existing
  `reviewCommentsByContext` state. Without it, a second click looks identical to
  the first and silently duplicates the prompt.
- A toast confirms: `Sent 3 comments to the agent`.
- Payload caps, so one PR cannot blow up a prompt: at most 100 threads (the
  existing `LIMIT` in the shared review payload), the diff hunk truncated to 40
  lines, each body truncated to 4000 characters, and each thread limited to 10
  replies. When anything is dropped, the toast says
  `Only the first 100 comments were sent`.

### Reuse the existing comment message UI

Do not paste raw text into the prompt. Convert a PR thread into the same review
comment payload the local diff review already uses, so the message renders as a
comment chip with a detail dialog
([`ReviewComments.tsx`](../packages/kilo-vscode/webview-ui/src/components/chat/ReviewComments.tsx))
and survives in session history through the part metadata
([`review-comments.ts`](../packages/kilo-vscode/src/shared/review-comments.ts)).

The chip gains two PR-specific affordances: a `github` icon instead of the
`comment` icon, and `@author` next to the file name. The detail dialog renders
the body with the shared `Markdown` component and shows the diff hunk in the
existing snippet slot.

## Data model

### GraphQL query

Extend `fetchComments` in
[`PRStatusPoller.ts:478-529`](../packages/kilo-vscode/src/agent-manager/PRStatusPoller.ts#L478-L529):

```graphql
reviewThreads(first: 100) {
  totalCount
  nodes {
    id
    isResolved
    isOutdated
    diffSide
    resolvedBy { login }
    comments(first: 20) {
      totalCount
      nodes { id author { login avatarUrl } body path line originalLine url createdAt diffHunk }
    }
  }
}
```

`originalLine` gives a usable line for outdated threads where `line` is null.
`diffSide` maps `LEFT` to `deletions` and `RIGHT` to `additions`, which the
review payload needs. Thread pagination stays at 100 with no cursor loop, same
as today.

### `PRComment`

Extend the three mirrored declarations
([`src/agent-manager/types.ts:62-74`](../packages/kilo-vscode/src/agent-manager/types.ts#L62-L74),
[`webview-ui/src/types/messages/agent-manager.ts`](../packages/kilo-vscode/webview-ui/src/types/messages/agent-manager.ts),
[`webview-ui/agent-manager/pr/pr-types.ts:16-28`](../packages/kilo-vscode/webview-ui/agent-manager/pr/pr-types.ts#L16-L28)):

```ts
outdated: boolean
side?: "additions" | "deletions"
resolvedBy?: string
replies?: { id: string; author: string; body: string; createdAt?: number }[]
replyCount?: number   // thread totalCount - 1, so ">20 replies" stays truthful
```

`unresolved` count semantics do not change.

### Shared review payload

Add a discriminated PR variant to
[`src/shared/review-comments.ts`](../packages/kilo-vscode/src/shared/review-comments.ts)
rather than loosening the local shape:

```ts
export interface PRReviewCommentData {
  id: string            // GitHub thread node id
  origin: "pr"
  author: string
  body: string
  file?: string
  line?: number
  side?: "additions" | "deletions"
  diffHunk?: string
  url?: string
  outdated?: boolean
  replies?: { author: string; body: string }[]
}

export type ReviewCommentEntry = ReviewCommentData | PRReviewCommentData
```

Rules that keep this safe:

- `version` stays `1`. An entry without `origin` follows the existing strict
  local validation, so every historical message keeps parsing.
- `view()` compares the message text against Markdown regenerated from parsed
  data. The PR formatter must therefore be fully deterministic and every PR
  field must round-trip through `parseComment`, or old and new messages fail the
  prefix check and lose their chips.
- `file` and `line` are optional only for `origin: "pr"`, because GitHub allows
  a thread with no resolvable line. The formatter omits the missing fragment.
- Path validation (no absolute path, no `..`, no NUL) applies to PR entries too.
  The path comes from an API response, but it still reaches `openFile`.

Markdown produced for a PR entry:

````md
## Review Comments

**src/agent-manager/gh.ts** (line 42), PR comment by @alice:
```
@@ -39,7 +39,7 @@
-  const x = 1
+  const x = 2
```
This throws when gh is missing.

> @bob: agreed, guard it
````

A thread with no file or line degrades to `PR comment by @alice:`.

## What was implemented

The change landed as one pass over the files below.

### Thread data

| File | Change |
|---|---|
| `src/agent-manager/PRStatusPoller.ts` | Query `isOutdated`, `originalLine`, and `comments(first: 10)` per review thread |
| `src/agent-manager/pr/am-pr-types.ts` | `isOutdated`, `originalLine` on the raw `gh` shapes |
| `src/agent-manager/pr/am-pr-utils.ts` | Map replies from the thread tail, carry `outdated`, fall back to `originalLine`, and add `ghErrorReason` plus `commentsSig` |
| `src/agent-manager/types.ts`, `webview-ui/agent-manager/pr/pr-types.ts` | `outdated`, `replies` on `PRComment` |
| `src/agent-manager/pr-status-bridge.ts` | Send the real `gh` failure reason in the existing `error` field |

The poll deduplication hash now includes a comment signature. Thread and
unresolved counts alone do not change when a reply is added or a body is edited,
so without the signature the panel would render replies it can never refresh.

`resolvedBy` and `diffSide` were not added. Neither is used by the UI or the
payload, so fetching them would only grow the query.

### Shared review payload

`src/shared/review-comments.ts` gained a `PRReviewCommentData` variant of
`ReviewCommentEntry`, guarded by `origin: "pr"`. `version` stays `1`, entries
without `origin` keep the old strict local validation, and every PR field
round-trips so the markdown prefix regenerates byte for byte.
`webview-ui/agent-manager/pr/pr-comment-payload.ts` converts a `PRComment` into
that payload with the caps, and also produces the copy text, the collapsed row
preview, and the `githubUrl` guard that keeps non-https urls away from both the
payload and `openExternal`. Hunk truncation keeps the `@@` header and the tail,
and caps total characters, because a generated file can put a whole hunk on one
line and exceed the shared payload limit.

The payload deliberately carries no url and no reply identifiers. Nothing reads
them, and unused metadata in a persisted message format only invites drift.

### UI

| File | Change |
|---|---|
| `pr/PRComments.tsx` | Section, unresolved and resolved groups, optimistic resolve state, one result listener, bulk send |
| `pr/PRCommentCard.tsx` | New: collapsed row and expanded card with replies and the action row |
| `pr/pr-panel.css` | Row, group, badge, and action styles; the `opacity: 0.5` rule is gone |
| `pr/PRPanel.tsx`, `AgentManagerApp.tsx` | Pass `activeTerminalId`, `onOpenFile`, and `onOpenUrl` through |
| `chat/ReviewComments.tsx` | Render PR entries: `github` icon, author, markdown body, hunk snippet |
| `webview-ui/src/stories/agent-manager.stories.tsx` | `PR panel - review comments` story for visual review |

The card owns its collapsed row instead of a separate row component, and replies
render inline when a card is open instead of behind a second disclosure. Both
choices keep the component count low for the amount of behavior involved.

The list keeps Solid's `Index`, not `For`. Each poll allocates fresh `PRComment`
objects, so identity keying would remount every card and repeat the Pierre diff
and Markdown work on every status push. Sending reuses the existing
`sendReviewComments` helper instead of a second copy of the event envelope.

### Deliberate simplifications

- No toasts and no undo affordance. A successful resolve collapses the card and
  opens the `Resolved` group, so the thread is visibly moved rather than gone,
  and unresolve is one click away inside that group.
- The `Sent` badge is component-local state, not lifted into `AgentManagerApp`.
  It resets when the panel closes, which is enough to stop a double send from
  looking identical to the first one.
- A failed resolve or unresolve forces the card open, otherwise the error would
  be hidden inside a collapsed row.

### Localization

`agentManager.pr.comment.*` and `agentManager.review.metaAuthor` were added to
`webview-ui/agent-manager/i18n/en.ts` and all 20 other locales, which
`tests/unit/i18n-keys.test.ts` and `agent-manager-i18n-split.test.ts` require.


## Edge cases

| Case | Handling |
|---|---|
| Thread with no file or line | Card shows the author only, no `Open file`, payload omits the location fragment |
| Outdated thread | `Outdated` badge, collapsed by default, `originalLine` used for the payload |
| More than 10 replies | Only the first 10 thread comments are fetched; the rest stay on GitHub, one click away from the card |
| Single-line hunk of a generated file | Truncated by characters so the payload stays inside the shared limit and keeps its chips |
| Comment url with a non-https scheme | Dropped by `githubUrl`, so it never reaches `openExternal` |
| More than 100 threads | Threads past 100 are not fetched today; keep that limit and do not silently claim completeness in the bulk label |
| No write access to the repo | Resolve fails; show the reason and keep `Open on GitHub` |
| Bulk send with an empty prompt | Existing `autoSend` semantics apply: it sends; with a draft present it appends to the draft |
| Bulk send while the agent is busy | `PromptInput` already skips auto-send when disabled, so the comments stay in the draft |
| Worktree switch mid-send | The payload targets the destination captured at click time |
| Poll arrives during a pending mutation | Existing optimistic reconciliation, moved to `createEffect` |
| Resolved group open state | Local signal, not persisted, same as the other PR sections |

## Tests

| Level | Coverage |
|---|---|
| `tests/unit/am-pr-utils.test.ts` | Reply mapping, outdated, `originalLine` fallback, `ghErrorReason`, `commentsSig` change detection |
| `tests/unit/review-comments-pr.test.ts` (new) | PR payload format and parse round-trip, mixed payloads, malformed rejection, legacy compatibility, hunk line and character caps, url guard |
| `tests/unit/pr-comments-render.test.ts` | Hunk still renders; the resolved thread sits collapsed behind the group; the row expands into a card; the unresolve control is enabled; send dispatches `appendReviewComments` with an `origin: "pr"` entry including replies |
| `tests/unit/am-pr-status-bridge.test.ts` | The failure result carries the `gh` error message |
| Storybook | `AgentManager / PR panel - review comments` renders all four thread states for visual review and picks up a CI visual-regression baseline |

Commands: `bun run typecheck`, `bun run lint`, `bun run test:unit` from
`packages/kilo-vscode/`, plus `bun run knip` because new exports are added.

## Non-goals

- Replying to a PR comment or creating a new review comment from the panel.
- Approving, requesting changes, or submitting a review.
- Resolving a thread automatically after the agent edits the code.
- Thread pagination past 100 threads.
- A GitHub-style conversation filter dropdown.
- Reusing the Pierre annotation layer to place PR comments inline in the diff
  viewer. That is a larger, separate change.

## Changeset

One `minor` changeset: resolved PR comments collapse like GitHub, PR comments
can be sent to the agent individually or in bulk, and PR comment cards gain
prominent copy, resolve, and open actions.
