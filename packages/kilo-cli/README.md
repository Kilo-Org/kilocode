# Kilo v2 local preview

Kilo-owned host and CLI adapters around upstream OpenCode v2. This is an
internal, isolated preview—not a customer release or an in-place v1 upgrade.
The [port plan](../../plans/kilo-opencode-v2-issue-13750.md) records completion
gates, exact source comparisons, and remaining gaps.

## Run and check

From the repository root, `bun dev` or `bun run dev` opens the interactive Kilo CLI in the current directory. Arguments are forwarded, for example `bun dev /path/to/project` or `bun dev --help`. If the system Bun is older than 1.4, the command uses the existing bundled runtime automatically. The package's own `dev` command uses the same launcher; `dev:headless` retains the admission-only development entrypoint.

Run from this package with **Bun 1.4 or newer**. The locally bundled runtime
can be used without changing the system Bun installation:

```sh
./dist/interactive/bun run script/build-tui.ts
./dist/interactive/kilo2 --help
./dist/interactive/kilo2 /path/to/project
./dist/interactive/bun run typecheck
./dist/interactive/bun run script/test.ts
```

`build-tui.ts` builds the ACP bridge too. The interactive launcher reads this
checkout's source and dependencies. It is not a standalone distribution.
`script/build.ts` produces a separate admission-only preview used by the
storage/HTTP tests; that compiled binary does not execute conversations.

## Current interactive UI

`/models` keeps native favorites, recents and search, with Kilo-first provider
presentation plus Auto and actual-metadata Recommended groups. Empty favorites
remain empty. Metadata does not add unavailable models to the native catalog.
Use `/teams` to choose the account scope.

`/agents` presents Code (native `build` ID), Ask, Debug and native Plan; configured
agent overrides win. Kilo's custom saved-plan/exit workflow is still pending.
`/memory` uses one local dialog command while the public server command remains
available to headless clients.

An active session's native sidebar adds scoped memory state and Kilo credits/
personal Pass details. Privacy mode masks credits and hides Pass. Native sidebar
auto-visibility requires more than 120 available columns; its toggle still works
in narrower terminals. Indexing/jobs/PR and detailed usage parity remain open.

## Ownership and safety

- Data, config, state, credentials, and daemon registration use the isolated
  `kilo2/interactive` profile. Stable Kilo/OpenCode stores are never adopted.
- One host owns the profile lease. Stop the foreground TUI or managed daemon
  before a one-shot CLI command opens that store. `attach` connects to an
  existing daemon without taking ownership of its process.
- Tests use temporary profiles and local model/embedding/backend fixtures.
  They do not require paid inference or real account credentials.
- Runtime behavior belongs in this package or another Kilo-owned package.
  Public v2 clients and plugin hooks are preferred; dependency direction and
  shared-patch limits are in the [fork conventions](../../kilocode/v2-fork-conventions.md).

## Explicit opt-ins

`--project-config` loads Kilo project configuration, skills and agent markdown.
It can configure executable providers, MCP servers and permissions, so inspect
the repository first. Project executable plugin discovery remains disabled.

Model-loaded skills from explicit trusted profile paths can expand shell
placeholders after native policy checks and a mandatory human confirmation.
Project and remote skills cannot execute placeholders; user-invoked skills
remain literal. `KILO_DISABLE_SKILL_SHELL=1` (or `true`) disables expansion.
Headless `--auto` does not bypass this confirmation. Existing v1 home-directory
skill stores are not scanned automatically.

`--indexing-config file.jsonc` supplies the real indexing engine's configuration.
Without the option no engine starts. An enabled embedding configuration sends
source code to its configured provider. Index data stays under isolated state.

`--sandbox` confines shell-tool writes and network access only. It does not
confine reads, PTYs, MCP processes, or independent core Git operations.

`--swarm` opts into the root/descendant session board. Peer notes are untrusted
context, never permission grants or locks. Native permissions still govern
board tools. Managed daemon/attach do not accept policy-changing flags.

`telemetry enable --endpoint <collector-origin>` saves explicit consent for
payload-free activity event names. Telemetry is otherwise off; a saved decline
overrides environment opt-in. Consent changes require a stopped host.

`import-v1` previews explicitly named auth/config files before `--apply`.
Unsupported fields or credential types refuse the import. Kilo OAuth needs an
explicit `--gateway-server` because the source credential file has no server
provenance. No v1 database migration is exposed by this command.

`cloud start request.json --stream` uses the signed-in account and selected
team to admit remote work, then prints admission IDs followed by event JSONL.
Stream tickets stay out of diagnostics and the admission output. A stream
failure does not undo remote admission. Tests use a loopback Cloud Agent
fixture; compatibility with a deployed backend has not been verified.

## Extension layout

| Boundary | Location |
|---|---|
| Execution host, isolation and plugin registration | `src/interactive-server.ts`, `src/host.ts`, `src/paths.ts` |
| CLI parsing and dispatch | `src/commands.ts`, `src/tui-preview.ts` |
| Public headless conversation adapter | `src/run.ts` |
| Kilo TUI extensions | `src/tui-plugin/` |
| Gateway account/provider policy | `../kilo-gateway/` |
| Reused indexing engine | `../kilo-indexing/` |
| Source and validation evidence | `../../kilocode/baseline/` |

`remote-session.ts` and the v1 database copy utility are bounded, tested
adapters under development, not advertised end-user commands. Cloud Agent
operations and the remote session relay are distinct backend contracts.
