# Codebase indexing v2 parity boundary

This record covers the port of Kilo's codebase-indexing engine to the v2 line.
Source of truth is Kilo `origin/main` pinned at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; the v2 base is `HEAD`
`59b29de40966`. No refs were fetched or moved for this work.

## Shipped v1 implementation

Codebase indexing in v1 is vector search over the workspace, in four layers:

- **Engine package** `origin/main:packages/kilo-indexing` (49 source modules):
  `CodeIndexManager`, orchestrator, config manager, state manager, cache
  manager, search service, service factory; ten embedder providers (`kilo`,
  `openai`, `ollama`, `openai-compatible`, `gemini`, `mistral`,
  `vercel-ai-gateway`, `bedrock`, `openrouter`, `voyage`); two vector stores
  (LanceDB default, Qdrant); tree-sitter chunking with 30 language query files
  and wasm assets; directory scanner, file watcher, ignore rules, worktree
  overlay.
- **Host runtime** `origin/main:packages/opencode/src/kilocode/indexing.ts`
  (582 lines): per-directory lifecycle cache, VSCode consent gate,
  plugin-enabled detection, Kilo auth plus embedding-model catalog resolution,
  primary-worktree baseline overlay, LanceDB runtime externals, telemetry
  forwarding, warning parsing, `Bus` status events.
- **Worker isolation** `indexing-worker.ts`, `indexing-worker-protocol.ts`,
  `indexing-worker-client.ts`: a Bun `Worker` bundled into the v1 binary, with
  `init` / `search` / `dispose` requests and `status` / `telemetry` / `warning` /
  `log` events.
