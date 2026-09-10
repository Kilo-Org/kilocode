# PR sidebar v2 parity

Bounded slice: the v1 `sidebar-pr.tsx` line (`order: 50`,
`packages/opencode/src/kilocode/plugins/sidebar-pr.tsx` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`) ported to the v2 TUI as a
Kilo-owned sidebar claim. Source comparison is source-backed and
isolated-host-tested; no live account, network, or real `gh` call is used.

## Surface

`packages/kilo-cli/src/tui-plugin/sidebar-pr.tsx` appends to the native
`sidebar.content` slot (`packages/plugin/src/tui/context.ts:184`) and renders
one muted line `PR #N - title` for the viewed session's repository branch,
hidden when nothing matches. Producers are all public v2 seams:

| V1 behavior | V2 result | Evidence / boundary |
|---|---|---|
| `api.state.vcs?.branch` + `api.state.path.directory` | Session `location` from `ctx.data.session.get(sessionID)?.location ?? ctx.location`; branch read reactively from `ctx.data.location.vcs.info(ref)?.branch.current` (`packages/client/src/solid/data.ts:1238`, `VcsInfo` at `packages/client/src/promise/generated/types.ts:1636,427`) | The component syncs vcs for its location; the native footer reads the same store (`packages/tui/src/feature-plugins/sidebar/footer.tsx:19`). |
| `gh pr view` (tracking ref, then branch) first | Same two calls, decoded through an Effect Schema for gh's canonical `{ number, title }` record | Malformed view payloads — including `null` — fail closed to "no PR" instead of throwing. |
| `git rev-parse HEAD` then `gh pr list --search` / fork-parent chain | Same chain verbatim: `pr list --search "<sha> is:pr"`, `gh repo view --json nameWithOwner,parent`, `pr list -R parent --head branch`, final `pr list -R parent --search` | `selectPr` validates each list entry once against the canonical `{ number, title, headRefOid }` record and skips malformed or non-matching entries — v1's skip-and-keep-scanning semantics, so a bad entry cannot shadow a later valid candidate; only an exact `headRefOid === HEAD` match renders. |
| Per-lookup 20s abort budget; the `timeout: 1000` spawn option is the kill grace after abort, not a per-command deadline; 5-minute `Bun.which("gh")` probe TTL | Same semantics: the component owns one 20s deadline controller for the whole lookup; stopping the child is one consolidated path — abort and read failure both SIGTERM it and one retained timer escalates to SIGKILL after the 1s kill grace, guarded against repeats and cleared when the call settles; the child's exit is awaited on every path; the resolved executable is what every gh spawn uses, never re-resolved mid-lookup | Source: v1 `packages/opencode/src/util/process.ts:86-92` (abort → SIGTERM → `timeout` ms → SIGKILL) and `:118-127` (exit always awaited). `Bun.which("gh", { PATH: process.env.PATH })` and `env: process.env` on spawns because Bun caches the boot-time PATH for bare-name lookups; git still spawns by name with the ambient environment, as in v1. |
| Branch-identity keyed resource, stale responses dropped | `on()` key of directory + workspaceID + current branch; each run owns an `AbortController` (20s deadline) aborted on supersede/unmount, a late result is dropped via the aborted-signal check, and the promise carries a rejection handler so a lookup failure can never surface as an unhandled rejection | Supersede kills in-flight children; no retry of a superseded lookup. |
| Stable unconditional root box; conditional inner text | Same shape (`<box>` always mounted, `<Show>` for the line) | The OpenTUI slot registry requires a stable root. |
| Line color `textMuted` | `theme.text.subdued` | The v2 muted role token, per the theme-token rule. |

The lookup is a client-side spawn of local `gh`/`git`, exactly like v1; no
server RPC, account, or network surface is involved beyond what `gh` itself
does on the user's machine.

## Production wiring

Root owns the install line in `packages/kilo-cli/src/tui-plugin/tui.tsx`
(not present in this slice's tree; the fixture registers the same install
through a runtime-written test plugin instead):

```
import { installPrSidebar } from "./sidebar-pr"
installPrSidebar(ctx, { signal: controller.signal })
```

placed beside the other sidebar installs inside the `append: "app"` render.

## Honest boundaries

- No `description` or `ports` fields exist on v2 (`ShellInfo` producer,
  `packages/core/src/shell.ts:262-282`) — the PR line renders only
  number/title from `gh`, like v1.
- Live branch changes do not reach the TUI on this macOS host: the host's
  location watcher resolves the repository's git directory and watches
  `<repo>/.git/HEAD` as a file event — no polling —
  (`packages/core/src/filesystem/watcher.ts:208-219`,
  `packages/core/src/filesystem/location-watcher.ts:36-38`), and a measured
  observation on this host is that a same-commit `git checkout` HEAD rewrite
  produced no `fs.watch` event for `HEAD` across three runs (only
  `index.lock`/`AUTO_MERGE.lock` surfaced). This is a host-specific
  measurement — this machine's git/FSEvents combination — not a claim about
  macOS generally or about Linux, where the same watcher may well deliver.
  Because the location service layer for an existing directory is immortal
  (`packages/core/src/location-services.ts` `idleTimeToLive`), the server's
  cached branch goes stale until the layer rebuilds. The component therefore
  re-looks-up on every store update the host does deliver — location identity
  changes (real tab/session switches re-sync vcs,
  `packages/tui/src/context/session-tabs.tsx:295`) and `vcs.branch.updated`
  store updates wherever the watcher delivers. The native footer shares this
  exact producer chain.
  cached branch goes stale until the layer rebuilds. The component therefore
  re-looks-up on every store update the host does deliver — location identity
  changes (real tab/session switches re-sync vcs,
  `packages/tui/src/context/session-tabs.tsx:295`) and `vcs.branch.updated`
  store updates wherever the watcher delivers. The native footer shares this
  exact producer chain.
- The wrapped title uses the text element's default wrapping (v1 had no
  `wrapMode` either); narrow widths hide the whole sidebar through the native
  auto-sidebar policy before wrapping is a concern.

