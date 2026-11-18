<!-- kilocode_change - new file -->

# nono gate: read-only `.git`

Status: blocked, awaiting an upstream primitive. Recorded 2026-11-18 against nono v0.82.0 on Darwin 27.0.0
arm64. This document is the decision record for the gate; it changes no enforcement.

## Why `.git` matters

Kilo's sandbox lets a command leave the sandbox for mutating git operations: `git commit`, `git checkout`,
`git worktree add`. That one command is explicitly approved by a person and then runs with the user's full
rights.

Today `.git` is read-only inside the sandbox. That is what makes the approval safe: a sandboxed command can
read repository state, but it cannot prepare the repository so that the approved git command runs its code.

If a sandboxed command can write `.git`, it can plant that code. Git reads programs and paths from repository
configuration, and several of them execute on ordinary commands:

- `.git/hooks/*`, and `core.hooksPath` pointing anywhere else;
- `core.fsmonitor`, credential helpers, `diff.external`, clean and smudge filters;
- `include.path` / `includeIf`, which pull in more configuration;
- aliases and `protocol.ext`.

The result is not a theoretical escape: the next approved `git commit` can execute attacker-chosen code outside
the sandbox.

## What nono provides, and what it does not

A profile can grant write access to a subtree (`filesystem.allow`) and block a path (`filesystem.deny`). The
block covers **reads and writes**. There is no write-only deny, and the profile schema has no read-only path
list.

Measured with the pinned binary: a profile that grants `<workspace>` write and denies `<workspace>/.git`:

```
deny .git   read .git/config    exit=1     # git itself needs this read
deny .git   write .git/new      exit=1
deny .git   write root file     exit=0
no deny     read .git/config    exit=0
no deny     write .git/new      exit=0
```

So the only available switch breaks `git status`, `git log` and every git command that should still work.

## Workarounds considered

| Workaround                                          | Why it is not acceptable                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Deny `.git`                                         | Blocks reads, breaks normal git use in the sandbox                                                            |
| Grant every top-level workspace entry except `.git` | Commands can no longer create files or folders at the workspace root; nested `.git` folders stay exposed      |
| Mount namespaces on macOS                           | Not available; nono's maintainers have argued against them on Linux too                                       |
| Rework git escalation into a limited sandbox        | A real design, but a separate project; the approved command currently needs full rights for hooks and network |

## Impact on the rest of the work

Blocked by this gate:

- Switching macOS to nono as the sandbox provider. Under the plan's no-regression rule, the current backend
  stays in place until this lands.
- Any claim that the replacement preserves every current protection. It does not, yet.
- The acceptance matrix row for `.git`, nested repositories, submodules and worktrees: it stays a known
  failure, not a pass.

Not affected, and safe to continue:

- Profile generation, read confinement, credential placeholders, alias removal and fail-before-launch.
- Network denial, allowlisting, proxy routing and the device-file grants.
- Environment isolation, XDG handling, profile protection and the packaged binary.
- Global-config read grants and credential definitions, session policy and inheritance.
- Diagnostics, CI, and the documentation series.

The gate is one write protection on one directory class. It does not change how the backend launches commands
or how the rest of the policy is translated.

## Decision

1. File an upstream request for a path that stays readable but cannot be written.
2. Keep macOS on the native backend until the request lands and the probe passes.
3. Add a Kilo-side guard as a follow-up: before an escalated git command runs, refuse if `.git` changed during
   the sandboxed session (hooks, configuration, attributes, includes). This does not replace the primitive; it
   closes the most direct path in the meantime.

## Upstream request text

> **Title:** Profile primitive for readable-but-not-writable paths
>
> **Summary.** Profiles can grant write access to a subtree and block a path, but a block also removes read
> access. We need to keep a subtree readable while preventing writes to it, for paths inside a grant.
>
> **Use case.** We sandbox coding agents. A repository's `.git` directory must stay readable (`git status`,
> `git log`) but must not be writable: repository configuration can name programs that git executes
> (hooks, `core.hooksPath`, fsmonitor, filters, credential helpers, `include.path`). A command that can write
> `.git` can prepare code that runs later, outside the sandbox, when the user approves a repository-changing git
> command.
>
> **Current behaviour.** With `extends: "default"`, `filesystem.allow: ["<workspace>"]` and
> `filesystem.deny: ["<workspace>/.git"]`, reading `<workspace>/.git/config` fails, so git cannot operate.
> Without the deny, writes to `.git` succeed.
>
> **Workaround limits.** Granting every top-level entry except `.git` prevents creating new entries at the
> workspace root, and does not cover nested repositories. Mount namespaces are not available on macOS, and
> Landlock grants are additive on Linux.
>
> **Proposal.** Add a subtractive, write-only path rule, for example:
>
> ```jsonc
> "filesystem": {
>   "allow": ["/work/repo"],
>   "readonly": ["/work/repo/.git"]
> }
> ```
>
> Semantics we would rely on: paths or globs; the rule subtracts only write permission from grants and never
> affects reads; it is validated when the path is inside a writable grant; it applies on macOS and Linux with
> equivalent behaviour, or the profile fails to start when the platform cannot express it.
>
> **Evidence.** nono 0.82.0, macOS 14/arm64: `deny .git` → `cat .git/config` exit 1; no deny → write to
> `.git/new` succeeds. Happy to test a preview build and report results.

## Showing the feature without this gate

The demo does not need `.git` writes to be blocked. Show, in this order:

1. **Read confinement.** A command reading `~/.ssh/id_ed25519`, `~/.aws/credentials`, a shell rc file or the
   Kilo database is refused; reading the workspace succeeds.
2. **Credential injection.** The child sees a placeholder in the configured variable; the upstream echo
   receives the real secret; a known alias is empty.
3. **Network.** A non-allowlisted host is blocked; an allowlisted host works through nono's proxy; a direct
   connection that bypasses the proxy is blocked.
4. **Environment.** `NODE_OPTIONS` restored, no Kilo proxy variables in the child, the profile itself
   unreadable.
5. **Ordinary work still functions.** Write a file in the workspace, run a test command, use `/dev/null`.
6. **The known gap, stated plainly.** Writing to `.git` still succeeds; it is tracked upstream and blocks the
   provider switch, not the rest of the feature.

Run the probe matrix with `bun run poc` in `packages/kilo-sandbox` on the development branch; it prints one row
per probe with `PASS`, `FAIL` or `NOTE`.

## Exit criteria

The gate is closed when a pinned nono passes this probe, on macOS and on Linux if that platform is claimed:

```
read .git/config        allowed
write .git/new          denied
write root file         allowed
write nested .git/x     denied      (nested repository)
```

and the acceptance matrix records `.git`, submodules and worktrees as passing.

## References

- nono: <https://github.com/nolabs-ai/nono>
- Design and decisions: the nono design document, added by the documentation PR in this series
- Probe harness: `packages/kilo-sandbox/script/nono-poc.ts`
