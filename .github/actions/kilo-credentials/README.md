# kilo-credentials

Reads the job's secret bundle from Kilo STS and sets each requested secret as a step output.

**Callers.** Seventeen jobs read an STS bundle. Each action call requests only the keys in its
`secrets:` input. That input limits what the action requests, not what STS serves: STS returns the
whole bundle of the policy that matches the job. `publish-jetbrains.yml` and
`publish-jetbrains-bundled.yml` share the policy `ci-kilocode-release-jetbrains`, so the `bundle`
job, which requests only the signing key, chain and password, can also obtain the Marketplace
token until that policy is split per workflow.

| Workflow | Job | Workload and environment | Use |
|---|---|---|---|
| `.github/workflows/nix-hashes.yml` | `update-hashes` | `ci-kilocode-app-key`, `automation` | Pushes the updated `nix/hashes.json` to `main`; reads the bundle only when that file changed |
| `.github/workflows/nix-hashes.yml` | `sts-check` | `ci-kilocode-app-key`, `automation` | Manual check (`gh workflow run nix-hashes.yml -f sts_check=true` on `main`) that mints an app token with metadata read only |
| `.github/workflows/prepare-jetbrains-release.yml` | `prepare` | `ci-kilocode-app-key`, `automation` | Creates the JetBrains release tag, branch and pull request; installs no packages, so the release script imports none |
| `.github/workflows/kilo-v2.yml` (branch `v2`) | `progress-commit` | `ci-kilocode-app-key-v2`, `automation` | Commits the v2 progress update on `v2` (app key) |
| `.github/workflows/publish.yml` | `release-push` | `ci-kilocode-release`, `release-keys` | Checks the release commit that the `release-commit` job bundled (see [Release commit check](#release-commit-check)), writes the release commit from the checked tree and pushes it to `main` with its tag (app key); installs no packages, runs only `script/kilocode/release-push.ts` on Bun |
| `.github/workflows/publish.yml` | `package-managers` | `ci-kilocode-release`, `release-keys` | Updates the AUR package `kilo-bin` (AUR key) and the Homebrew formula in `Kilo-Org/homebrew-tap` (app key) after a stable release; installs no packages, runs only `script/kilocode/package-managers.ts` on Node |
| `.github/workflows/publish.yml` | `jetbrains-pin` | `ci-kilocode-release`, `release-keys` | Opens or updates the JetBrains CLI pin bump pull request after a release (app key); installs no packages, runs only `.kilo/skills/release-jetbrains/script/set-pin.ts` on Bun |
| `.github/workflows/publish-jetbrains.yml` | `publish` | `ci-kilocode-release-jetbrains`, `release-jetbrains` | Builds, signs and publishes the JetBrains plugin to the Marketplace (Marketplace token, signing key, chain and password); runs only on `workflow_dispatch` from `main` |
| `.github/workflows/publish-jetbrains-bundled.yml` | `bundle` | `ci-kilocode-release-jetbrains`, `release-jetbrains` | Builds and signs the bundled JetBrains plugin for the GitHub Release (signing key, chain and password); runs only on `workflow_dispatch` from `main` |
| `.github/workflows/security-findings-notify.yml` | `list-findings` | `ci-kilocode-scan-notify`, `automation` | Mints an app token with `secret_scanning_alerts: read` on `kilocode` for the secret scanning alerts call (app key); runs only `gh` and `jq` |
| `.github/workflows/security-findings-notify.yml` | `notify` (one leg per finding) | `ci-kilocode-scan-notify`, `automation` | Posts the finding to Slack (security alerts webhook); a leg reads the bundle only when it posts |
| `.github/workflows/outdated-kilo-deps.yml` | `report` | `ci-kilocode-notify`, `automation` | Posts the outdated Kilo dependencies to Slack (security alerts webhook); reads the bundle only when there is something to post |
| `.github/workflows/stale-alerts-report.yml` | `report` | `ci-kilocode-notify`, `automation` | Posts the Dependabot alerts that look stale to Slack (security alerts webhook); reads the bundle only when there is something to post |
| `.github/workflows/stale-bot-pr-notify.yml` | `notify` | `ci-kilocode-notify`, `automation` | Posts the bot pull requests that need attention to Slack (security alerts webhook); reads the bundle only when there is something to post |
| `.github/workflows/v2-upstream-release-notify.yml` | `notify` | `ci-kilocode-notify`, `automation` | Posts an upstream v2 release that `v2` lacks to Slack (v2 sync webhook); runs only when the post was not made yet. The `check` job runs the tooling of `v2`, looks up the cache marker and holds no credential |
| `.github/workflows/community-sweep.yml` | `sweep` | `ci-kilocode-community`, `automation` | Mints an app token with `members: read` for the private member check (app key) and posts the queue to Slack (community triage bot token and webhook) |
| `.github/workflows/watch-opencode-releases.yml` | `check-release` | `ci-kilocode-opencode-watch`, `automation` | Announces a new upstream release in Slack (opencode watch webhook). The sync request still reads the GitHub secrets `OPENCODE_WATCH_SYNC_URL`, `OPENCODE_WATCH_SYNC_SECRET` and `OPENCODE_WATCH_VERCEL_SECRET`, which no STS bundle holds |

The Kilo Maintainer app id comes from the repository variable `KILO_MAINTAINER_APP_ID` (the app id
is public). No workflow reads the app key from the GitHub secret `KILO_MAINTAINER_APP_SECRET` any
more; the secret itself still exists.

**Release commit check.** The `release-commit` job of `publish.yml` writes the version commit with
third-party code (`bun install`, `changeset version`) and holds no secret and no OIDC permission.
`release-push` pushes a commit with an app token that may bypass the `main` ruleset, so
`script/kilocode/release-check.ts` compares the full trees of the dispatch commit and the bundled
commit with git and accepts only these changes:

| Path | Change | Rule |
|---|---|---|
| `package.json` files | modified | Only `"version"` lines change, from any version (read from the dispatch commit) to the release version; same line count. Not `packages/kilo-jetbrains/package.json` (the JetBrains CLI pin) |
| `bun.lock` | modified | The same `"version"` line rule |
| `packages/extensions/zed/extension.toml` | modified | Only its `version = "..."` line and the `releases/download/v<version>/` part of its archive URLs, to the release version |
| `packages/opencode/CHANGELOG.md`, `packages/kilo-vscode/CHANGELOG.md`, `packages/kilo-jetbrains/CHANGELOG.md` | modified | The old text stays an exact suffix after the `# title` line. The one block in front of it is at most 64 KiB and holds only changesets output: a `## <version>` header (the release version; any version for JetBrains), `### Major\|Minor\|Patch Changes`, blank lines, bullets whose text (after changesets' pull request, commit and thanks links) is a line of a `.changeset/*.md` file the commit deletes, read from the dispatch commit, and changesets' "Updated dependencies" lines. In those links a pull request's and a user's text must match the link target, a commit's short hash must start its full hash, and that commit must be in the history of the dispatch commit; a dependency line must name a package whose `package.json` the commit changes |
| `.changeset/<name>.md` | deleted | Not `.changeset/README.md` |

Refused even where a row above matches: `.github/`, `script/`, `bin/`, `nix/`, every other
lockfile, added files, renames, any mode change (an executable bit set or cleared, a file turned
into a symlink) and any symlink or submodule; a file that is already executable may change if it
stays so. Every other path must keep its blob and mode. The bundle holds only the tag
`v<version>`, which names a commit directly (no tag object) with exactly one parent, the dispatch
commit (`github.sha`), and the subject `release: v<version>`; its objects are fetched with fsck
checks. Only its tree is used: `release-push` writes the release commit itself (that tree, parent
`github.sha`, subject `release: v<version>`, the `kilo-maintainer[bot]` identity and the bundle
commit's timestamp, so a re-run writes the same commit) and tags and pushes that commit. A tag
`v<version>` already on origin is accepted only if it names that commit (a re-run, which pushes
nothing); any other tag refuses the run. If `main` moved since the dispatch, `release-push` merges
`main` and the release commit with `git merge-tree` and `git commit-tree`, refuses any conflict,
and runs the same check from the current `main` to the merge. `main` and the tag are pushed
atomically, with a lease on the merged `main`. After a failed push both refs are read back: if they
already point where the push sent them, the push counts as done; if `main` is unchanged, the same
push is retried (at most twice, 3 s apart); if `main` moved elsewhere, the merge is made again (at
most twice).

**Subject.** Kilo-Org/kilocode's OIDC tokens still carry GitHub's default subject
(`repo:Kilo-Org/kilocode:environment:<name>`). STS admits that subject through its `legacySubject`
exception, which is allowed for this repository alone and is live in production since
Kilo-Org/cloud#12991. The token's repository and owner ids and every other policy binding are still
checked. The repository cannot turn on GitHub's immutable subject yet, because npm trusted
publishing fails with it (npm/cli#9969). When npm fixes that, the repository switches to the
immutable subject and STS drops the exception (the steps are in the comment on
`GITHUB_LEGACY_SUBJECT_REPOSITORY` in Kilo-Org/cloud `services/sts/src/policy/schema.ts`).

## What it does

1. Requests a GitHub OIDC token with the audience `sts-url` (`https://sts.kiloapps.io`).
2. Sends it as the bearer token in `POST <sts-url>/v1/bundle` with the body `{}`. STS picks the
   policy from the token's claims and returns that policy's bundle.
3. Masks every value in the bundle with `::add-mask::`, including keys the job did not request:
   each line on its own, and each multi-line value as a whole.
4. Checks that the response is exactly one `ok` bundle result, that its `workload` equals the
   `workload` input, and that it is not stale.
5. Sets each requested key as a step output, written to `GITHUB_OUTPUT` with its own random
   delimiter. A private key or certificate chain is written to a file, and its output holds the path
   (see [Outputs](#outputs)). Nothing is written to `GITHUB_ENV`.

The action fails on any error and has no fallback to a stored secret. A failure prints one error
line of at most 300 characters. From an STS refusal it shows only the HTTP status and the short
`status`, `reason` or `error` words of the response body.

It fails on a stale bundle too. STS marks a bundle stale when it serves its last known copy because
the secret manager is unreachable, and that copy may still hold a revoked key. A CI job can run
again later, so it never takes a stale value.

Tokens and values never appear in a command line or in the log. The responses are kept in a
temporary directory with mode 0700, which the action deletes when it exits. The action needs
`bash`, `curl` and `jq`, all installed on the Ubuntu runners these workflows use.

### Retries and timing

| Case | Time |
|---|---|
| Typical: STS serves the bundle from its cache | about 1 s |
| Cold: STS first fills the bundle from the secret manager | about 20 s |
| The secret manager is down or STS times out internally (503 with `retryAfterSeconds` 30 to 60) | about 2 to 3 min before the action fails |
| OIDC request limit | 30 s |
| STS request limit, per attempt | 60 s |
| Worst case before the action fails | about 6.5 min: 3 attempts × (30 s + 60 s) + 2 waits × 60 s |

The action makes at most 3 attempts, and each attempt requests a new OIDC token. It retries:

- an OIDC answer with a 5xx status;
- an STS answer with status 503;
- a curl transport error on either request: no connection (7), HTTP/2 framing (16), timeout (28),
  TLS handshake (35), empty reply (52), send or receive failure (55, 56), HTTP/2 stream (92).

Before an attempt after an STS 503 it waits for the `retryAfterSeconds` in the response, or else
the `Retry-After` header, or else 5 s, capped at 60 s. After a transport error or an OIDC 5xx it
waits 5 s. The final error line names the `retryAfterSeconds` or `Retry-After` value. No other
error is retried. STS may already have delivered a bundle when a transport error hides its answer,
so a retry after a transport error can record two delivery audit rows for one run.

## Inputs

| Input | Required | Description |
|---|---|---|
| `workload` | yes | The STS policy name of the job, for example `ci-kilocode-release` |
| `secrets` | yes | One bundle key per line, spelled as the bundle returns it, for example `KILOCODE_MAINTAINER_APP_KEY` or `KILOCODE_AUR_KEY`. A key missing from the bundle fails the job |
| `sts-url` | no | `https://sts.kiloapps.io` (default) or `https://sts-staging.kiloapps.io`. Any other value fails the job, because that origin would receive the OIDC token |

## Outputs

A composite action passes on only the outputs that its `action.yml` declares. `action.yml` therefore
declares one output per bundle key that a kilocode STS policy grants
(`services/sts/policy/ci-kilocode-*.yaml` in `Kilo-Org/cloud`), and the action refuses a requested
key that has no declared output. Adding a secret means adding one output to `action.yml`, in the
same pull request as the first workflow that requests it.

The outputs of keys that the job did not request are empty strings. So `secrets:` must list every
key the job reads.

Private keys and certificate chains that their consumers read from a file are delivered as files.
Each is declared as `<KEY>_FILE`: the action writes the exact bytes of the value to a file with mode
0600, in a new directory with mode 0700 under `$RUNNER_TEMP`, and sets `<KEY>_FILE` to the file's
path. The value is still masked.

| Bundle key | Output | Consumer and the form it needs |
|---|---|---|
| `KILOCODE_AUR_KEY` | `KILOCODE_AUR_KEY_FILE` | `ssh` and `git` read the key from a file (`ssh -i`, `GIT_SSH_COMMAND`). `ssh` needs the key's final newline, so the stored value must end with one; the file keeps the exact bytes |
| `KILOCODE_JETBRAINS_PRIVATE_KEY` | `KILOCODE_JETBRAINS_PRIVATE_KEY_FILE` | The Gradle signing task reads `JETBRAINS_PRIVATE_KEY_FILE` (`packages/kilo-jetbrains/build.gradle.kts`) |
| `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN` | `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN_FILE` | The Gradle signing task reads `JETBRAINS_CERTIFICATE_CHAIN_FILE` |
| `KILOCODE_MAINTAINER_APP_KEY` | `KILOCODE_MAINTAINER_APP_KEY` | `actions/create-github-app-token`, also through `setup-git-committer`, takes the PEM contents in `private-key`, so this key is a value output |

Every other key is a value output of the same name.

## Using it

```yaml
jobs:
  package-managers:
    runs-on: ubuntu-latest
    environment: release-keys # must be the environment that the STS policy names
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@<full commit SHA> # vX.Y.Z
      - uses: ./.github/actions/kilo-credentials
        id: creds
        with:
          workload: ci-kilocode-release
          secrets: |
            KILOCODE_AUR_KEY
      - run: ./publish-aur.sh
        env:
          AUR_KEY_FILE: ${{ steps.creds.outputs.KILOCODE_AUR_KEY_FILE }}
      - name: Remove key files
        if: always()
        env:
          AUR_KEY_FILE: ${{ steps.creds.outputs.KILOCODE_AUR_KEY_FILE }}
        run: rm -f -- "$AUR_KEY_FILE"
```

## Rules for a calling job

- It runs in the GitHub environment that its STS policy names (`environment:`), and it has
  `permissions: id-token: write`. Without them STS refuses the token.
- That environment's deployment branch policy admits only the branches its callers run on:
  `automation` admits `main` and `v2`, every other environment `main` only.
- No other job of the same workflow uses that environment unless it follows these rules too. STS
  tells callers apart by the token's repository, environment, workflow file, ref and event; GitHub's
  OIDC token has no claim that names the job. Every job of the workflow that runs in that
  environment with `id-token: write` can therefore read the bundle, whether or not it uses this
  action. This is why the `publish` job of `publish.yml`, which installs packages and runs in
  `release` for npm, VS Code Marketplace and Open VSX trusted publishing, holds no app token and
  leaves the release push, the AUR and Homebrew updates and the JetBrains pin pull request to jobs
  in `release-keys`.
- Known limit, not changed by this split: the `publish` job still runs `bun install` and the npm,
  vsce and ovsx tooling next to `id-token: write`, for npm, VS Code Marketplace and Open VSX
  trusted publishing. It runs in `release`, not `release-keys`, so it cannot read the
  `ci-kilocode-release` bundle, but a compromised package there could publish to those registries
  and read any STS bundle whose policy names `release`. Moving the installs out of that job is a
  separate change.
- Known limit, unchanged by the move to STS: the `publish` job of `publish-jetbrains.yml` and the
  `bundle` job of `publish-jetbrains-bundled.yml` still run `bun install` and the Gradle build that
  signs the plugin, in the same job as the JetBrains keys, as they did with repository secrets.
  Both use the credential action from the dispatched `main` commit, not from the release commit
  they build. Moving the installs out of those jobs is a separate change.
- Its workflow is never callable with `workflow_call`. The OIDC token of a reusable workflow carries
  that workflow's `job_workflow_ref`, so any workflow allowed to call it would receive its bundle.
- `secrets:` lists every key the job reads.
- Each value or path goes to the step that needs it, with `env:` on that step only, never in the
  job's `env:` or in `GITHUB_ENV`, which would show it to every later step.
- A job that requests a key that has a `<KEY>_FILE` output (`KILOCODE_AUR_KEY`,
  `KILOCODE_JETBRAINS_PRIVATE_KEY`, `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN`) ends with an
  `if: always()` step that deletes those paths, as in the example. The runner also empties
  `$RUNNER_TEMP` when the job ends, and the action deletes its files itself when it fails.
- Every action used in the job is pinned by its full commit SHA, so a moved tag cannot run new code
  next to the secrets.
- Every step before this one is trusted. An earlier step can change the `PATH` and the environment
  this action runs with, through `GITHUB_PATH` and `GITHUB_ENV`: for example `BASH_ENV`,
  `HTTPS_PROXY` or `ALL_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE` or `SSLKEYLOGFILE`, any of which
  can expose the OIDC token or the bundle.
- No step anywhere in the job, before or after this one, runs untrusted code: no code from a fork
  or from a pull request, and no third-party package install or lifecycle script (`bun install`,
  `npm install`, `pip install`, `npx` or `bunx` of a package, and the like). Moving this step does
  not help, for two reasons. With `id-token: write`, any step can request its own OIDC token and
  read the bundle from STS itself. And every step runs as the same user, so a later step can read
  the earlier steps' outputs, including this one's values, from the runner's files under
  `$RUNNER_TEMP`.

## Tests

`script/kilocode/kilo-credentials.test.ts` runs the script against a stand-in GitHub OIDC endpoint
and a stand-in STS, reached through a local HTTPS proxy with a throwaway certificate. A stand-in
`sleep` records each wait and returns at once. The test checks the outputs, the key files, masking,
every failure line, the retries and their waits, and that no token or value reaches a command line.
CI runs it in the root tooling unit tests (`bun run test:script:ci` in `test.yml`). To run it alone
from the repository root, with `bash`, `curl`, `jq` and `openssl` installed:

```sh
bun test ./script/kilocode/kilo-credentials.test.ts
```
