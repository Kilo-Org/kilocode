# Config Regression Review: PR #12204

Revalidated `review/upstream-12204-latest` at `472247daa9063cf7dfea423bec64c46cea44ba36` against `c49560af0f94459015d3fa4e1efa23ad9b291955`, after the PR was force-pushed from previously reviewed head `2ca787fa4de21f0d00eb16f95b38e214d2e18242`.

The two prior findings still apply. The force-push delta changes only `packages/opencode/src/mcp/catalog.ts` and `packages/opencode/src/mcp/index.ts` in the audited packages; those changes rename an MCP collection helper and do not alter config discovery, path resolution, or precedence. No additional production `.opencode` fallback regression was found.

## Findings

### High: TUI reference lookup now reads `.opencode` and misses Kilo config roots

The extracted TUI newly obtains reference aliases from the core V2 registry. That registry is still backed by upstream-style config discovery, so this changes a user-visible `@reference` lookup from Kilo config semantics to OpenCode semantics.

- The core loader only considers `config.json`, `opencode.json`, and `opencode.jsonc`, discovers `.opencode` directories, and gives those directories precedence after direct project files (`packages/core/src/config.ts:141-142`, `packages/core/src/config.ts:176-202`). It does not consider `kilo.json`, `.kilo`, or `.kilocode`. The retained test explicitly requires `.opencode` discovery and ordering (`packages/core/test/config/config.test.ts:702-760`).
- This PR adds `ConfigReferencePlugin`, which builds references exclusively from that loader's documents (`packages/core/src/config/plugin/reference.ts:13-48`), and registers it during core plugin boot (`packages/core/src/plugin/boot.ts:100-114`).
- The new TUI data context fetches `client.v2.reference.list()` during every mount (`packages/tui/src/context/data.tsx:546-553`, `packages/tui/src/context/data.tsx:569-579`). Autocomplete then uses those results for visible `@alias` suggestions and insertion (`packages/tui/src/component/prompt/autocomplete.tsx:281-289`, `packages/tui/src/component/prompt/autocomplete.tsx:417-439`, `packages/tui/src/component/prompt/autocomplete.tsx:471-490`). In the base version, autocomplete normalized references from the current CLI's already merged `sync.data.config.reference` instead.
- The V2 reference handler is part of the server API (`packages/server/src/handlers/reference.ts:1-8`, `packages/server/src/api.ts:20-35`), and the in-process route tree used by `Server.Default()` includes those server routes (`packages/opencode/src/server/routes/instance/httpapi/server.ts:177-180`, `packages/opencode/src/server/routes/instance/httpapi/server.ts:211-220`).

Impact: references declared in normal `kilo.json`, `.kilo/kilo.json`, or `.kilocode/kilo.json` can disappear from TUI autocomplete, while a repository's `.opencode/opencode.json` can unexpectedly inject aliases. Relative reference paths are then resolved relative to the unintended source file. This is both reintroduced `.opencode` filesystem fallback and damage to Kilo-only lookup.

The same new TUI data context requests V2 agents, commands, and skills (`packages/tui/src/context/data.tsx:496-515`, `packages/tui/src/context/data.tsx:556-578`), whose core readers consume the same emitted `.opencode` directories (`packages/core/src/config/plugin/agent.ts:40-57`, `packages/core/src/config/plugin/command.ts:19-29`, `packages/core/src/config/plugin/skill.ts:15-31`). Current agent and slash-command presentation still reads the stable sync store, so I did not confirm a second visible regression there. Human verification is warranted if those prefetched V2 collections are intended to become authoritative elsewhere in the extracted TUI.

Recommended fix: make core config discovery honor Kilo roots and ordering before using these registries in the TUI, including tests that `.opencode` is ignored and `.kilo` wins over `.kilocode`; alternatively keep TUI references on the current CLI's Kilo-aware effective config.

### Medium: new non-interactive MCP tests assert the obsolete global OpenCode path

