# V1 Explore read-only shell ceiling parity boundary

At Kilo `origin/main` commit `ecccd1f`, Explore is not merely "no bash". The v1
`patchAgents` explore branch (`packages/opencode/src/kilocode/agent/index.ts`)
merges `Permission.fromConfig({ bash: exploreBash })` after the user ruleset as a
ceiling, then re-appends `denies(user)` last, and appends a description suffix.
`exploreBash` is `readOnlyBash` plus `"gh *": "deny"` and `"find *": "deny"`.
`readOnlyBash` is `"*": "deny"`, the 28 readable allows (`cat head tail less ls
tree pwd echo wc which type file diff du df date uname whoami printenv man grep
rg ag sort uniq cut tr jq`), the 20 git read-only allows (`git log show diff
status blame rev-parse rev-list ls-files ls-tree ls-remote shortlog describe
cat-file name-rev stash-list tag -l branch --list/-a/-r remote -v`), then
defense-in-depth denies for chain/redirection operators and for flags that let
an "allowed" command write files or exec a program
(`sort -o/--output/--compress-program/--files0-from`, `rg --pre/--hostname-bin`,
`ag --pager`, `man -P/--pager/-H`). These counts are verified against the pinned
source; the earlier audit's "27 readable / 11 git" was inaccurate.

V2's native Explore (`packages/core/src/plugin/agent.ts`) denies everything
through a bare wildcard deny with grep/glob/webfetch/websearch/read allows and
`.env` asks; there is no shell allow at all. This slice restores the v1
read-only shell posture on v2's existing public seams, with no new engine, no
shared Core patch, and no OS-sandbox claim.

## Implemented public seam

`packages/kilo-cli/src/agent-policy.ts` splits the policy across the two public
phases. `createExplorePolicy()` is registered in the **default** phase (no
`phase` option) and owns only the `agent.transform` that appends the allowlist
ceiling — the exact "after native AgentPlugin, before ConfigAgentPlugin" seam.
`createAgentPolicy()` is registered in the **post** phase and owns the
`permission.evaluate` ceiling enforcement. Source-verified ordering:

- The supervisor's pre list is `[internal.pre (AgentPlugin), sdk.all(),
  instance.all()]` and its post list is `[internal.post (ConfigAgentPlugin),
  sdk.allPost()]` (`packages/core/src/plugin/supervisor.ts`). A default-phase SDK
  plugin joins `sdk.all()`, so its transform is folded after the native
  AgentPlugin's and before ConfigAgentPlugin's.
- `Agent.Service` rebuilds by folding every registered transform in registration
  order against one editor (`packages/core/src/state.ts`).
- Permission evaluation is last-match-wins (`Permission.evaluate` uses
  `findLast` + `Wildcard.match`, `packages/core/src/permission.ts`).

The transform appends the verbatim v1 `exploreBash` table as `action: "shell"`
rules plus `skill` and `semantic_search` allows, so the allowlist wins over the
native wildcard deny. Because config is appended afterward, explicit user rules
stay authoritative:

- An explicit user deny (including a wildcard identical to the native one) lands
  after the ceiling and wins by last-match. No re-append and no provenance
  guessing is needed — the earlier count-budget workaround was removed.
- A broad config `shell` allow lands after the ceiling too, so pure ruleset
  evaluation would reopen a table-denied command. The `permission.evaluate`
  ceiling hook in the post `createAgentPolicy` forces `deny` for any shell
  resource the v1 table alone denies. The hook runs in the real `assert` path
  after the configured-deny short-circuit (`Permission.evaluateInput`), so user
  denies are never reordered, while config allows cannot reopen the ceiling —
  matching v1's "user allows cannot make Explore's shell writable".

A configured Explore agent keeps its own system prompt, mode, and description;
the ceiling always applies. The description suffix is appended only when the
current description still equals the exact native string (the same guard shape
as the Code rename).

`list`/`board` allows are not ported: V2 has no `list` tool and no board tools.
V1's whitelisted external directories stay unported per V2's existing
external_directory `ask` posture. These are deliberate V2 deltas, not silent
drops.

## Test evidence

`packages/kilo-cli/test/agent-policy.test.ts` and its fixture drive the real
production `launch()` host on a loopback fake model with the bundled Bun 1.4.0
(no live accounts, no paid inference). The host registers `createExplorePolicy()`
itself in the default phase, so the tests exercise the production wiring
unchanged. The fixture detects Explore through its system prompt and echoes the
requested command back as a real shell tool call, so the real permission
pipeline decides each outcome.

- Real last-match evaluation on the native ruleset: `cat`, `rg`, `git status`,
  and `git log` allow; `git push`, `gh`, `find -delete`,
  `sort -o/--compress-program`, `rg --pre`, and
  chain/pipe/substitution/backtick/redirect forms deny; unknown commands stay
  denied; `skill`/`semantic_search` allow; `edit` denies; the description suffix
  is present on the native Explore.
- Real host runs: allowed `cat` and `git status` execute with no error part,
  while every denied command surfaces a tool error (blocked before execution).
- An explicit configured `git status *` deny still wins over the allowlist in
  both ruleset evaluation and real execution; untouched allowlist entries stay
  allowed.
- A broad global `shell *:allow` plus an agent-level `shell *:allow` does not
  reopen `git push`, `find`, `sort -o`, `sort --compress-program`, `rg --pre`,
  or chain/pipe/substitution/backtick/redirect in real execution (the
  evaluate-hook ceiling), while `cat` and `git status` still run.
- A configured Explore keeps its own description and system prompt yet still
  receives the ceiling.
- With the default-phase explore policy disabled via config
  `plugins: ["-kilocode.explore-policy"]` plus a broad shell allow, the enforced
  post `kilocode.agent-policy` permission.evaluate ceiling still denies every
  table-denied command in real execution, `cat`/`git status` still run, and the
  redirect is blocked before any child write (`out.txt` is not created). An
  attempted `plugins: ["-kilocode.agent-policy"]` disable does not remove the
  ceiling: post SDK plugins are host-enforced against config remove operations.
- Ask and Debug are unchanged (the Code rename, Ask read-only denies, Debug, and
  the default-agent fallback all still pass).

Focused run: 5 tests, 0 failures, 78 assertions, plus a clean `tsgo --noEmit`.
