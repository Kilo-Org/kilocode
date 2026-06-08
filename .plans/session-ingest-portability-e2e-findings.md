# Session Ingest Diff Portability E2E Findings

Date: 2026-06-08

PR under test: https://github.com/Kilo-Org/kilocode/pull/10948

Local ingest override:

```sh
KILO_SESSION_INGEST_URL=http://localhost:8800
```

This override is read by the CLI sync path in `packages/opencode/src/kilo-sessions/kilo-sessions.ts`, by `kilo import` in `packages/opencode/src/cli/cmd/import.ts`, and by `@kilocode/kilo-gateway` in `packages/kilo-gateway/src/cloud-sessions.ts`.

## E2E Run

The successful run used three tmux-backed CLI servers, each with isolated `XDG_*` and `KILO_DB` directories:

- `cli1`: `127.0.0.1:48931`
- `cli2`: `127.0.0.1:48932`
- `cli3`: `127.0.0.1:48933`

Run artifact:

```text
/var/folders/pz/_kmbp8vs2755j415slh2hz100000gn/T/kilo-session-ingest-e2e-2026-06-08T12-32-56-062Z
```

Sensitive launcher files were removed from the artifact. The remaining repo folders and server logs were left in place for inspection.

Flow:

1. Created one base git repo and cloned it into `cli1`, `cli2`, and `cli3`.
2. `cli1` created a 100-file diff with 100 lines per file under `e2e/cli1`.
3. Seeded the local session-ingest service with the `cli1` session export payload and verified `/api/session/:id/export` returned `sessionDiff.length === 100`.
4. `cli2` imported the `cli1` session through `POST /kilo/cloud/session/import` and `x-kilo-directory`.
5. Asserted `cli2` had all 100 `e2e/cli1` files with 100 lines each.
6. `cli2` created a second 100-file diff with 100 lines per file under `e2e/cli2`.
7. Seeded the local session-ingest service with a second session containing only the `cli2` diff and verified export returned `sessionDiff.length === 100`.
8. `cli3` imported the second session through `POST /kilo/cloud/session/import` and `x-kilo-directory`.
9. Asserted `cli3` had all 100 `e2e/cli2` files with 100 lines each.
10. Checked whether `cli3` also had the ancestor `e2e/cli1` files.

Result:

```json
{
  "cli1Session": "ses_k5SaVWUMb18AXmwPGKb0AM5SMw",
  "cli2Session": "ses_R8hZAKsPAxpA0ZTPSw0wAEMKtw",
  "cli2ImportedCli1": true,
  "cli3ImportedCli2": true,
  "cli3HasCli1AncestorFiles": false
}
```

## Findings

### 1. Nested fork cumulative diffs now restore through a 5-session chain

Initial testing showed `cli2` correctly restored `cli1`'s 100-file diff and `cli3` correctly restored `cli2`'s 100-file diff, but `cli3` did not restore `cli1`'s ancestor files when the second export contained only `cli2`'s new diff.

The opencode server now preserves imported diffs as a base layer and sends `base + local` as the cloud `session_diff`. A follow-up e2e run created a 5-session chain and imported the fifth session into a clean verifier workspace.

Passing run artifact:

```text
/var/folders/pz/_kmbp8vs2755j415slh2hz100000gn/T/kilo-session-ingest-chain5-2026-06-08T13-02-17-124Z
```

Result:

```json
{
  "sessions": [
    "ses_n9PWIGocAGrjP5mQAODs3fclZg",
    "ses_158ac4c56ffe6eaWzTUsnVgnSZ",
    "ses_158ac3cc0ffeB5HGLUlkUmT1nK",
    "ses_158ac28abffeYW21k35bwFrLRk",
    "ses_158ac13beffexNmX7aNonFse8M"
  ],
  "verifierSession": "ses_158abfa10ffeetXDlbBKHmX706",
  "finalDiffCount": 500,
  "replicatedLabels": 5
}
```

The verifier import restored all five labels (`cli1` through `cli5`), each with 100 files and 100 lines per file.

Remaining action item:

- Add a durable automated e2e/regression test that imports `A -> B -> C -> D -> E` and asserts `E` contains all ancestor filesystem changes. The local tmux/service test is strong manual evidence, but it depends on the local session-ingest stack.

### 2. Local service auth is not compatible with plain CLI sync by URL override alone

Setting only `KILO_SESSION_INGEST_URL=http://localhost:8800` is not enough for the normal CLI share/sync path against the local service. The local session-ingest service expects an internal Kilo JWT signed with `NEXTAUTH_SECRET_PROD` and backed by an existing `kilocode_users` row. The CLI's normal Kilo auth token returned `401 Invalid or expired token`.

For the e2e run, I used a local-only internal JWT to seed and import sessions. That exercised the local service and the PR import/restore path, but it bypassed normal `KiloSessions.share()` ingestion from the CLI because that path also validates the Kilo auth context before syncing.

Action items:

- Add a local-dev auth path for session-ingest testing, such as `KILO_SESSION_INGEST_TOKEN`, or document how to point both Kilo API auth validation and session-ingest at the same local token source.
- Improve `KILO_SESSION_INGEST_URL` docs to state that URL override alone does not override auth.
- Consider making local import/share failures surface the upstream 401 body instead of collapsing into a generic server error.

### 3. The original tmux launch form left high-CPU orphaned Bun processes

The initial launcher used:

```sh
bun run --cwd packages/opencode --conditions=browser src/index.ts --print-logs serve ...
```

Those processes failed to become usable servers and kept running at roughly one CPU core each after tmux cleanup. They were killed with `SIGKILL`.

The working launcher used:

```sh
bun --conditions=browser packages/opencode/src/index.ts serve ...
```

That form started normally and had low CPU use.

Action items:

- Use the direct `bun --conditions=browser ... src/index.ts serve` form in local e2e scripts.
- Add process cleanup by command-line match and verify no leftover serve processes after tmux session teardown.
