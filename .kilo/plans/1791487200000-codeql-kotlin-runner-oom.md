# Fix the flaky "CodeQL Kotlin" runner failure

## Problem

`.github/workflows/codeql-kotlin.yml` fails intermittently — roughly 40% of runs today
(`37671856137`, `37669833812`, `37662330681`, `37657998466`, `37652778639`, `37648149255`,
`37639800380` all failed; interleaved runs on the same code succeeded).

Every failure has an identical signature. The job always dies inside the
`Perform CodeQL Analysis` step, during `codeql database run-queries`, a few seconds after the
last batch of security queries starts evaluating:

```
Starting evaluation of codeql/java-queries/Security/CWE/CWE-917/OgnlInjection.ql.
Starting evaluation of codeql/java-queries/Security/CWE/CWE-918/RequestForgery.ql.
##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.
Cleaning up orphan processes
Terminate orphan process: pid (2904) (java)
Terminate orphan process: pid (3105) (java)
```

In runs `37671856137` and `37669833812` even the `##[error]` line is missing — the log just stops
mid-evaluation and the job is marked `failure`. No CodeQL error, no query failure, no timeout
(failures land at ~10–13 min against `timeout-minutes: 30`), and no disk exhaustion message
(`--min-disk-free=1024` never trips).

This is not a Kotlin/CodeQL correctness problem. The runner VM itself is being torn down, i.e. the
host runs out of memory and the agent process is reaped. Three facts pin it down:

1. `CODEQL_RAM: 14575` — CodeQL claims ~14.6 GB of the 16 GB `ubuntu-latest` VM for query
   evaluation, leaving ~1 GB for the runner agent, OS, and page cache.
2. The `Build Java/Kotlin` step (`./gradlew typecheck --rerun-tasks --no-build-cache`) starts a
   Gradle daemon (`org.gradle.jvmargs=-Xmx4096m` in `packages/kilo-jetbrains/gradle.properties`)
   plus a Kotlin compile daemon and IntelliJ-platform worker JVMs. Those JVMs are still alive
   during CodeQL analysis — the "Terminate orphan process ... (java)" lines at `Complete job`
   prove it, and `gradle/actions/setup-gradle`'s daemon-stopping post step runs *after*
   `Perform CodeQL Analysis`, not before.
3. Successful runs show the same orphan JVMs and the same `CODEQL_RAM`. The peak query phase takes
   ~60 s and barely fits. That borderline headroom is exactly why the failure is intermittent and
   why it always hits the same heaviest query batch.

So: CodeQL sizes itself for an idle 16 GB box while 5–8 GB of idle-but-resident JVM heap from the
Kotlin build is still held. When the resident set of those daemons is slightly higher than usual,
the box OOMs and the runner dies.

`codeql-kotlin.yml` is the only workflow with this build-then-analyze-in-one-job shape;
`typecheck.yml` and `test-jetbrains.yml` run Gradle as the last thing in their jobs, so they are
unaffected.

## Fix

Two complementary changes to `.github/workflows/codeql-kotlin.yml` (a Kilo-owned
`# kilocode_change - new file` workflow, so no upstream-merge concerns and no markers needed).

### 1. Release the Kotlin/Gradle JVM memory before CodeQL analysis

Add a step between `Build Java/Kotlin` and `Perform CodeQL Analysis`:

- `./gradlew --stop` in `packages/kilo-jetbrains` to shut down the Gradle daemon (and its workers).
- `pkill -f KotlinCompileDaemon` for the Kotlin daemon, which `--stop` does not cover.
- Tolerate "nothing to kill" exit codes explicitly (the step shell runs with `-e -o pipefail`), with
  an `echo` rather than a bare `|| true` so the log says what happened.
- Print `free -m` and the top RSS processes afterwards. This is the memory evidence the current logs
  lack, and it makes any recurrence diagnosable in one glance instead of another log archaeology
  session.

### 2. Stop CodeQL from claiming the whole VM

Pass `ram: 12288` to the `github/codeql-action/init@v4` step. `init` is where `CODEQL_RAM` is
exported, so `analyze` picks it up. This leaves ~3.5 GB of headroom for the runner agent and OS
instead of ~1 GB.

Both changes are needed: (1) removes the actual competing allocation, (2) keeps the job from being
one unlucky allocation away from an OOM even after the daemons are gone. Query evaluation currently
finishes in ~60 s, so the lower ceiling is not a throughput concern.

### Deliberately not doing

- Switching to `blacksmith-8vcpu-ubuntu-2404` (used elsewhere in `.github/`). It would likely paper
  over the problem with more RAM, but it does not fix a job that over-commits memory, and it costs
  more per run. Keep it as the fallback if (1) and (2) prove insufficient.
- Dropping `--rerun-tasks --no-build-cache`. CodeQL's `build-mode: manual` needs real compilation to
  trace; cached/up-to-date tasks would silently produce an under-populated database.
- Raising `timeout-minutes`. Failures are not timeouts.

## Verification

1. `bun run script/check-workflows.ts` from the repo root — no workflow file is added or removed, so
   the allowlist should stay green.
2. Push the branch and open a PR. The workflow's `pull_request` path filter includes
   `.github/workflows/codeql-kotlin.yml`, so the job runs on the PR itself.
3. Because the failure is intermittent (~40%), one green run is not evidence. Trigger the workflow
   repeatedly on the branch via `gh workflow run codeql-kotlin.yml --ref <branch>` (the job's `if`
   allows `workflow_dispatch`) and require ~5 consecutive passes.
4. In those runs, confirm from the logs that `CODEQL_RAM: 12288`, that the new cleanup step reports
   the daemons stopped, that `free -m` shows the recovered memory, and that `Complete job` no longer
   lists orphan `java` processes.

No changeset: CI-only change with no user-facing behavior.
