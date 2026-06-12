# OpenCode Mentions Review

## Scope and methodology

Reviewed PR #11090 at head `6a1377abaa88902b741f3ffff276aa6b743f3a3c` against reviewed base and current `origin/main` `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`. The local pristine upstream `v1.15.4` tag was used to distinguish inherited OpenCode content from Kilo's final merged state.

The review covered the 270 files in `b90ab85c3b4ad5097fe11e431d0319f31f935d6e...6a1377abaa88902b741f3ffff276aa6b743f3a3c`. Searches examined added lines and final file contents for case variants of OpenCode, OpenCode domains and repositories, URLs, CLI command names, config names, package metadata, error/help text, TUI strings, docs, extension files, publish/install scripts, and generated SDK/OpenAPI descriptions. Candidate matches were followed into their runtime consumers or compared with the base revision where their classification was unclear.

No merge-introduced OpenCode product-branding regression was found. Two categories of user-facing OpenCode references remain in changed files, but both predate this PR.

## Findings

### Medium - Existing TUI tips advertise a trigger the Kilo workflow does not accept

`packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:246` tells users to invoke `/opencode`, and `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:248` recommends `/opencode fix this`. The installed Kilo workflow listens for `/kilo` and `/kc` at `packages/opencode/src/cli/cmd/github.ts:397`, `packages/opencode/src/cli/cmd/github.ts:398`, and `packages/opencode/src/cli/cmd/github.ts:801`.

This is visible competitor branding and, for the generated Kilo workflow, incorrect operating guidance. The two tip strings are byte-for-byte present in the reviewed base, so this is not introduced by PR #11090. It is reported because the PR changes the same TUI tip list and restores the user-facing `kilo github` command while leaving the conflicting guidance in the final surface.

### Low - Human verification: config descriptions still link to OpenCode documentation

The command and agent config descriptions point to OpenCode web properties at `packages/opencode/src/config/config.ts:166` and `packages/opencode/src/config/config.ts:279`.

Both links are unchanged from the reviewed base, and the repository's Kilo CLI documentation explicitly uses OpenCode documentation for comprehensive fork-compatible config details. They may therefore be intentional upstream compatibility references rather than branding leaks. Human confirmation is warranted because these schema annotations can be presented to users by config tooling, while most adjacent config descriptions and schema defaults are Kilo-branded. Neither link is present in the checked-in v2 OpenAPI document or generated TypeScript SDK at this head.

## Notable non-findings

- The final checked-in `packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/sdk.gen.ts`, and `packages/sdk/js/src/v2/gen/types.gen.ts` contain zero case-insensitive `opencode` matches. The pristine upstream `v1.15.4` versions contain OpenCode API titles, descriptions, examples, and client names; the Kilo head removes those matches rather than carrying them into generated user-facing output.
- Root, `web`, and `github` help output consistently uses `kilo`, `Kilo`, and `kilo.local`. The restored commands appear as `kilo web` and `kilo github`; no OpenCode product name or OpenCode web property appeared in the exercised help output.
- CLI errors move in the correct direction: `packages/opencode/src/cli/error.ts:45` removes the OpenCode-specific MCP capability sentence, and `packages/opencode/src/cli/error.ts:72` directs users to `kilo.json`. Regression assertions at `packages/opencode/test/kilocode/cli/error.test.ts:8` and `packages/opencode/test/kilocode/cli/error.test.ts:25` explicitly reject the old wording.
- Publish and install surfaces remain Kilo-branded. Binary package selection and failure output use `@kilocode/cli-*` and `Kilo CLI` in `packages/opencode/script/postinstall.mjs:194`; generated package repository metadata points to `https://github.com/Kilo-Org/kilocode` in `packages/opencode/script/build.ts:391` and `packages/opencode/script/publish.ts:63`.
- The two URLs added by the reviewed diff are `https://kilo.ai` for the MCP client identity and `https://api.apertis.ai/v1` for a provider endpoint. No OpenCode domain or OpenCode repository URL is added.
- Remaining matches such as `@opencode-ai/*`, `@opencode/*` Effect service tags, `packages/opencode`, `.opencode`, `opencode.json`, `OPENCODE_API_KEY`, provider IDs, the `customize-opencode` skill, upstream merge comments, and OpenCode-named fixtures were classified as internal identity, supported compatibility surface, provider identity, upstream attribution, or test/spec material. None is newly presented as the Kilo product name by this merge.
- The changed VS Code file only adds a duplicated `TerminalFont` type declaration and introduces no product text or URL. The changed Kilo docs command reference adds Kilo-branded `web` and `github` help sections.

## Command outputs

```text
$ git rev-parse HEAD
6a1377abaa88902b741f3ffff276aa6b743f3a3c

$ git rev-parse origin/main
b90ab85c3b4ad5097fe11e431d0319f31f935d6e

$ git merge-base origin/main HEAD
b90ab85c3b4ad5097fe11e431d0319f31f935d6e

$ git diff --shortstat b90ab85c3b4ad5097fe11e431d0319f31f935d6e...6a1377abaa88902b741f3ffff276aa6b743f3a3c
270 files changed, 7733 insertions(+), 3901 deletions(-)
```

```text
$ git grep -i opencode 6a1377abaa88902b741f3ffff276aa6b743f3a3c -- packages/sdk/openapi.json packages/sdk/js/src/v2/gen/sdk.gen.ts packages/sdk/js/src/v2/gen/types.gen.ts | wc -l
0

$ git diff -U0 <base>...<head> -- <source/docs/SDK paths> | rg -i '^\+[^+].*opencode' | wc -l
34

$ git diff -U0 <base>...<head> -- <source/docs/SDK paths> | rg '^\+[^+].*https?://' | wc -l
2
```

The 34 added OpenCode-bearing lines resolve to internal package imports, Effect service identifiers, provider compatibility comments, or legacy event compatibility comments. The two added URLs are the Kilo and Apertis URLs noted above.

```text
$ KILO_DISABLE_AUTOUPDATE=1 bun run --conditions=browser src/index.ts --help
Commands include: kilo, kilo serve, kilo web, kilo github, kilo console
mDNS default: kilo.local
OpenCode matches: 0

$ KILO_DISABLE_AUTOUPDATE=1 bun run --conditions=browser src/index.ts web --help
kilo web
start kilo server and open web interface
OpenCode matches: 0

$ KILO_DISABLE_AUTOUPDATE=1 bun run --conditions=browser src/index.ts github --help
kilo github
manage GitHub agent
Commands: kilo github install, kilo github run
OpenCode matches: 0
```

## Limitations

- The interactive TUI was not launched long enough to wait for randomized tips, so the two trigger strings were validated statically against the workflow generator rather than visually.
- Published npm packages and platform archives were not built or installed. Their metadata and console output were reviewed from the changed build, publish, and postinstall sources.
- The deployed `https://app.kilo.ai/config.json` schema and other cloud-generated config documentation are outside this repository and were not inspected. This is the main uncertainty behind the config-link human-verification finding.
- No extension UI was launched because the only changed extension file contains TypeScript message types and no rendered string, URL, or metadata surface.
