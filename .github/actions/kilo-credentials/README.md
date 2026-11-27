# kilo-credentials

Reads the job's secret bundle from Kilo STS and sets each requested secret as a step output.

**Callers.** The only caller so far is the `sts-check` job of `.github/workflows/nix-hashes.yml`, a
manual check (`gh workflow run nix-hashes.yml -f sts_check=true` on `main`) that reads the
`ci-kilocode-app-key` bundle and mints a Kilo Maintainer app token with it. Every other job still
reads GitHub secrets.

**Subject.** Kilo-Org/kilocode's OIDC tokens still carry GitHub's default subject
(`repo:Kilo-Org/kilocode:environment:<name>`). STS admits that subject through its `legacySubject`
exception, which is allowed for this repository alone and is live in production since
Kilo-Org/cloud#12991. The token's repository and owner ids and every other policy binding are still
checked. The repository cannot turn on GitHub's immutable subject yet, because npm trusted
publishing fails with it (npm/cli#9969). When npm fixes that, the repository switches to the
immutable subject and STS drops the exception (design Q62a; the steps are in the comment on
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
| `secrets` | yes | One bundle key per line, spelled as the bundle returns it, for example `KILOCODE_ANACONDA_API_KEY` or `KILOCODE_AUR_KEY`. A key missing from the bundle fails the job |
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
  publish:
    runs-on: ubuntu-latest
    environment: release # must be the environment that the STS policy names
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
            KILOCODE_ANACONDA_API_KEY
            KILOCODE_AUR_KEY
      - run: anaconda upload ...
        env:
          ANACONDA_API_KEY: ${{ steps.creds.outputs.KILOCODE_ANACONDA_API_KEY }}
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
- That environment's deployment branch policy allows `main` only.
- Its workflow is never callable with `workflow_call`. The OIDC token of a reusable workflow carries
  that workflow's `job_workflow_ref`, so any workflow allowed to call it would receive its bundle.
- `secrets:` lists every key the job reads.
- Each value or path goes to the step that needs it, with `env:` on that step only, never in the
  job's `env:` or in `GITHUB_ENV`, which would show it to every later step.
- A job that requests a key that has a `<KEY>_FILE` output (`KILOCODE_AUR_KEY`,
  `KILOCODE_JETBRAINS_PRIVATE_KEY`, `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN`) ends with an
  `if: always()` step that deletes those paths, as in the example. The runner also empties
  `$RUNNER_TEMP` when the job ends, and the action deletes its files itself when it fails.
- Every action used after this step is pinned by its full commit SHA, so a moved tag cannot run new
  code next to the secrets.
- Every step before this one is trusted. An earlier step can change the `PATH` and the environment
  this action runs with, through `GITHUB_PATH` and `GITHUB_ENV`: for example `BASH_ENV`,
  `HTTPS_PROXY` or `ALL_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE` or `SSLKEYLOGFILE`, any of which
  can expose the OIDC token or the bundle. Every step also runs as the same user. The job runs only
  trusted code, never code from a fork or from a pull request.

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