The new `mcp add` branch writes through `resolveConfigPath(Global.Path.config, true)` (`packages/opencode/src/cli/cmd/mcp.ts:523-525`). `Global.Path.config` is XDG `kilo`, and the resolver defaults to `kilo.json` (`packages/core/src/global.ts:12-25`, `packages/opencode/src/cli/cmd/mcp.ts:405-435`). However, both new subprocess tests read `~/.config/opencode/opencode.json` (`packages/opencode/test/cli/mcp-add.test.ts:24-26`, `packages/opencode/test/cli/mcp-add.test.ts:60-62`). The harness explicitly sets `XDG_CONFIG_HOME` to `<home>/.config` (`packages/opencode/test/lib/cli-process.ts:60-69`), so these assertions target a file the Kilo command does not create.

This does not introduce an OpenCode fallback in production code, but it leaves the new path-writing feature without passing coverage and encodes the wrong directory/filename contract. Update the assertions to `<home>/.config/kilo/kilo.json` and retain a negative assertion that no OpenCode global directory is created.

## Notable non-findings

- Current CLI discovery is unchanged from the base: `ConfigPaths.directories` scans global Kilo config, project/home `.kilocode` and `.kilo`, then `KILO_CONFIG_DIR`; it does not emit `.opencode` (`packages/opencode/src/config/paths.ts:23-40`). The server loader still applies `.kilocode` before `.kilo`, making `.kilo` win, and only then reads compatible filenames inside accepted directories (`packages/opencode/src/config/config.ts:651-700`).
- Existing `opencode.json/jsonc` support remains filename compatibility inside the Kilo global root, direct project levels, accepted `.kilo`/`.kilocode` directories, managed Kilo directory, and explicit paths (`packages/opencode/src/config/config.ts:343-366`, `packages/opencode/src/config/config.ts:627-644`, `packages/opencode/src/kilocode/config/config.ts:40-47`). It is not a newly restored `~/.config/opencode` or `.opencode` directory fallback in the current loader.
- The extracted TUI config loader still limits directory config to `.kilo`, `.kilocode`, and explicit `KILO_CONFIG_DIR` (`packages/opencode/src/config/tui.ts:184-232`). Its legacy-key migration only examines `kilo.json/jsonc` plus an explicit `KILO_CONFIG` path (`packages/opencode/src/config/tui-migrate.ts:126-144`). Custom theme discovery likewise adds only `.kilocode` and `.kilo` while walking upward (`packages/tui/src/context/theme.tsx:37-47`).
- Provider IDs, package/service names, schema URLs, the `opencode` theme asset, well-known URLs, and test fixture labels containing `opencode` were not treated as filesystem fallback candidates.

## Commands and limitations

The revalidation used `git status --short --branch`, `git rev-parse HEAD`, diffs from both the supplied base and old reviewed head, focused `git diff -G`, `git grep`, repository content searches, line-by-line reads, and `git diff --check`. The prior finding paths are byte-for-byte unchanged from the old reviewed head, and `packages/opencode/src/config/paths.ts` remains byte-for-byte unchanged from the base. Current source searches found no additional `.opencode` config loader beyond the core V2 loader already covered above; other matches were compatible `opencode.json/jsonc` filenames, migration detection, plan/bin compatibility paths, provider/internal identifiers, comments, or disabled upstream TUI tips.

Focused tests were attempted with:

```sh
cd packages/core && bun test ./test/config/config.test.ts
cd packages/opencode && bun test ./test/config/config.test.ts ./test/config/tui.test.ts ./test/cli/mcp-add.test.ts
```

They still do not start at the current head because dependencies are absent in this worktree (`Cannot find package 'effect'`; `preload not found "@opentui/solid/preload"`). No live TUI or subprocess behavior was exercised. `rg` is also unavailable in the container, so searches used the repository search tools, `git grep`, and `git diff -G` instead.
