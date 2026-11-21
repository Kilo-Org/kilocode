<!-- kilocode_change - new file -->

# nono sandbox backend

Status: development-only. The native seatbelt and bubblewrap backends stay the default; the nono backend is
selected only when both `KILO_V2_DEV=1` (set by the development launcher) and `KILO_SANDBOX_BACKEND=nono` are
set. Nothing in this document is a user-enablement promise; `docs/nono-acceptance.md` records what the
pinned release actually does and which gaps remain.

## Why

Kilo confines tool-spawned commands. nono supplies a supervised CLI with a generated profile, an optional proxy
for credential injection and structured diagnostics. Kilo stays outside the sandbox: the host prepares a profile,
runs `nono run --silent --no-audit --profile <file> -- <command>`, and treats the child's exit status as the
command's result.

## Components

| Piece | Location | Role |
|---|---|---|
| Backend selection | `packages/kilo-sandbox/src/backend.ts` | Chooses nono only under the dev switch; `prepareCommand` is the single seam every tool spawn goes through |
| Profile generator | `packages/kilo-sandbox/src/nono-profile.ts` | Maps a `Profile` to nono's JSON schema (v3), lifts built-in credential denies, emits network and credential routes |
| Launch adapter | `packages/kilo-sandbox/src/nono.ts` | Writes the profile, validates it, and rewrites the command to the pinned nono |
| Binary pin and staging | `packages/kilo-sandbox/src/nono-binary.ts`, `script/nono-pin.ts` | Pins version and SHA-256, stages the binary, probes support, validates profiles |
| Diagnostics | `packages/kilo-sandbox/src/nono-diagnostics.ts` | Classifies denials from the JSON session block or the raw stderr, without inventing reasons |
| Credential model | `packages/kilo-sandbox/src/nono-credentials.ts` | Parses `env://NAME` routes, enforces uniqueness and builds the phantom/alias view |
| Mutation worker | `packages/kilo-sandbox/src/mutation.ts`, `kilo-sandbox-mutation-worker.ts` | Runs Kilo-side file mutations inside the same profile |
| Plugin wiring | `packages/kilo-plugin/src/sandbox/policy.ts`, `environment.ts` | Resolves config into a per-session snapshot and decorates the Location environment |

## Flow

1. A tool call runs under the session's sandbox policy. The policy resolves the effective grants into a snapshot
   (mode, writable roots, allowed hosts, read grants, credentials) and stores it per session.
2. The decorated environment calls `prepareCommand`, which builds a `Profile` from the snapshot and the Location.
3. `nono-profile.generate` produces the nono profile. Secrets never enter it: only variable names, upstream URLs
   and formats do.
4. `nono-binary.validate` runs `nono profile validate --json` once per content-addressed profile, so a malformed
   profile fails as a sandbox error instead of looking like the command's exit.
5. `nono.wrap` launches the pinned binary with `--silent` (no prompts) and `--no-audit` (no audit session). The
   child's exit status is preserved.
6. On failure, `nono-diagnostics.classify` may label the result as a path, network or socket denial, a missing
   command, or an unknown failure. Launches do not enable `--diagnostics-json` because it prints on success too;
   the probe matrix opts in.

## Filesystem model

- Writable roots: the workspace, Kilo's own state/data/cache/bin/log/repos/temp directories, and configured
  `writable_paths`. The sandbox state root and the Kilo config root are denied inside them.
- Read set: the writable roots minus anything that contains or sits inside a deny root, plus configured
  `read_paths`. A configured grant that contains a deny root keeps its siblings; one inside it is dropped.
- `read_exceptions` lift a built-in credential deny only when no write grant would make that location writable;
  nono has no write-only deny, so a covered exception stays denied.
- `denyNames` is not enforced by the pin, so `.git` inside a writable root is writable. See
  `docs/nono-git-gate.md`.

## Network and credentials

- `network: "deny"` blocks egress. `network: "proxy"` (a non-empty `allowed_hosts`) routes through nono's proxy;
  `network: "allow"` does not confine egress.
- nono's allowlist matches hosts, not ports: `host:port` entries permit every port on that host, and Kilo warns
  once per process for any allowed host.
- Credentials are `env://NAME` only at this stage. Kilo sends the child a phantom value, removes aliases from the
  environment, and nono injects the real value for the configured upstream. A missing variable fails before the
  launch.
- Credential routes exist only in proxy mode. With `network: "allow"` or a deny with no hosts, Kilo masks the
  source variable but never sends the token, so no credential is injected.

## Environment

The child receives the tool environment minus credential aliases and configured denies, with XDG roots restored
and `TMPDIR` pointed at Kilo's temp directory. Loader variables such as `NODE_OPTIONS` cannot smuggle a
masked name back in; the profile's `set_vars` and `restore` maps are filtered against the masked set.

## Refusal model

- `backendSupport` probes the pinned binary and reports a reason; an unsupported host refuses instead of falling
  back silently.
- A rejected profile fails at prepare with a sandbox `PlatformError`.
- A nono denial is never retried with a wider profile; the result surfaces the classified reason and the raw
  output.
- The dev switch can be removed without touching native backends, which remain the default.

## Packaging and overrides

- The pinned version and SHA-256 live in `packages/kilo-sandbox/script/nono-manifest.json`; CI stages that exact
  binary and runs the probe matrix on both macOS arches.
- `KILO_NONO_PATH` is an explicit developer override. `KILO_NONO_STATE`, `KILO_NONO_HOME` and
  `KILO_NONO_MANIFEST` relocate state, nono's own home and the manifest for tests and CI.
- Generated profiles are content-addressed and swept after seven days.

## Limits and how to try it

The nono backend supports macOS only. Stage the pinned binary once, then run the development launcher with the
selection variables:

```
packages/kilo-sandbox$ bun run nono:pin --stage
$ KILO_V2_DEV=1 KILO_SANDBOX_BACKEND=nono bun dev
```

`KILO_NONO_PATH` overrides the staged binary for a local build; `KILO_NONO_STATE` and `KILO_NONO_HOME` relocate
state for tests.

The acceptance matrix, the arm64/x64 evidence and the decision records for every accepted gap are in
`docs/nono-acceptance.md`. The `.git` gate is in `docs/nono-git-gate.md`. User enablement stays blocked until the
gaps in those records close.
