# Config Transformation Fixtures

Each directory is an operation, with a flat list of files grouped by case-name prefixes. Add a case without adding another
test body; the runners discover `*-input.*` files in sorted order.

## Operations

| Directory | Inputs | Expected outputs | Operation |
|---|---|---|---|
| `read/` | `<name>-input.jsonc` | `<name>-output.json` | Parse JSONC, lower supported V2 fields, and decode the V1 schema. |
| `update-global/` | `<name>-input.json` or `.jsonc`, `<name>-patch.json` | `<name>-output.json` or `.jsonc`, `<name>-normalized.json` | Write an isolated global file and invoke the real `Config.updateGlobal` service. |
| `update-project/` | `<name>-input.json`, `<name>-patch.json` | `<name>-output.json`, `<name>-normalized.json` | Write an isolated project `kilo.json` (kilocode_change) and invoke the real `Config.update` service. |

Read outputs capture the complete decoded document, including V1 schema defaults, but not environment-dependent runtime
defaults such as the OS username. The read runner also checks that lowering did not mutate its input.

Kilo divergence (kilocode_change): Kilo's core config schema injects `experimental.openTelemetry: true` by default
(`packages/core/src/v1/config/config.ts`). Upstream OpenCode leaves `openTelemetry` optional with no default. The read
outputs that contain an `experimental` object therefore include `"openTelemetry": true` to match Kilo's decoded output.
This is an intentional Kilo default, not a merge defect.

Kilo divergence (kilocode_change): project updates target `kilo.json` instead of upstream's `config.json`. Kilo's project
config file set is `kilo.jsonc`, `kilo.json`, `opencode.jsonc`, and `opencode.json`; `config.json` is only a global
(and last-resort) candidate. The `update-project` fixtures below assume that path.

Kilo divergence (kilocode_change): Kilo's merge utilities call `stripNulls`, which drops objects left empty after removing
null delete sentinels (`packages/opencode/src/kilocode/config/config.ts`). The decoded patch for `agent.reviewer.disable`
therefore loses its empty `options` and `permission` objects in the written `v1-overrides` outputs. The in-memory
`-normalized.json` output still shows them because decoding the saved document reapplies those V1 schema defaults. This is
intentional Kilo behavior, not a merge defect.

For updates, `<name>-output.*` is the exact text written by the service, including comments, formatting, and the presence or
absence of a final newline. `<name>-normalized.json` records the V1 config returned by `updateGlobal`, or the decoded saved file
for project updates (which return no config). Native V2 data can remain in the saved file even when it is absent or has a
different shape in the in-memory V1 output.

These are checked-in expectations, not output generated during ordinary test runs. Missing expectations fail the test.
Focused tests separately cover invalid inputs, diagnostics, secret redaction, logging, and cross-source behavior.

## Run

From `packages/opencode`:

```sh
bun test test/config/v2-compat.test.ts test/config/config.test.ts --timeout 30000
```

To intentionally regenerate expected outputs:

```sh
UPDATE_CONFIG_FIXTURES=1 bun test test/config/v2-compat.test.ts test/config/config.test.ts --timeout 30000
```

Review every changed `*-output.*` and `*-normalized.json` before accepting it. Do not run a formatter on update outputs; their
exact formatting is part of the snapshot. Inputs are authored by hand and are never rewritten by the fixture runner.
