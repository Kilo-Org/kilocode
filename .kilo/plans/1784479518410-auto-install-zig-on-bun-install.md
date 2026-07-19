# Plan: auto-install zig at `bun install` for cross-platform zero-friction builds

## Goal

Make `bun run build` succeed on macOS, Linux, and Windows without requiring developers to manually install zig. The zig binary must be available transparently after `bun install` runs.

## Context

- `packages/opencode/script/kilocode/bubblewrap.ts:85` (`muslLicense`) and `:105-130` (`compile`) invoke `zig cc` and `zig env` to build a statically-linked `bwrap` for Linux release artifacts.
- `packages/opencode/script/build.ts:248` calls `stageBubblewrap` for every Linux target. Non-Linux targets, or builds with `KILO_SKIP_BUNDLED_BWRAP=1`, skip this path (see `nix/kilo.nix:43` for the existing escape hatch).
- CI pins **zig 0.14.0** at `.github/workflows/publish.yml:93-97` and `.github/actions/setup-linux-sandbox/action.yml:9-14`. Same version, sha256 `473ec26806133cf4d1918caf1a410f8403a13d979726a9045b421b685031a982` for the linux x86_64 tarball.
- Existing postinstall chain (root `package.json:16`): `bun run --cwd packages/core fix-node-pty && bun run script/setup-git.ts`. Good place to extend.
- Today's failure: when zig is missing on `$PATH`, `Bun.spawn([zig, "cc", ...])` fails with a low-signal `ENOENT`-style error from `compile` and a separate `Could not inspect the Zig toolchain` from `muslLicense`.

## Decisions

1. **Trigger**: zig download happens during the existing `postinstall` hook so it runs every time `bun install` runs, matching the user-requested zero-friction behaviour and the recently-merged node-gyp pattern.
2. **Location**: extract into the repo's `node_modules/.bin/zig` so Bun / Node prepend it to `$PATH` automatically — no `$PATH` manipulation required.
3. **Version**: pin **zig 0.14.0** to match CI (`publish.yml` / `setup-linux-sandbox`).
4. **Platforms**: macOS (x86_64, aarch64), Linux (x86_64, aarch64), Windows (x86_64). Skip on unsupported platforms silently.
5. **Skip if zig already on `$PATH`**: respect an existing system install (developer preference) and avoid redownloading.
6. **Skip if `KILO_SKIP_BUNDLED_BWRAP=1`**: respect the existing escape hatch used by the Nix build.

## Changes

### 1. New script `script/ensure-zig.ts` (repo root)

- Detect platform + arch via `process.platform` + `process.arch`.
- Resolve zig archive URL + sha256 from a small platform map mirroring CI:
  - linux x86_64: `zig-linux-x86_64-0.14.0.tar.xz`, sha256 `473ec26806133cf4d1918caf1a410f8403a13d979726a9045b421b685031a982`
  - linux aarch64: `zig-linux-aarch64-0.14.0.tar.xz`, sha256 TBD (look up at `https://ziglang.org/download/0.14.0/index.json`)
  - macos x86_64: `zig-macos-x86_64-0.14.0.tar.xz`, sha256 TBD
  - macos aarch64: `zig-macos-aarch64-0.14.0.tar.xz`, sha256 TBD
  - windows x86_64: `zig-windows-x86_64-0.14.0.zip`, sha256 TBD
- Resolve target dir `<repo>/node_modules/.bin/.zig/0.14.0/<platform>-<arch>/`.
- If `<target>/zig` (or `zig.exe` on win32) already exists and version-checks correctly, skip download.
- If `zig` is on `$PATH` AND `zig version` reports `0.14.0`, skip download and print a one-line notice.
- Otherwise: download to a temp file with `Bun.file` + `fetch`, verify sha256, then extract:
  - `.tar.xz` via `Bun.spawn(["tar", "-xJf", ...])` (matches existing `bubblewrap.ts:75` style)
  - `.zip` via `Bun.spawn(["unzip", ...])`
