# Observed nono 0.82.0 exit behavior (Darwin arm64)

Fixtures in this directory were captured against the pinned binary with a generated profile. They are the source
of truth for `src/nono-diagnostics.ts`; the JSON shape is not treated as a stable API.

| Case                                                       | Exit     | Output                                                                                                        |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| allowed read (`cat allowed.txt`)                           | 0        | child output; with `--diagnostics-json` a JSON block on stderr even on success                                |
| denied read (`cat denied.txt`)                             | 1        | child errno on stderr; with `--diagnostics-json`, `sandbox_denied_path` + denial path                         |
| blocked egress (`curl https://example.com`, network block) | 7 (curl) | with `--diagnostics-json`, `network-outbound` violation; `sandbox_denied_network` was not emitted at this pin |
| command not found                                          | 1        | `nono: Command execution failed: ... cannot find binary path`; no JSON block                                  |
| command exits 7 (`sh -c 'exit 7'`)                         | 7        | child status preserved; JSON may carry incidental denials                                                     |
| invalid profile                                            | 1        | `nono profile validate --json` reports `valid: false` with `errors` on stdout                                 |

Notes:

- `--silent` suppresses the human footer ("Sandbox denial: ... Fix flags: ..."), and the footer is also the only
  reason text on a normal run without `--diagnostics-json`. Launches keep `--silent`; the JSON flag is opt-in.
- `command_failed_likely_sandbox` and `command_failed_application` are generic advice and appear even on a
  successful run, so they never classify a failure on their own.
- `--no-audit` stays on and `--rollback` is never passed.
