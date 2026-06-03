# `kilocode_change` Marker Review

## Scope and methodology

Reviewed PR [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) at snapshot `94fc42255c35827b197d97368d75d079242e9f4d` against PR base snapshot `2f7f23deac683078a350014ec8a1a946aae46ce4`, with pristine upstream target `d802b0a277f4e7f113b5efd8d5446fc1db22f4a4` (`v1.14.46`) as a read-only reference.

- Checked the complete `git diff --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4...HEAD` result: **181 changed files**.
- Reviewed every changed file for marker-bearing base content and PR-side marker state. Compared the Kilo base and reviewed snapshot marker inventories, then inspected all marker-text diffs with surrounding code.
- Compared pristine upstream where provenance mattered, especially for shared `packages/opencode/` files whose Kilo-specific behavior was retained or adapted during the merge.
- Result: **no accidental `kilocode_change` marker loss found**.

## Findings

### Marker removals that make sense

- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:300` removes a redundant inner `// kilocode_change start` / `// kilocode_change end` pair around the `suggestion.accepted`, `suggestion.dismissed`, and `suggestion.shown` cases. The cases and `handleSuggestionEvent(...)` call remain intact. They are still inside the broader Kilo-only network/suggestion block opened at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:283` and closed at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:339`, so annotation coverage is preserved while nested markers are simplified.
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:597` moves the existing inline marker from `globalConfigPromise` in the old `Promise[]` array to the equivalent labeled entry `{ name: "global.config", promise: globalConfigPromise }`. The Kilo-only global config bootstrap request remains present and annotated after the upstream bootstrap failure aggregation refactor.
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:809` moves the existing inline marker from the removed `messages.data!.map(...)` assignment to `infos.push(strip(message.info))` inside the replacement loop. The Kilo-specific `strip(...)` behavior remains present while adopting the upstream guard for undefined message responses.
- `packages/opencode/test/cli/cmd/tui/sync.test.tsx` moves the shared sync test fixture into the new `packages/opencode/test/cli/cmd/tui/sync-fixture.tsx`. The removed markers for `ToastProvider`, `/global/config`, and the JSX wrapper reappear on the extracted fixture. The new fixture also annotates Kilo-only `/network` and `/background-process` routes. This is a coherent fixture extraction, not marker loss.
- `packages/opencode/src/mcp/index.ts:49` changes the marker comment punctuation from a Unicode long dash to an ASCII hyphen around the existing Docker `--rm` injection. The marker block and `ensureDockerRm(...)` behavior are unchanged.

### Notable non-findings

- `packages/opencode/src/cli/cmd/export.ts:27` adds a correctly delimited marker block around the Kilo compatibility type that retains summary `additions` and `deletions` while accepting upstream optional `file` and `patch` values.
- `packages/opencode/src/share/share-next.ts:90` adds a correctly delimited marker block for the Kilo share transport compatibility filter used when stored legacy summary diffs omit `file` details.
- `packages/opencode/src/server/routes/instance/httpapi/public.ts:64` adds an inline marker for the Kilo cloud sessions `limit` query override. Existing Kilo OpenAPI markers remain present, including cloud cursor handling, Kilo server docs metadata, indexing nullability overrides, background-process IDs, and network request IDs.
- `packages/sdk/js/src/error-interceptor.ts:41` adds an inline marker for the Kilo-branded empty-body fallback (`kilo server ...`). The file is new SDK code and the Kilo-only branding difference is explicitly marked.
- No changed file was deleted. Rename handling reports the two schema utility moves at 100% similarity, and neither move loses markers.

## Human verification items

- None required for marker preservation. The only removed marker pair is the redundant nested pair in `packages/opencode/src/cli/cmd/tui/context/sync.tsx`, and the surrounding broader Kilo block clearly remains.

## Command outputs

```text
$ git rev-parse HEAD
94fc42255c35827b197d97368d75d079242e9f4d

$ git rev-parse 2f7f23deac683078a350014ec8a1a946aae46ce4
2f7f23deac683078a350014ec8a1a946aae46ce4

$ git -C <pristine-upstream> rev-parse HEAD
d802b0a277f4e7f113b5efd8d5446fc1db22f4a4

$ git -C <pristine-upstream> describe --always --tags HEAD
v1.14.46

$ git diff --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4...HEAD | wc -l
181

$ git diff --shortstat 2f7f23deac683078a350014ec8a1a946aae46ce4...HEAD
181 files changed, 5028 insertions(+), 2498 deletions(-)

$ git diff --name-status -Gkilocode_change 2f7f23deac683078a350014ec8a1a946aae46ce4...HEAD | wc -l
9

$ bun run script/check-opencode-annotations.ts
Skipping shared upstream annotation check — upstream merge detected.

$ git diff --check 2f7f23deac683078a350014ec8a1a946aae46ce4...HEAD
(no output)
```

## Limitations

- `bun run script/check-opencode-annotations.ts` intentionally skips shared upstream annotation validation when an upstream merge is detected, so this report relies on manual file-by-file diff review, marker inventory comparison, targeted marker-text diffs, and pristine-upstream comparison rather than the guard script.
- This report reviews marker preservation and marker placement changes only. It does not claim broader semantic correctness of the upstream merge or generated artifacts.
