# DaveAI Merge Drivers — package.json Branding Preservation

This bundle registers a custom git merge driver so that cherry-picking
upstream release commits (`release: v7.2.21..v7.2.24`, etc.) onto the
DaveAI fork no longer produces conflicts on
`packages/kilo-vscode/package.json`. The merge driver takes upstream's
new `version` (and any new `dependencies`, `scripts`, etc.) while
preserving the DaveAI-owned branding fields (`displayName`,
`description`, `publisher`, `icon`, `author`, `homepage`, `bugs`,
`repository`, and any `contributes.commands[*].title` that contains the
literal string `MAOS`).

## What's in this bundle

| File | Purpose |
|------|---------|
| `.gitattributes` (snippet) | Maps `packages/kilo-vscode/package.json` to the `daveai-package-json-branding` merge driver. |
| `scripts/setup-merge-drivers.sh` | Registers the driver in this clone's LOCAL git config. Run once after clone. |
| `scripts/merge-package-json-branding.js` | The driver itself. Pure Node, no deps. |
| `scripts/test-merge-driver.sh` | Synthetic sanity check using a fake v7.2.20 → v7.2.24 bump. |

## Install (one-time per clone)

From the repository root:

```bash
bash scripts/setup-merge-drivers.sh
```

This sets two keys in your local `.git/config`:

```
[merge "daveai-package-json-branding"]
    name   = DaveAI package.json branding-preserving merge
    driver = node scripts/merge-package-json-branding.js %O %A %B %P
```

Re-running the script is safe (idempotent — it just overwrites the
same two keys).

## Verify the install

```bash
git config --get merge.daveai-package-json-branding.driver
# → node scripts/merge-package-json-branding.js %O %A %B %P

bash scripts/test-merge-driver.sh
# → PASS: merge driver produced correct DaveAI-branding-preserving result.
```

If the test prints `PASS`, the driver is wired correctly. If it prints
`FAIL`, the merged-file body is dumped immediately above the failure
line for inspection.

## How it engages

When git cherry-picks or merges a commit that touches
`packages/kilo-vscode/package.json`, it consults `.gitattributes`,
sees the file is mapped to the `daveai-package-json-branding` driver,
and invokes:

```
node scripts/merge-package-json-branding.js <ancestor> <current> <incoming> <pathname>
```

The driver writes the merged result back to `<current>` (i.e. the
working-tree copy on the DaveAI branch) and exits 0. Git proceeds with
no conflict markers.

If the JSON is malformed (e.g. a corrupted upstream commit), the driver
exits with a non-zero status and a stderr message. Git then falls back
to the standard textual merge driver, leaving conflict markers for a
human to resolve — i.e. it fails safe.

## What the driver preserves vs. takes

| Field | Source |
|-------|--------|
| `version`, `dependencies`, `devDependencies`, `scripts`, `engines`, anything else not listed below | **incoming** (upstream) |
| `displayName`, `description`, `publisher`, `icon`, `author`, `homepage`, `bugs`, `repository` | **current** (DaveAI) |
| Any other top-level key present in current but not in incoming | **current** (defensive) |
| `contributes.commands[*].title` where current's title contains `MAOS` | **current** |
| `contributes.commands[*].title` where current's title does not contain `MAOS` | **incoming** |
| New `contributes.commands[*]` entries added by upstream | **incoming** |
| DaveAI-only `contributes.commands[*]` entries (title contains `MAOS`) that upstream doesn't have | **current** |

## Roll back

The driver is opt-in via `.gitattributes`. To disable it temporarily
without uninstalling:

```bash
git -c merge.daveai-package-json-branding.driver=false cherry-pick <SHA>
```

To uninstall completely:

1. Remove (or comment out) the line in `.gitattributes`:
   ```
   packages/kilo-vscode/package.json    merge=daveai-package-json-branding
   ```
2. Drop the local config keys:
   ```bash
   git config --unset merge.daveai-package-json-branding.driver
   git config --unset merge.daveai-package-json-branding.name
   ```
3. Optionally delete `scripts/merge-package-json-branding.js` and
   `scripts/setup-merge-drivers.sh`.

After the rollback, cherry-picks of upstream release commits will once
again produce conflict markers in `packages/kilo-vscode/package.json`,
which is the previous baseline behaviour.

## Why this exists

See `docs/UPSTREAM_COMPATIBILITY_GUIDE.md` (Pattern B) in the
contract-kit-v17 worktree for the full reasoning. Short version: the
VSIX manifest format requires `displayName`, `description`, etc. to
live in this exact file, so we cannot simply move DaveAI branding to
a sibling overlay. A deterministic merge driver is the smallest fix
that lets us continuously sync upstream without a human reviewing
every release bump.
