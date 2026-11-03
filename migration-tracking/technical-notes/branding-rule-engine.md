# Design: rule-based branding loader + sync-time coverage audit

Status: proposed, for review. Supersedes the exhaustive exact-string list in
`packages/kilo-cli/src/branding/text.ts` with a scoped rule engine plus a
coverage audit, while keeping the v2 pristine-source model intact.

## 1. Problem

`packages/kilo-cli/src/branding/text.ts` holds a per-file list of exact
`[from, to]` string pairs. `KiloBranding.transform()` applies them through the
Bun loader (`plugin.ts`) in dev and bakes them into the compiled `kilo2` binary
at build time (`script/build.ts`, guarded by `KILO_BRANDING_COMPILED`). Upstream
source stays byte-identical; branding is applied only at load/build time.

The exact list has two failure modes on every upstream sync:

- **Reworded anchor** — an upstream string that no longer matches a `from`
  entry makes `transform()` throw `"Kilo branding no longer matches"`. Loud, but
  fragile: routine upstream rewording breaks dev/build or the branding tests.
- **New unlisted user-visible string** — upstream text that no entry covers
  passes through unbranded. This is the genuine hidden regression: the user sees
  "OpenCode" in Kilo and no check complains.

The list exists to avoid the opposite failure: a **blanket `OpenCode` -> `Kilo`
replacement over-replaces** code that is not branding — `@opencode/*` imports,
`opencode.*` command/keybind IDs, provider/model IDs, theme schema URLs, the
OAuth bootstrap, and the executable-resolution anchors `command: "opencode"` /
`OPENCODE_CLI_NAME`. Both migration skills forbid blanket replacement for
exactly this reason.

Design goal: get the dynamism and automatic coverage of a pattern-based
approach **without** blanket over-replacement and **without** abandoning the v2
pristine-source invariant (`migration-tracking/principles.md` section 1).

## 2. Non-goals

- **Not** adopting v1's merge-time bake. We do not re-enable
  `transforms.branding` (`script/upstream/utils/config.ts:210`), do not commit
  rebranded upstream files, and do not change `principles.md`. Source stays
  byte-identical to the pin; `check-opencode-annotations.ts` and
  `check-shared-patches.ts` remain unaffected because nothing Kilo lands in
  shared files.
- **Not** a public API/generator redesign. The change is internal to the
  Kilo-owned loader. (The `v2-feature-placement` skill notes an API/generator
  redesign needs approval; this refactor is loader-internal and preserves the
  direction and upstream-default rules, so it does not trigger that gate. Flag
  for confirmation anyway.)

## 3. Key insight: the loader does three different jobs

`text.ts` today conflates three concerns under one "replacements" list. The
refactor separates them, because only the first should be dynamic:

| Job                               | Examples in `text.ts`                                                                                                                                                                    | Nature                                                   | Target design                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| **T. Product text**               | `"OpenCode command line interface"`, help strings, `"Tell OpenCode what to do differently"`, UI labels, `opencode.ai`, github URLs, titles                                               | User-visible strings; many; reworded often upstream      | **Rule engine** (dynamic)                                                  |
| **M. Structural / logic mirrors** | `update-preflight.tsx` monogram rewrite, `tui/src/component/logo.tsx` import+logic swaps, `tui/src/util/presentation.ts` compact-logo branch, the `logo.ts` AST re-export in `plugin.ts` | Rewrites imports/logic to wire Kilo's logo art; not text | **Explicit anchored transforms** (stay brittle on purpose, few, fail-loud) |
| **W. OAuth wordmark**             | the `WORDMARK = \`<svg…>\``regex swap in`transform()`                                                                                                                                    | Structured artwork swap                                  | **Explicit anchored transform**                                            |

The user's pain is entirely in **T**. **M** and **W** are small, logic-bearing,
and _should_ fail loudly when upstream moves — an exact anchor is the correct
tool for them. Mixing them into the same list is what makes the list feel both
brittle and incomplete. Splitting them is half the fix.

## 4. Proposed architecture

