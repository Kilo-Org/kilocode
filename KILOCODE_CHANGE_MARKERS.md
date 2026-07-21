# `kilocode_change` Marker Audit: OpenCode v1.17.5 Merge (PR #12404)

## Scope and Methodology

Reviewed all 194 files in `git diff --name-only origin/main...HEAD` for PR #12404, with particular attention to every changed shared-upstream file containing a `kilocode_change` marker on either side of the merge.

`origin/main` has advanced since this merge branch was created. Git topology identifies `084bceadaedf193568ccf71256bd299c0d11e90c` as the merge base of current `origin/main` and `HEAD`, so that commit was used as the effective pre-merge Kilo baseline. The supplied `kilo-main` worktree is at `12147d1602a6dd59647085e56226a815592cff08`, the recorded upstream-merge commit whose first parent is that baseline. Pristine upstream was verified as tag `v1.17.5`.

Method:

- Enumerated the 194 changed paths from the PR diff.
- Compared each path's marker presence and, for all 36 marker-bearing changed files, inspected marker additions, removals, and movement in the contextual diff.
- Compared the marker-changing shared files against the supplied pre-merge and pristine-upstream worktrees.
- Checked commit attribution for the marker-changing paths and validated the final marker locations in `HEAD`.

## Findings

No actual or suspected accidentally removed `kilocode_change` markers were found. No items need human verification from this marker audit.

## Notable Non-Findings

- `packages/core/src/connector.ts` and `packages/core/test/connector.test.ts` were deleted by upstream's integration/credential rewrite. The Kilo OAuth settlement, timeout, cancellation, and persistence guards were correctly re-applied to `packages/core/src/integration.ts` with 12 new markers. The final repair commit is `06d871409b fix: restore oauth attempt settlement guards in integration`.
- `packages/core/src/credential.ts` has fewer individual markers because upstream removed connector selection and lifecycle-event semantics. The remaining Kilo behavior was ported to the integration-shaped credential model: account JSON import, `auth.json` reconciliation and dual writes, `KILO_AUTH_CONTENT` process-local credentials, and isolated create/update/remove behavior are all still enclosed or line-marked.
- The two deleted SQL migration files were replaced by Kilo-marked TypeScript migrations with the same IDs:
  `packages/core/src/database/migration/20260603040000_session_message_projection_order.ts` retains the `seq` projection migration, and `packages/core/src/database/migration/20260714141136_session-message-legacy-writer-compat.ts` retains the legacy writer-compatible nullable `seq` table rebuild.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts` moved from explicit default-layer assembly to upstream's `LayerNode` composition. Marker count dropped from 24 to 19 only because upstream service entries such as `Git` are now unmodified upstream nodes. Kilo-specific services and routes remain marked, including `ModelCache`, credentials, memory, Agent Manager, notebook, viewers, sync events, reference reconciliation, and listener routes.
- The new markers in `packages/core/src/database/database.ts` (lazy `KILO_DB` path resolution), `packages/opencode/src/effect/app-runtime.ts` (ProjectCopy dependency composition), and `packages/opencode/src/project/instance-store.ts` (deferred completion on interruption) all enclose Kilo-specific behavior rather than upstream code.
- Root patch-entry cleanup and the HTTP recorder package changes did not introduce marker changes or expose an unmarked Kilo modification in this audit scope.

## Relevant Command Excerpts

```text
$ git diff --name-only origin/main...HEAD | wc -l
194

$ git merge-base origin/main HEAD
084bceadaedf193568ccf71256bd299c0d11e90c

$ git -C .worktrees/opencode-merge/opencode describe --tags --exact-match
v1.17.5

$ git diff --check 084bceadaedf193568ccf71256bd299c0d11e90c...HEAD
(no output)
```

Marker-count differences were limited to these intentional migrations or reapplications:

```text
packages/core/migration/20260603040000_session_message_projection_order/migration.sql  1 -> 0
packages/core/migration/20260714141136_session-message-legacy-writer-compat/migration.sql  1 -> 0
packages/core/src/connector.ts  12 -> 0
packages/core/src/credential.ts  33 -> 26
packages/core/src/database/database.ts  3 -> 4
packages/core/src/integration.ts  0 -> 12
packages/core/test/connector.test.ts  3 -> 0
packages/core/test/credential.test.ts  6 -> 5
packages/opencode/src/project/instance-store.ts  10 -> 12
packages/opencode/src/server/routes/instance/httpapi/server.ts  24 -> 19
```

Relevant branch commits, newest first:

```text
06d871409b fix: restore oauth attempt settlement guards in integration
92f8d0b0de fix: complete instance boot deferreds on interruption
0644aee49d fix: kilo compat for v1.17.5 test infrastructure
95db2da8e9 refactor: kilo compat for v1.17.5
3591852931 resolve merge conflicts
4327386ff8 refactor: kilo compat for v1.17.5
```

## Limitations

- This is a static marker and source-history audit. It does not independently prove runtime behavior or execute the affected test suites.
- The current `origin/main` is newer than the branch's merge-time base. The audit used the actual merge base after verifying the supplied worktree topology, rather than assuming current `origin/main` was the pre-merge snapshot.
- No source files, Git refs, staging state, commits, or remote branches were changed. This report is the only file created by the audit.