## Verification

Bundled Bun 1.4.0 (`packages/kilo-cli/dist/interactive/bun`),
`packages/kilo-cli` typecheck (tsgo; owned files clean) passes. Owned TS files
are prettier-formatted:

- `test/sidebar-pr.test.tsx` — 12 pass: `parsePr` accepts the canonical view
  record and fails closed on `null`, malformed JSON, arrays, string numbers,
  and missing fields; `selectPr` validates each entry once, skips malformed
  and `null` entries (bad-before-valid stays safe, matching v1's
  skip-and-keep-scanning), rejects PRs merely referencing the SHA, and
  returns null for nothing-matching, invalid JSON, empty lists, and non-array
  payloads without throwing; `parseRepo` resolves the fork parent name over
  the owner/login composite and fails closed on `null`, malformed JSON,
  missing self, self-parents, and empty names; `runText` proves cancellation
  terminates the owned child within the kill grace (exit awaited, mapped to
  no exit code), that a real child ignoring SIGTERM (bash `trap "" TERM`) is
  escalated to SIGKILL by the retained one-second grace timer — elapsed
  crosses the grace instead of dying with the SIGTERM — and that normal
  completion resolves with the real exit code inside the grace.
- `test/sidebar-pr-ui.test.tsx` — 8 real renderer scenarios
  (`test/sidebar-pr-ui-fixture.tsx` boots the real isolated host, real
  OpenCode client, real `run()` TUI with the production component installed
  through a runtime-written test plugin under an isolated `pluginDirectories`
  root; a fixture `gh` executable on a restricted PATH replaces the real
  binary — no real `gh`, account, or network call):
  - found: PR #2 renders, the long title wraps inside the sidebar column, the
    hide/show resize cycle performs exactly one fresh lookup, a keeping-width
    resize performs none, and `/exit` while a delayed lookup is in flight
    aborts it and exits cleanly.
  - stale: switching tabs to the sibling repository location supersedes the
    in-flight `main` lookup; the delayed stale response never renders, the
    new location's PR renders, and the superseded lookup never retries.
  - nopr: `gh` reporting nothing renders no line and a stable root.
  - nogh: with `gh` absent from the PATH the probe misses, nothing renders,
    and the shim is never invoked.
  - sha: with `pr view` failing, the real fallback reaches
    `pr list --search "<HEAD> is:pr"` and renders the PR whose `headRefOid`
    equals the local HEAD exactly.
  - sha-wrong: the search returns a PR with a different `headRefOid`; nothing
    renders and the wrong-head payload never leaks into the frame.
  - parent: with the view and local search failing, `gh repo view` resolves a
    fork parent and `pr list -R parent --head branch` renders the matching PR.
  - parent-sha: with the parent `--head` lookup failing, the final
    `pr list -R parent --search` renders the matching PR (both `pr list`
    fallback calls observed in the shim log).
  All eight fixtures also assert no session messages or inbox items are
  created; the fixture's child TUI exits 0 and prints
  `TUI_PR_<SCENARIO>_OK`.
