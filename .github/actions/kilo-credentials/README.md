# kilo-credentials

Reads the job's secret bundle from Kilo STS and sets each requested secret as a step output.

**No workflow uses this action yet.** STS does not accept tokens from `Kilo-Org/kilocode` jobs
until its owner adds the kilocode policies. Until then the GitHub secrets stay in use.

## What it does

1. Requests a GitHub OIDC token with the audience `sts-url` (`https://sts.kiloapps.io`).
2. Sends it as the bearer token in `POST <sts-url>/v1/bundle` with the body `{}`. STS picks the
   policy from the token's claims and returns that policy's bundle.
3. Masks every line of every value in the bundle with `::add-mask::`, including keys the job did not
   request.
4. Checks that the response is exactly an `ok` bundle result and that its `workload` equals the
   `workload` input.
5. Sets each requested key as a step output of the same name, written to `GITHUB_OUTPUT` with its
   own random delimiter. A private key or certificate chain is written to a file instead, and its
   output holds the path (see [Outputs](#outputs)). Keys the job did not request are not set, and
   nothing is written to `GITHUB_ENV`.

The action fails on any error and has no fallback to a stored secret. A failure prints one error
line of at most 300 characters. From an STS refusal it shows only the HTTP status and the short
`status`, `reason` or `error` words of the response body.

Tokens and values never appear in a command line or in the log. Both responses are kept in a
temporary directory with mode 0700, which the action deletes when it exits. The action needs
`bash`, `curl` and `jq`, which the GitHub-hosted runners have.

## Inputs

| Input | Required | Description |
|---|---|---|
| `workload` | yes | The STS policy name of the job, for example `ci-kilocode-release` |
| `secrets` | yes | One bundle key per line, spelled as the bundle returns it, for example `KILOCODE_ANACONDA_API_KEY` or `KILOCODE_AUR_KEY`. A key missing from the bundle fails the job |
| `sts-url` | no | The STS origin, default `https://sts.kiloapps.io` |

## Outputs

A composite action passes on only the outputs that its `action.yml` declares. `action.yml` therefore
declares one output per bundle key that a kilocode STS policy grants
(`services/sts/policy/ci-kilocode-*.yaml` in `Kilo-Org/cloud`), and the action refuses a requested
key that has no declared output. Adding a secret means adding one output to `action.yml`, in the
same pull request as the first workflow that requests it.

Private keys and certificate chains never become output values. Each is declared as `<KEY>_FILE`:
the action writes the exact bytes of the value to a file with mode 0600, in a new directory with
mode 0700 under `$RUNNER_TEMP`, and sets `<KEY>_FILE` to the file's path. The value is still masked.
These keys are delivered as files:

| Bundle key | Output |
|---|---|
| `KILOCODE_AUR_KEY` | `KILOCODE_AUR_KEY_FILE` |
| `KILOCODE_MAINTAINER_APP_KEY` | `KILOCODE_MAINTAINER_APP_KEY_FILE` |
| `KILOCODE_JETBRAINS_PRIVATE_KEY` | `KILOCODE_JETBRAINS_PRIVATE_KEY_FILE` |
| `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN` | `KILOCODE_JETBRAINS_CERTIFICATE_CHAIN_FILE` |

The runner empties `$RUNNER_TEMP` at the end of every job. A step that is done with a key file can
delete it earlier. If the action fails, it deletes the files it wrote.

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
      - uses: actions/checkout@v4
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
```

Give each value or path to the step that needs it, with `env:` on that step only. Do not copy it
into the job's `env:` or into `GITHUB_ENV`, which would show it to every later step.

Rules for a calling job:

- It must run in the GitHub environment that its STS policy names (`environment:`), and it needs
  `permissions: id-token: write`. Without them STS refuses the token.
- Its workflow must never be callable with `workflow_call`. The OIDC token of a reusable workflow
  carries that workflow's `job_workflow_ref`, so any workflow allowed to call it would receive its
  bundle.
- An earlier step can change the `PATH` this action runs with, and every step runs as the same user
  as this one. A job that uses it must run only trusted code, never code from a fork or from a pull
  request.
