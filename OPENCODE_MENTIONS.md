# OpenCode Mention Audit: PR #12204, Second Pass

Reviewed PR HEAD `2d92d8dae2cb2d9efc4961b020dabb11ff5564aa` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Finding

### Medium: README advertises a private package as a public OpenCode beta

`packages/http-recorder/package.json:8` now correctly marks `@opencode-ai/http-recorder` private, but `packages/http-recorder/README.md:7-13` describes a public beta and tells external users to install `@opencode-ai/http-recorder@beta`.

This contradicts package metadata and newly exposes the OpenCode-scoped identity in user-facing installation instructions. If the package remains private, restore internal-package framing and remove the beta installation instructions. If Kilo intends to publish it, make the ownership and package identity explicit.

No other actionable user-facing OpenCode mention introduced or restored by this PR was found.

## Resolved Since First Pass

- Public publication is disabled by restoring `private: true` and removing `publishConfig.access`.
- Repository, homepage, and issue metadata point to Kilo rather than `anomalyco/opencode`.
- The latest forbidden-string check passes at the audited SHA: `8332 file(s) checked, no forbidden strings found`.

## Notable Non-Findings

- No user-facing OpenCode addition was found in generated SDK/OpenAPI output, CLI help snapshots, or Kilo CLI documentation.
- Theme URLs are content-preserving renames from the previous TUI location.
- OpenCode tips remain disabled; active tips come from Kilo's plugin.
- Internal `@opencode-ai/*` imports, provider IDs, compatibility filenames, service tags, and upstream copyright attribution are not branding leaks.

The forbidden-string checker intentionally covers exact legacy strings and does not flag the README package instruction. This was a static diff and CI-log audit; no package was packed or published.
