# Kilo branding

This directory rebrands the upstream OpenCode product text and artwork to Kilo. It is Kilo-owned host code; the upstream source it targets stays byte-identical to the pinned upstream release, so upstream merges do not conflict on branding and `script/check-opencode-annotations.ts` keeps passing.

## How it works

Branding is applied by a Bun loader, not by editing committed upstream files:

- **dev** — `preload.ts` registers `plugin.ts` as a Bun `onLoad` plugin. Each intercepted upstream module is rebranded in memory as it loads.
- **compiled build** — `script/build.ts` runs the same `brandingPlugin` during `Bun.build` and defines `KILO_BRANDING_COMPILED`, so the branded output is baked into the `kilo2` binary and the runtime loader never runs.

Both paths call `KiloBranding.transform(file, source)` in `text.ts`, which is the single entry point. For an intercepted file it applies three stages in order:

1. **Overrides** (`rules.ts`, `overrides`) — whole-file, file-scoped exact replacements for Kilo _product copy_ that is not a mechanical brand swap (for example, upgrades are disabled, so the upgrade description changes meaning). Applied first so a later OpenCode -> Kilo pass cannot pre-empt them.
2. **Structural transforms** (`structural.ts`) — not branding text: they rewrite imports and logic so the TUI uses Kilo's logo art (`logo-art.ts`), and swap the OAuth wordmark SVG. These are exact and **fail loudly** when upstream moves the code, so a human re-inspects the new implementation during a sync. The `logo.ts` wordmark export is replaced the same way (`brandLogoModule`).
3. **Rule engine** (`engine.ts` + `rules.ts`) — the dynamic part. The module is parsed with Babel and the rules run over **user-visible text only** (string literals, template text, JSX text), located by AST offsets and spliced into the original source so every other byte is preserved. The rules are, per span: a literal map (domains, repo URL, config file name, title prefix), then `\bOpenCode\b` -> `Kilo`, then the command token `opencode` -> `kilo2`.

### What is protected

The engine never rewrites code that merely looks like branding:

