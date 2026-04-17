---
title: "CLI Config Schema"
description: "How the Kilo CLI config JSON Schema is served at app.kilo.ai/config.json"
---

# CLI Config Schema

The JSON Schema referenced by `"$schema": "https://app.kilo.ai/config.json"` in `kilo.json` files is served by the cloud repo. It is a runtime overlay of the upstream opencode schema with Kilo-specific additions on top.

## Flow

1. Client fetches `https://app.kilo.ai/config.json`.
2. Cloud route `apps/web/src/app/config.json/route.ts` fetches `https://opencode.ai/config.json`, runs `merge()` on it, and returns the result.
3. `merge()` overlays three sections from `apps/web/src/app/config.json/extras.ts`:
   - `top` — top-level keys like `commit_message`, `remote_control`, nullable `model` / `small_model`
   - `agents` — Kilo primary agents (`ask`, `debug`, `orchestrator`)
   - `experimental` — `codebase_search`, `openTelemetry`

## Adding a new Kilo-only config key

The source of truth is the zod schema in `packages/opencode/src/config/config.ts`. The cloud overlay must match it.

1. Add the zod field with a `kilocode_change` marker in `config.ts`.
2. Generate the JSON Schema shape: `bun --bun packages/opencode/script/schema.ts /tmp/kilo.json`, then `jq '.properties.<new_key>' /tmp/kilo.json`.
3. Paste the shape into the correct bucket in `apps/web/src/app/config.json/extras.ts` in the [cloud repo](https://github.com/Kilo-Org/cloud).
   - Top-level → `top`; under `experimental` → `experimental`; new primary agent → `agents`; anywhere else → add a new bucket and extend `merge()` in `route.ts`.
4. Add an assertion in `apps/web/src/tests/cli-config-schema.test.ts`.

If step 3 is skipped, users with `$schema: https://app.kilo.ai/config.json` will see "unknown property" warnings for the new key.

## Caching

The cloud route caches the upstream fetch for 1 hour (`next: { revalidate: 3600 }`) and emits `s-maxage=3600, stale-while-revalidate=3600`, so the response is served from the Cloudflare + Vercel edge cache for all but one request per hour per region.