- Place a symlink (or copy on Windows) at `<repo>/node_modules/.bin/zig` (and `zig.exe`) pointing to the extracted `zig` binary inside the target dir.
- Print a single-line `installed zig 0.14.0` notice on success, suppress output otherwise.

### 2. Extend the root `postinstall` chain

In `package.json:16`:

```
"postinstall": "bun run --cwd packages/core fix-node-pty && bun run script/setup-git.ts && bun run script/ensure-zig.ts"
```

### 3. Optional `bwrap` build escape

In `packages/opencode/script/kilocode/bubblewrap.ts:105`, the existing `process.env.ZIG ?? "zig"` already works because `node_modules/.bin/zig` is on `$PATH`. No change required for the happy path.

Add a small preflight at the top of `compile()` that, when `zig` is not on `$PATH` AND `KILO_SKIP_BUNDLED_BWRAP=1` is unset, throws an actionable error referencing `KILO_SKIP_BUNDLED_BWRAP=1` and the zig install docs — only if `ensure-zig.ts` somehow failed and the binary isn't there. Fail loud rather than silently producing a bwrap-less artifact.

### 4. Verification helper

In `packages/opencode/script/build.ts:248` (or a thin wrapper around `stageBubblewrap`), guard the call so when `KILO_SKIP_BUNDLED_BWRAP=1` is set, the existing branch already handles it (it does — `bubblewrap.ts` reads from `KILO_SKIP_BUNDLED_BWRAP`). No change needed; just confirms existing behaviour.

## What this does NOT do

- Does not modify upstream Zig CI workflows (they already install zig correctly).
- Does not change `nix/kilo.nix` (Nix users have zig via nixpkgs and set `KILO_SKIP_BUNDLED_BWRAP=1`).
- Does not modify the runtime LSP/formatter zig checks in `src/lsp/server.ts:589` and `src/format/formatter.ts:156` — those run on the user's machine against their own zig install for `.zig` file editing and remain unaffected.

## Validation

1. Clean clone: `rm -rf node_modules` and `bun install`. Confirm `node_modules/.bin/zig` exists and `./node_modules/.bin/zig version` reports `0.14.0`.
2. Re-run `bun install` (should be idempotent — no re-download).
3. With zig already on `$PATH` at `0.14.0`: confirm the script does not download a second copy.
4. With `KILO_SKIP_BUNDLED_BWRAP=1`: confirm `bun run build` succeeds without invoking zig at all (current behaviour).
5. Linux build: `cd packages/opencode && bun run script/build.ts --single --skip-install` produces a `dist/@kilocode/cli-linux-x64/bin/bwrap` binary that runs.
6. macOS and Windows: confirm the binary lands at `node_modules/.bin/zig` and `node_modules/.bin/zig.exe` respectively, and `zig version` works.
7. `bun run lint` and `bun run typecheck` from repo root still pass.

## Risks

- **Disk + bandwidth**: ~50MB compressed per platform. Acceptable for a dev-time tool; not bundled in shipped CLI artifacts.
- **Network required for `bun install`**: first-time installs need internet to fetch zig. Same dependency already exists for other transitive deps.
- **Windows tar/xz**: Windows 10+ ships `tar` by default; `unzip` is the only new dependency on Windows. CI uses `tar` and `unzip` already (root `package.json` catalog doesn't include unzip — Windows machines typically have it via Git for Windows / VS Build Tools; document this in the script output if missing).
- **Lockfile noise**: zig binaries are downloaded at install time, so `bun.lock` is unaffected (unlike node-gyp). No churn.

## Out of scope

- Modifying the zig version pin (kept at 0.14.0 to match CI).
- Adjusting the upstream OpenCode merge minimiser rules.
- Adjusting Windows zig archive sha256 values — they must be fetched from `https://ziglang.org/download/0.14.0/index.json` during implementation.