- module specifiers (`@opencode/*` imports);
- the command token inside `@opencode`, a dotted ID (`opencode.app`, `opencode.ai`), a path, or a hyphenated name;
- a string literal whose entire value is the bare executable name `"opencode"` (the `OPENCODE_CLI_NAME` fallback, the ACP `command: "opencode"`, the server's basic-auth `username: "opencode"`);
- a string literal that is an equality operand (`=== "# opencode"`) or the search pattern of a `replace`/`replaceAll`/`split`/`includes`/... call (the OAuth seam's `.replaceAll("OpenCode", ...)`);
- a trace span name (`Effect.fn("OpenCodeTools.Plugin")`, `Effect.withSpan("...")`): telemetry groups by it and nobody reads it as product text. Only a string that is the first argument of `Effect.fn` or `Effect.withSpan` is protected; other span shapes (`Stream.withSpan`, the data-first `Effect.withSpan(self, "...")`, a template literal name) are not, and none exists in an intercepted file today.

### Adding coverage

New user-visible text is branded automatically by the rule engine — no list to update. Add an entry only for a genuine exception: a semantic rewrite goes in `overrides`, a non-word fragment (URL, filename) goes in `literals`, and an import/logic rewrite goes in `structural.ts`. If a protected string is being rebranded by mistake, extend the protection in `engine.ts`.

The set of intercepted files is the `files` list in `text.ts`. Intercepted `.txt` prompt templates are bundled as strings, so the engine treats each one as a single user-visible span. The branding audit (see the design note) reports any user-visible OpenCode string the rules leave behind at each sync, including in `packages/server/src`, `packages/core/src` (its modules and its prompt templates) and `packages/plugin/src`, so a miss is a checked failure rather than a silent regression. It reads Kilo's own `packages/kilo-plugin/src` the same way: no loader rewrites Kilo-owned text, so an upstream name left there is corrected in its source. It also runs the full transform over every core and Kilo plugin source, including the text assets bundled as strings (`.txt`/`.md` prompts and skills), and fails on any built-in tool still in the `opencode` namespace (`namespace: "opencode"`, `tools.opencode.*`), which the rule engine leaves alone as dotted IDs, so a new upstream tool or tool reference cannot ship un-rebranded.

### What is not branded

The loader rewrites a whole module, so a module is added to `files` only when every string the rules would change is host branding. These are not, and stay as upstream wrote them:

- real OpenCode provider and SaaS names (OpenCode Console, Go, Zen, the `opencode` provider) and their endpoints;
- what Kilo sends to a third party: the referer, title and billing headers of provider plugins, user agents, the MCP OAuth client metadata. `packages/kilo-plugin/src/request-identity.ts` recognises the upstream referer and title by value, so renaming them here would break it;
- code the host replaces or removes (the updater, the upstream built-in skills, the default config file names).

The audit still reads those modules. `script/branding-audit-allow.ts` records each exception with its reason, in one of two forms: a whole file, for a file whose OpenCode text is uniformly not branding, or a list of exact source snippets (`"HTTP-Referer": "https://opencode.ai/"`, `OpenCode Console`), which accounts for those identities only and leaves every other string of the file audited. Prefer the snippet form. A stale entry fails the audit: a file without findings, or a snippet that accounts for none because upstream moved or reworded the text, so a person reviews it again. So does a snippet that is only the product name (`OpenCode`): it would account for every later use of the name in that file, so a snippet names a longer identity (`OpenCode Console`) or includes the code around the string.

### When the audit fails

`bun run branding:audit` (from `packages/kilo-cli`, also a CI step) prints each finding as `packages/<file>:<line>:<column>` with the text around the place, also inside a prompt file. It reads upstream `packages/{cli,tui,server,core,plugin}/src` and Kilo's own `packages/kilo-plugin/src`. What to do depends on the file and on the text:

- **A Kilo-owned file** (`packages/kilo-*`): correct the text in its source. Name Kilo, the `kilo2` command or the `kilo` tool namespace, not their upstream names.
- **An upstream file**: add it to `files` in `text.ts` (see "Adding coverage"); never edit the upstream text.
- **An identity, not branding** (a provider or SaaS name, a value sent to a third party, code the host replaces): add a reviewed entry to `script/branding-audit-allow.ts`, an exact snippet with its reason (see "What is not branded").

## How this differs from v1, and why

Kilo v1 (`script/upstream/transforms/transform-take-theirs.ts`) rebrands at **merge time** and commits the rebranded upstream files. v2 keeps upstream files byte-identical to the pin and rebrands at **load/build time** here.

The reason is the v2 direction rule (`migration-tracking/principles.md`): code moves from upstream into Kilo-owned files, never back, and a patch never changes an upstream default. Committing rebranded upstream files would be thousands of unmarked Kilo changes in shared files — it would conflict on every sync (v2 syncs every upstream release) and break the annotation/patch checks that keep those syncs cheap.

What was worth keeping from v1 is its _dynamism_: v1 uses pattern/regex rules, not an exhaustive per-string list. This engine takes that same dynamism and runs it at load/build time over pristine source, so new upstream wording is branded automatically while the shared files stay clean. The earlier v2 approach used an exact `[from, to]` list, which threw on any reworded anchor and silently missed any unlisted string; the rule engine plus the audit remove both failure modes.

## Files

- `text.ts` — entry point `transform()`, and `files` (the intercepted modules).
- `rules.ts` — `overrides`, `literals`, and `brandSpan()` (the per-span rules).
- `engine.ts` — AST-scoped text transform and the protected-context rules.
- `structural.ts` — import/logic rewrites, the OAuth wordmark, `brandLogoModule`.
- `plugin.ts` — the Bun `onLoad` plugin (dev loader and build plugin).
- `preload.ts` — installs the plugin unless running in a compiled binary.
- `logo-art.ts` — Kilo's logo art, palette and terminal-support detection.

Design note and rollout plan: `migration-tracking/technical-notes/branding-rule-engine.md`.