```
packages/kilo-cli/src/branding/
  rules.ts        # NEW: rule data (literal maps, word rules, protected allowlist, file scope)
  engine.ts       # NEW: scoped text transform (AST span detection + rule application)
  structural.ts   # NEW: M + W anchored transforms (moved out of text.ts)
  text.ts         # SHRINKS to: transform() = structural.apply() then engine.apply(); re-export
  plugin.ts       # unchanged shape; logo.ts AST handler moves into structural.ts
  preload.ts      # unchanged
  logo-art.ts     # unchanged
  script/branding-audit.ts   # NEW: coverage audit over pinned upstream
```

`transform(file, source)` becomes: apply the structural transforms registered
for `file` (anchored, fail-loud), then run the rule engine over the result.
Files with no structural entry just get the engine. The public surface
(`KiloBranding.transform`, used by `plugin.ts` and the tests) is preserved.

### 4.1 Rule engine (`engine.ts`)

Two layers: **scope detection** then **rule application**. Scope detection
exists so rules never touch identifiers, import specifiers, or code structure.

**Scope detection (AST, Babel — already a loader dependency).** Parse the source
(TS or TSX) and collect transformable spans:

- string literals, **except** those that are import/export module specifiers;
- template literal quasis (static text only, never expressions);
- JSX text;
- comments (help text sometimes lives here).

Everything else (identifiers, member expressions, JSX attribute _names_, object
keys) is never visited. This is what cleanly excludes `@opencode/core` imports,
`OpenCode` used as a type/identifier, and `opencode` member access.

**Protected-literal allowlist (applied before any rule, skips the whole span).**
Some string literals are data/IDs, not display text, and must survive untouched
even though they are string literals:

- matches `@opencode/` (import-like specifiers that slipped through as data);
- dotted IDs: `/^opencode\.[a-z][\w.]*$/` and `/\bopencode\.[a-z]/` for
  command/keybind/event IDs (e.g. `"opencode.app.exit"`);
- a literal exactly equal to `opencode` (executable-resolution anchor:
  `command: "opencode"`, and any bare name token) — never rewritten;
- the env-name anchor `OPENCODE_CLI_NAME` and other `OPENCODE_*` env names;
- provider/model IDs, theme schema URLs, and wire identifiers enumerated in an
  explicit `PROTECTED` set (seeded from the anchors `branding.test.ts` already
  guards at lines 33–98).

**Rules (applied in order, within each surviving span):**

1. **Literal map** (longest-match-first, exact): URLs and config names that do
   not map by a simple word swap. Seeded from today's list:
   - `https://opencode.ai/v2/docs` -> `https://kilo.ai/docs`
   - `opencode.ai` -> `kilo.ai`
   - `github.com/anomalyco/opencode` -> `github.com/Kilo-Org/kilocode`
   - `https://github.com/anomalyco/opencode/issues/new` -> `https://github.com/Kilo-Org/kilocode/issues/new`
   - `opencode.json` -> `KiloConfigFiles.newFile` (derived from the host config
     filename definition, never hardcoded)
   - `` `OC |  `` -> `` `Kilo |  `` (terminal title prefix)
2. **Word rule** (case-aware, word boundary): `\bOpenCode\b` -> `Kilo`.
3. **Command-token rule** (guarded): `opencode` -> `kilo2` **only** when it is
   embedded in display text, recognised by an adjacent display context — a
   trailing space (`"opencode "`), a wrapping backtick/`${bold}…${reset}`, a
   trailing `:` (`"opencode acp:"`), or surrounding prose. A span whose entire
   value is `opencode` was already removed by the allowlist, so
   `command: "opencode"` is safe. This guard is the crux: it is what lets the
   command rename be dynamic without hitting the executable anchor.

Precedence (map before word before command-token) prevents double-rewriting
(e.g. `opencode.ai` is consumed by the map before the command-token rule sees
`opencode`).

### 4.2 Structural transforms (`structural.ts`)

Move the logic-bearing entries out of `text.ts` verbatim as named, anchored
transforms, each with its own fail-on-drift message:

- `logo.ts` export rewrite (currently the first `onLoad` in `plugin.ts`);
- `update-preflight.tsx` monogram import + logic rewrite;
- `tui/src/component/logo.tsx` import + theme/ink logic rewrite;
- `tui/src/util/presentation.ts` compact-logo branch;
- OAuth `WORDMARK` SVG swap.

