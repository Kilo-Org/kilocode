<!-- kilocode_change - new file -->

# nono sandbox acceptance

Status: development-only. native backends remain the default; the macOS nono backend is selected only by
`KILO_V2_DEV=1` plus `KILO_SANDBOX_BACKEND=nono`. This document records what the pinned release actually does,
what is proven by which test, and which gaps are accepted until upstream work lands. It does not enable users.

## Environment

| Item           | Value                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| nono           | 0.82.0, pinned in `packages/kilo-sandbox/script/nono-manifest.json`                                                |
| Arches         | `darwin-arm64` (local + `sandbox nono` job) and `darwin-x64` (`sandbox nono` job)                                  |
| Profile schema | v3.0 (generated, `nono profile validate --json` before every launch)                                               |
| Reproduce      | `packages/kilo-sandbox`: `bun run poc`; `packages/kilo-plugin`: `KILO_V2_DEV=1 KILO_SANDBOX_BACKEND=nono bun test` |

## Matrix

`Evidence` names the probe (`P*` in `packages/kilo-sandbox/script/nono-poc.ts`) or the test that owns the case.
`Status`: `pass` proves the expectation; `recorded` means the pin does something else and the gap is accepted and
tracked below; `unverified` has no hermetic probe yet.

| Case                             | Method                                           | Expected                 | Observed (arm64)                      | Evidence                                                                                              | Status         |
| -------------------------------- | ------------------------------------------------ | ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| read outside grants              | `cat ~/.ssh/...`                                 | denied                   | EPERM                                 | P1                                                                                                    | pass           |
| read workspace                   | `cat readme.txt`                                 | allowed                  | read                                  | P2                                                                                                    | pass           |
| write workspace                  | create + read                                    | allowed                  | written                               | P3                                                                                                    | pass           |
| write `$HOME`                    | create outside grants                            | denied                   | EPERM                                 | P4                                                                                                    | pass           |
| `.git` write                     | top-level `.git/config`                          | denied                   | written                               | P5                                                                                                    | recorded (1)   |
| nested `.git` write              | `nested/.git/config`                             | denied                   | written                               | P20                                                                                                   | recorded (1)   |
| worktree `.git` file             | `worktree/.git`                                  | denied                   | written                               | P21                                                                                                   | recorded (1)   |
| symlink escape                   | write through a workspace symlink to `$HOME`     | denied                   | EPERM, no file                        | P22                                                                                                   | pass           |
| child process                    | `sh -c` grandchild writes `$HOME`                | denied                   | EPERM, no file                        | P23                                                                                                   | pass           |
| store sidecars                   | read `kilo2.db`                                  | denied                   | EPERM                                 | P11                                                                                                   | pass           |
| generated profile                | read the profile file                            | denied                   | EPERM                                 | P12                                                                                                   | pass           |
| secret in profile                | inspect generated profile                        | absent                   | absent                                | P13                                                                                                   | pass           |
| placeholder substitution         | token in child vs upstream                       | real value upstream only | phantom in child, real upstream       | P7                                                                                                    | pass           |
| alias removal                    | `GH_TOKEN` in child                              | absent                   | absent                                | P10                                                                                                   | pass           |
| missing credential               | route needs an unset variable                    | refuse before launch     | refuses, no profile written           | `nono-backend.test.ts` "refuses to launch when a routed credential has no value"                      | pass           |
| egress, deny mode                | public host                                      | blocked                  | blocked                               | P6                                                                                                    | pass           |
| egress, non-allowlisted          | proxy mode                                       | blocked                  | blocked                               | P8                                                                                                    | pass           |
| credential host also allowlisted | route host in `allowedHosts` (#1831)             | recorded                 | header still injected                 | P24                                                                                                   | recorded (2)   |
| redirect off allowlist           | allowlisted host redirects to a non-allowed host | blocked after a redirect | redirect issued, follow blocked (000) | P25                                                                                                   | pass           |
| private destination              | loopback reachable in proxy mode                 | blocked                  | reachable                             | P26                                                                                                   | recorded (4)   |
| exact port                       | allow host:port, dial another port               | blocked                  | reachable                             | P27                                                                                                   | recorded (5)   |
| missing proxy token              | request without `X-Nono-Token`                   | 407                      | 200 without the token                 | P28                                                                                                   | recorded (6)   |
| TLS hostname mismatch            | SNI differs from the allowlist entry             | blocked                  | not probed                            | —                                                                                                     | unverified (8) |
| direct-socket bypass             | raw socket to a non-allowed host in proxy mode   | blocked                  | not probed                            | —                                                                                                     | unverified (3) |
| foreground completion            | short command                                    | exit status preserved    | 7 preserved                           | POC exit-code fixture                                                                                 | pass           |
| background survival              | background job after the command                 | recorded                 | not probed                            | —                                                                                                     | unverified     |
| interruption                     | kill the supervisor                              | child exits              | child survived                        | P29                                                                                                   | recorded (7)   |
| supervisor death / shutdown      | same family as interruption                      | child exits              | see P29                               | P29                                                                                                   | recorded (7)   |
| cross-session isolation          | two sessions, different profiles                 | no authority leak        | covered by the plugin sandbox tests   | `packages/kilo-plugin/test/sandbox/policy.test.ts`, `session.test.ts`                                 | pass           |
| toggles                          | switch the sandbox on/off per session            | applies per session      | covered by the plugin sandbox tests   | `packages/kilo-plugin/test/sandbox/session.test.ts`                                                   | pass           |
| unavailable backend              | nono missing or rejected                         | refusal, not fallback    | reports a reason, no fallback         | `packages/kilo-sandbox/test/backend.test.ts` "reports backend support with a reason when unavailable" | pass           |
| `darwin-x64`                     | run suites and probes                            | same behavior            | run by the `sandbox nono` job         | CI job                                                                                                | pass           |

Local counts at the time of writing (arm64, no external egress): 19/19 executed probes pass, 10 recorded. The
`sandbox nono` job sets `KILO_NONO_POC_NETWORK=1`, so P16 executes there (20/20 executed, 9 recorded on arm64;
x64 reports the egress denial as an incidental path denial, which P19 accepts while the network kind stays pinned
by the fixture test).

## Decision records

Each upstream gap identified for this series gets a record. None of these is a user-enablement decision;
they keep the macOS backend development-only.

1. **`.git` is readable and writable.** nono's `deny` blocks reads too, so a blanket deny breaks `git status`.
   Decision: keep the workspace writable, record the gap (P5/P20/P21), and wait for a write-only deny
   (#2310/#2157). Consequence: a sandboxed command can plant `.git/hooks`; git escalation stays behind the
   existing approval and pre-escalation checks. See `docs/nono-git-gate.md`.
2. **Credential host also allowlisted (#1831).** At the pin, a `custom_credentials` route still injects the real
   header when its host is also in `allow_domain` (P24). Decision: no workaround needed for env-source routes;
   keep the probe so a pin bump cannot regress it silently.
3. **Redirect and direct-socket egress.** With the credential header, a redirect from an allowlisted host to a
   non-allowlisted one was issued and the follow was blocked (P25: one hop, final 000). The earlier 401 came from a
   probe missing that header, not from the proxy path being absent. Decision: no redirect gap is evidenced on the
   proxy path; add a hermetic direct-socket probe before enablement and do not treat the proxy allowlist as proven
   against raw sockets.
4. **Private and loopback destinations (#1994).** A name that resolves to loopback is reachable in proxy mode
   (P26). Decision: recorded gap; enablement waits on upstream `allow_private`/post-resolution floor or an explicit
   product decision.
5. **Allowlist loses ports (#2305/#1786/#2187/#1994).** `host:port` entries permit every port on the host (P27),
   and Kilo warns once at generation. Decision: recorded gap; no user-facing enablement until the port survives
   the allow-domain preprocessing.
6. **Proxy session token (#1149/#2079/#1666 closed; no open issue).** A request that carries the credential header
   but omits `X-Nono-Token` returned 200 (P28): the token is not enforced on this route. The earlier 401 came from
   omitting the credential header, not the token. Decision: record as a defence-in-depth gap and confirm the
   intended enforcement with upstream before treating the token as a control.
7. **Signal isolation (#2011, kernel 6.12 on Linux).** Killing the supervisor left the child running on macOS
   (P29). Decision: recorded gap for the shutdown/interruption family; the Linux kernel baseline remains an open
   product decision. macOS enablement must either accept this or wait for upstream process-tree handling.
8. **TLS hostname matching.** Untracked upstream, threat model unclear. Decision: unverified; settle the threat
   model before adding a requirement.

## What would clear the gaps

- A nono write-only deny or equivalent protected path (record 1).
- Port-preserving allowlist entries and a post-resolution private-address floor (records 4, 5).
- A resolved threat model and enforcement for direct sockets and proxy tokens (records 3, 6).
- A written decision or upstream process-tree handling for signal isolation, plus a Linux kernel baseline
  (record 7).
- A pin bump that re-runs this matrix and diffs the resolved default profile.
