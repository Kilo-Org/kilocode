# OpenCode Branding Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

The release-impacting branding findings from the first pass are fixed. One low-severity generated-schema occurrence remains.

## Finding

### Low: generated OpenAPI retains the old V2 title

The source at `packages/server/src/api.ts:34` now correctly uses `kilo experimental HttpApi`, but `packages/sdk/openapi.json` still contains `opencode experimental HttpApi` for the new `/api/health` and `/api/agent` operations and duplicate tag declarations. Regenerate the OpenAPI artifact after the source title change and verify the committed tags use Kilo branding.

## Resolved first-pass findings

- `packages/opencode/src/cli/cmd/github.handler.ts` now uses `kilo.ai`, `dev.kilo.ai`, and `api.kilo.ai` for share and OIDC defaults.
- `packages/core/src/plugin/command/initialize.txt` now says Kilo and references `kilo.json`; its shared-file ownership issue is tracked in `KILOCODE_CHANGE_MARKERS.md`.
- The Snowflake Cortex credential error now recommends `kilo auth`.
- Generated source links reflect the corrected Kilo URLs.

## Accepted by design

- The private `@opencode-ai/server` package's standalone Basic Auth default remains `opencode`, but `kilo serve` uses the Kilo auth layer and does not mount the standalone path. Revisit before publishing or adopting that package surface.
- Root `CONTEXT.md` uses OpenCode as developer-facing upstream runtime terminology and is not shipped UI, CLI output, model input, or end-user documentation.
- Package/import names, provider IDs, compatibility filenames, environment variables, upstream attribution, tests, and fixtures were not treated as product branding regressions.

## Commands and limitations

The review searched added lines and exact-ref blobs for OpenCode names, web properties, auth commands, config names, API titles, package metadata, generated schemas, UI strings, and reachable runtime errors. No CLI, GitHub Action, generator, or UI runtime was executed. Current generated-artifact CI is green despite the stale title, indicating the committed schema is reproducible from another still-stale generation input or was not regenerated after the source-only fix.