These keep exact anchors deliberately: when upstream moves logo/preflight logic
we _want_ a loud failure and a human to re-inspect, exactly as the branding
section of the `v2-feature-placement` skill requires.

### 4.3 File scope

The engine runs on a configured scope of user-facing files (the TUI/CLI/core
surface the current list already enumerates), not the whole tree. Scope lives in
`rules.ts` as an explicit glob/path set so the audit and the loader share one
source of truth. Files entirely outside scope are passed through unchanged.

## 5. Coverage audit (`script/branding-audit.ts`)

The structural fix for hidden regressions. The audit:

1. resolves the pinned upstream commit (`pinned()` from
   `script/upstream/utils/upstream.ts`), with no network;
2. reads the in-scope files at that pin;
3. runs the rule engine + structural transforms;
4. reports any residual user-visible `OpenCode` / `opencode` / `opencode.ai`
   token that remains in a transformable span and is not in `PROTECTED`;
5. exits non-zero when it finds residuals, with file:line and the offending
   span.

Wiring: a package script (`branding:audit`), a `bun test` wrapper so it runs
with the suite, and a step in `.github/workflows/kilo-v2.yml`. It also becomes a
documented step in the sync checklist (`.kilo/agent/upstream-merge.md` /
`v2-migration` skill "Branding and upstream drift"), replacing the "proposed"
audit the skills currently describe.

Net effect on the two failure modes:

- **Reworded anchor (T):** no longer throws, because the engine matches patterns,
  not fixed strings. Structural (M/W) still throws, as intended.
- **New unlisted string (T):** either the engine brands it automatically, or the
  audit flags it. No silent passthrough.

## 6. Test migration

Current tests iterate `KiloBranding.replacements`. New coverage:

- **Parity golden test (migration safety):** during phase 1, assert the new
  `transform()` produces byte-identical output to the old exact-list `transform()`
  over every in-scope pinned upstream file. This is the proof the refactor is
  behaviour-preserving before the list is deleted.
- **Engine unit tests:** representative spans for each rule and precedence;
  case preservation (`OpenCode`/`opencode`).
- **Protected-anchor tests:** port `branding.test.ts` lines 33–98 — provider
  identities, theme schema, wire IDs, `@opencode/*` imports, `command: "opencode"`,
  `OPENCODE_CLI_NAME` all unchanged.
- **Preserve existing hard guards:** source + compiled parity, TSX through the
  Solid compiler, OAuth HTML escaping and autoClose (`checkPages`), logo guard
  (`logo-guard.test.ts`), preflight (`logo-preflight.test.ts`), cli-name, acp-wire,
  theme-render.
- **Audit test:** a fixture with a planted unbranded string fails the audit; a
  clean fixture passes.

## 7. Rollout (phased, each phase green on `bun run check` + `packages/kilo-cli` tests)

1. **Scaffold, prove parity.** Add `engine.ts`, `rules.ts`, `structural.ts`.
   Recompose `transform()` to `structural -> engine`. Seed rules so the parity
   golden test passes against the current list. `text.ts` still holds the data
   during this phase.
2. **Flip to rules.** Replace the exact text entries with the rule set; keep M/W
   explicit; grow `PROTECTED` and the command-token guard until parity holds and
   every protected anchor is unchanged.
3. **Audit.** Add `branding-audit.ts`, its test, the package script, CI step,
   and sync-checklist doc update.
4. **Delete dead data.** Remove the exact text list; update
   `migration-tracking/progress/dispositions.json` (the `oauth/page.ts` note and
   any branding cell notes) to describe the engine; update the branding
   description in the `v2-migration` / `v2-feature-placement` skills from
   "exact-list interim adapter" to "rule engine + audit".

## 8. Risks and mitigations

- **Over-replacement regression.** Mitigated by AST scoping + explicit
  `PROTECTED` + the command-token display-context guard + the ported
  protected-anchor tests. The `command: "opencode"` and `OPENCODE_CLI_NAME`
  anchors are the known-subtle cases and get dedicated tests.
- **Parity drift during migration.** The phase-1 golden test blocks the list
  deletion until output matches byte-for-byte.