- **Surfaces**: the `semantic_search` tool
  (`origin/main:packages/opencode/src/kilocode/tool/semantic-search.ts`),
  registered only when `KiloIndexing.ready()` is true
  (`kilocode/tool/registry.ts`, gated on the manager's `initialized` flag); the
  HttpApi `indexing` group (`status`, `warnings`, `models`, `consent` — no
  search endpoint); TUI dialog and sidebar; VSCode `IndexingTab`; console
  `IndexingRoute`. `experimental.codebase_search` is retired config that v1
  deletes with a warning.

## Why the engine was copied rather than reused in place

Verified before any code was written:

1. `@kilocode/kilo-indexing` is unpublished — `npm view` returns 404, as it does
   for `@kilocode/kilo-memory`. It could not be added as an external dependency.
2. v1 exposes no out-of-process search. The HttpApi indexing group is
   status/warnings/models/consent only, there is no indexing CLI command (no
   matches for `indexing` under `origin/main:packages/opencode/src/cli`), and
   search exists only as in-process `KiloIndexing.search`.
3. The v1 engine worker is not attachable: `indexing-worker.ts` is compiled into
   the v1 binary as a Bun `Worker` (resolved through
   `KILO_INDEXING_WORKER_PATH` inside bunfs) and speaks `postMessage`.
4. v2 has no substitute. `packages/core/src/ripgrep.ts` is lexical search, and
   no package in the tree provides embeddings or vector storage.

## What was ported

### `packages/kilo-indexing` (new Kilo-owned package, `@kilocode/indexing`)

118 files copied verbatim from the pinned SHA: the whole engine plus its 30 test
files. Copies were produced with `git show <SHA>:<path>`, so content matches the
source exactly.

Not copied, with reasons:

- `src/plugin.ts` — v1 no-op plugin entry (`async () => ({})`), the only
  `@kilocode/plugin` consumer.
- `src/server/routes.ts` — v1 hono router; v2's server is Effect `HttpApi`. Only
  consumer of `hono` and `hono-openapi`.
- `src/detect.ts` — v1 plugin-name detection for `hasIndexingPlugin(cfg.plugin)`;
  v2 registers the plugin explicitly from the host.
- `test/kilocode/indexing/detect.test.ts` — covered only the unported module.

Dependencies dropped versus v1's manifest: `@kilocode/plugin`,
`@kilocode/kilo-gateway`, `hono`, `hono-openapi`. All other v1 runtime pins are
kept identical (`@lancedb/lancedb` 0.26.2, `@parcel/watcher` 2.5.1,
`@qdrant/js-client-rest` 1.17.0, `web-tree-sitter` 0.25.10, `tree-sitter-wasms`
0.1.13, `openai` 6.27.0, both AWS SDK packages, `async-mutex`, `glob`, `ignore`,
`minimatch`, `p-limit`, `uuid`); `effect` and `zod` use the tree catalog, whose
`zod` 4.1.8 matches v1's pin exactly. No root catalog or lockfile edits.

### Gateway divergence (`packages/kilo-indexing/src/gateway.ts`)

v1 imported three things from `@kilocode/kilo-gateway`: `getDefaultHeaders`
(used only by the openrouter embedder), and `resolveKiloGatewayBaseUrl` plus
`HEADER_FEATURE` / `HEADER_ORGANIZATIONID` (used only by the kilo embedder). The
v2 `@kilocode/gateway` has no equivalent — its single export map entry exposes
`deviceAuth`, `fetchProfile`, `defaultOrganizationID`, `serverUrl`,
`createGatewayPlugin`, `registerGateway`, and `registerSessions` only:

- No request-header surface exists at all.
- `serverUrl` is not a substitute for `resolveKiloGatewayBaseUrl`. It validates
  and trims a base URL but does not read `KILO_API_URL`, does not honor a
  token-encoded URL prefix (v1 `getKiloUrlFromToken`), and does not append the
  `/api/gateway/` route. It is also stricter: it throws on non-loopback HTTP and
  on any query or fragment, both of which v1 accepts and strips.

Those helpers were therefore ported verbatim into an owned module rather than
re-expressed against a different contract. **Retirement condition:** when
`@kilocode/gateway` publishes a gateway-URL and request-header surface, delete
`src/gateway.ts` and import from it.

### `packages/kilo-cli/src/indexing.ts` (v2 host)

Drives the real `CodeIndexManager`: constructs it per Location, subscribes to
`onProgressUpdate`, calls `initialize(toIndexingConfigInput(settings))`, projects
status through the engine's own `normalizeIndexingStatus`, searches through
`manager.searchIndex`, and disposes the manager on scope close. The
`semantic_search` tool is registered through the public `ctx.tool.transform`
seam with v1's workspace-relative path scoping, escape rejection, result
projection, and output format, gated on an `available` flag that mirrors v1's
`initialized` (`ready()` = initialized and not `Disabled`).

Execution approval is host-owned rather than inferred from the plugin's
`options.permission` visibility filter. The host authorizer runs before the
engine search with v1's `semantic_search` action, the query as its resource,
and `save: ["*"]`; direct `IndexingHost.search` remains a local engine API.
Without a host authorizer, the transformed tool fails closed before querying.

Two host-level safety rules that v1 did not have:

- **The configured store directory cannot escape the isolated index root.**
  `indexing.lancedb.directory` is otherwise an arbitrary path the engine would
  open and write, including an existing store belonging to something else. A
  value outside the root is refused with an `Error` status and no engine start —
  never silently rewritten — and the offending path is not echoed.
- **Failure diagnostics carry no engine text.** v1 put the raw failure message
  into its status. An embedder failure can carry a request URL, a provider
  response body, or a base URL with an embedded token, so initialization
  failures report only provably safe values: the error class (a source-level
  identifier) and a numeric HTTP status when present. Engine-emitted `Error`
  statuses are collapsed to a stage taken from the engine's own fixed prefixes
  (initial scan, file watch, embedder setup, vector store setup). Full detail
  stays in the engine's own log, which is off unless `KILO_INDEXING_LOG` is set
  and writes to stderr.

### `packages/kilo-cli/src/indexing-input.ts` (explicit opt-in file)

`readIndexingConfig(file)` backs the public `--indexing-config <file>` flag.
Enabling indexing sends source code to the configured embedding provider, so the
input is a file the user names explicitly and never something discovered from the
project. The read is bounded and fails closed: no symlink, regular file only,
64 KiB limit, JSONC parsed with `jsonc-parser`, object documents only, then
decoded against the engine's own `IndexingSchema` with `onExcessProperty: "error"`
so a typo cannot silently disable a setting. Because such a file holds provider
API keys and endpoints, no failure message repeats a key path, a value, the
document, or the file path.

## Divergences from v1, deliberate

- **In-process, not worker-isolated.** v1 runs the engine in a bundled Bun
  `Worker`; v2 runs it in the server process. Bundling a worker entry is a
  build-manifest decision outside this slice.
- **No Kilo embedding-model catalog or auth enrichment.** v1's host resolves
  `fetchKiloEmbeddingModelCatalog` and injects API key, base URL, and
  organization ID from `@kilocode/kilo-gateway`. v2's `@kilocode/gateway` has no
  embedding catalog, so the `kilo` provider is ported but unwired: it requires
  explicit `indexing.kilo.*` settings and a model ID.
- **No consent gate, telemetry sink, or Qdrant version warnings.** The engine
  still emits telemetry and logs; the v2 host does not subscribe.
- **No HttpApi routes, TUI dialog, or sidebar.**
- **No worktree baseline overlay computation.** `baselineDirectory` is accepted
  and forwarded; nothing computes it yet.
- **Settings come from an explicit file, not `kilo.json`.** v2 config has no
  `indexing` key and upstream `Config.Info` rejects unknown keys. The shared
  config schema was not touched; the host takes settings from
  `--indexing-config` through `readIndexingConfig`.
- **The engine's own tests are not typechecked**, matching v1's tsconfig, whose
  `include` is `src/**/*` only. Eight of the copied test files rely on loose
  mock shapes that fail under `tsgo`; they were left byte-identical rather than
  edited, and `include` stays `["src"]`.

## Verification

Run from package directories with the bundled runtime
(`packages/kilo-cli/dist/interactive/bun`, Bun 1.4.0):

- `packages/kilo-indexing`: `bun test` — 501 pass, 9 skip, 0 fail across 31
  files. The nine skips are v1's own `test.skip`/`describe.skip` rate-limit and
  base64 cases, unchanged. `bun run typecheck` — clean.
- `packages/kilo-cli`: `bun test test/indexing.test.ts test/indexing-input.test.ts`
  — 17 pass, 0 fail. `bun run typecheck` — clean.

`packages/kilo-cli/test/indexing.test.ts` is a real end-to-end test, not a fake
driver: it writes a fixture checkout, serves embeddings from a loopback Bun HTTP
server implementing the OpenAI `/embeddings` shape (deterministic hashed
bag-of-words vectors, so no paid inference), and lets the engine build an actual
LanceDB table. Coverage:

- the real indexed file count after the engine's ignore rules exclude `vendor/`,
  and that a `vendor/` file never appears in results
- top-ranked semantic matches with scores and line ranges, LanceDB
  prefix-filtered scoped search, the empty-result message, workspace escape
  rejection, and tool registration plus execution through the plugin transform
- a store directory outside the isolated root refused with no write and no
  embedding request; a directory inside the root accepted and populated
- disabled and enabled-but-unconfigured projects: no tool, no embedding request,
  no index directory
- an unreachable embedding service reported as an `Error` status
- **host wiring through `launch(input, { indexing })`**: a loopback model that
  calls `semantic_search`, with the tool result read back from public history
  (`client.message.list`), asserting real matches from `src/auth.ts`, that
  ignored `vendor/` files never reach the model, and that the engine indexed the
  activated location's own store directory under the isolated state root
- the same host wiring with `enabled: false`: the model still asks for the tool,
  but nothing is registered, so the transcript carries no tool output and no
  source, no embedding request is made, and no index directory is created
- `packages/kilo-cli/test/indexing.test.ts` also runs the real host with a local
  fake model through ask/reject, allow, and resource-specific deny decisions;
  rejected and denied queries never reach the embedding/search path. The
  transform test proves a missing authorizer fails closed.

`packages/kilo-indexing/test/log.test.ts` is the only new file in the engine's
test tree (the other 29 are verbatim v1 copies under `test/kilocode/`). It
imports `src/util/log.ts` directly and asserts the opt-in logger contract in
separate processes, since the module reads the environment at import: silent on
both streams by default and for unrecognised values, JSON on stderr only — never
stdout, which would corrupt stdio protocols such as ACP — for `1` and `true`.

`packages/kilo-cli/test/indexing-input.test.ts` covers `readIndexingConfig`:
JSONC with comments and trailing commas, no inferred opt-in, rejection of
missing, irregular, symlinked, and oversized files, malformed and non-object
documents, and seven schema violations including unknown keys — asserting for
each that the message never contains the API key, the key name, or the file
path.

## Still parent-owned

- `packages/kilo-cli/package.json` dependency on `@kilocode/indexing`, the
  `launch(input, { indexing })` option with its dynamic
  `createIndexingPlugin({ state, settings })` registration, and the
  `--indexing-config` flag parsing and help text. All landed.
- CLI build packaging: LanceDB native externals and, if worker isolation is
  wanted, an indexing worker entry. v1 solves both in
  `packages/opencode/script/build.ts`; the engine resolves LanceDB dynamically
  through `src/indexing/vector-store/lancedb-loader.ts`, overridable with
  `KILO_LANCEDB_PATH`.