- **Performance.** The engine parses with Babel per in-scope file on load; the
  loader already does Babel work for TSX, and the compiled binary bakes results
  once, so steady-state runtime cost is unchanged.
- **Principle/placement.** No shared-file change, no principle change, loader
  stays Kilo-owned (rung 5 branding + rung 2 host wiring). `check-*` scripts
  unaffected. Confirm the API-redesign gate does not apply (it is loader-internal).

## 9. Decisions (resolved with the user, 2026-11-02)

1. **Scope source of truth — broader glob.** `rules.ts` defines scope as a glob
   set over the TUI + CLI + core user-facing surface, not a hand-enumerated path
   list, so new upstream files are covered automatically. The glob is paired with
   the hard-fail audit (decision 2), which catches anything the scope picks up but
   the rules do not cover.
2. **Audit severity — hard-fail.** The audit exits non-zero in CI and at sync
   time on any uncovered user-visible OpenCode token. A trivial new string can
   block a sync; the fix is to extend a rule or `PROTECTED`, which is the intended
   workflow.
3. **Command-token guard — display-context heuristic, with the hard-fail audit
   as the backstop.** The lowercase `opencode` command rename uses the
   display-context heuristic (adjacent space / backtick / `${…}` wrap / trailing
   `:` / surrounding prose), not a hand-maintained override list. Rationale: AST
   scoping + `PROTECTED` already exclude imports, dotted IDs, and the bare
   `"opencode"` executable anchor (`command: "opencode"`, `OPENCODE_CLI_NAME`). A
   _false negative_ (missed lowercase usage) becomes a loud audit failure rather
   than a silent regression, so the only residual risk is a _false positive_,
   covered by `PROTECTED` and the ported anchor tests. If a false positive ever
   appears, add that one string to `PROTECTED` — far less maintenance than the
   current full exact list. The explicit-override-list alternative is the fallback
   only if a false positive proves recurrent and hard to express in `PROTECTED`.
4. **API-gate — not triggered; approved.** This is an internal refactor of
   Kilo-owned loader code: same Bun loader, same load/build-time application, same
   byte-identical upstream source, same public `KiloBranding.transform` surface, no
   generation into separate committed files, no change to the direction or
   upstream-default rules. It does not weaken any v2 invariant, so the skill's
   "API/generator redesign requires approval" guardrail does not apply. Recorded
   here as a conscious, user-approved change for future sync reviewers.

## 10. Why not the v1 (merge-time bake) approach

The useful part of v1 is its _dynamism_ (regex/pattern rules), not its
_placement_ (baking branding into committed files at merge time). Those are
separable, and only the placement conflicts with v2.

1. **Opposite merge philosophies.** v1 does periodic heavy merges and accepts
   committed divergence from upstream, regenerating branding each time. v2 keeps
   every shared file byte-identical to the pinned release to minimise conflict,
   and syncs _every_ upstream release. Baked-in branding would conflict on the
   same lines as real upstream edits on every sync.
2. **Direction rule.** Committed rebranded shared files are hundreds-to-thousands
   of unmarked Kilo changes in upstream-owned files, failing
   `check-opencode-annotations.ts` / `check-shared-patches.ts` and upstream's own
   tests that assert "OpenCode" strings. Accommodating it means gutting the checks
   that make v2 syncs cheap. Violates `principles.md` section 1.
3. **Already deliberately off.** v1's `transform-take-theirs.ts` exists in this
   repo but is gated off (`transforms.branding: false`, `config.ts:210`). "Apply
   v1" means re-enabling merge-time baking, which the `v2-feature-placement` skill
   explicitly refuses as a replacement for the loader.
4. **The brittleness is the exact list, not "script-based".** v1 is less brittle
   because it uses regex patterns. The rule engine takes that same dynamism and
   runs it at load/build time over pristine source: v1's benefit, v2's placement.
   The audit also gives better coverage than v1 ever had (continuous in CI vs
   only at merge time).

v1's one genuine advantage — WYSIWYG committed source, no loader indirection — is
not worth reintroducing per-sync conflicts on every shared file and dismantling
the two checks that keep v2 syncs tractable.
