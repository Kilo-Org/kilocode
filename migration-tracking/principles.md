# Kilo v2 migration principles

The technical rules of the Kilo v2 migration. This page overrides any other document; other files point here instead of restating these rules. The plan is in [`plan.md`](plan.md), live state in GitHub ([#15297](https://github.com/Kilo-Org/kilocode/issues/15297)).

## 1. Direction

Kilo is the host, OpenCode is a library. Code moves from upstream files into Kilo-owned files (`packages/kilo-*`, `src/kilocode/`, `test/kilocode/`), never back. A proposal that adds or widens a `kilocode_change` line in an upstream file in order to remove or shrink Kilo-owned code is rejected.

A Kilo-owned mirror of an upstream file (the host entry, a replaced tool) is allowed, and preferred over a seam in that file. Name the mirror in the PR.

A patch adds to upstream and never changes an upstream default. Upstream's own tests pass unchanged against the code without the host, and are never edited to fit a Kilo value. A Kilo value belongs in the host, behind a generic knob that keeps upstream's default.

## 2. Placement order

Use the first rung that works, and name it in the PR:

1. A Kilo plugin on the public plugin API (`@opencode/plugin`), including Kilo RPCs.
2. Kilo host composition (`packages/kilo-cli`): plugin registration, service overrides, environment translation, mirrors.
3. A small generic seam in a shared upstream file, with no Kilo value in it.
4. A one-line patch in a shared upstream file, with the behavior in a Kilo module. Last resort.

Rungs 3 and 4 carry `kilocode_change(<feature>)` markers and an entry in `script/upstream/shared-patches.json`. A PR that uses rung 3 or 4 says why the lower rungs do not work. The how-to is the `v2-feature-placement` skill (`.kilo/skills/v2-feature-placement/SKILL.md`).

## 3. Clients

Every client (VS Code, JetBrains, Kilo Desktop, other consumers) is a new package on `origin/v2`, wired natively to `@opencode/client` plus Kilo plugin RPCs: port the UI, rewrite the data layer.

- No v1 wire facade, no v1-shaped translation layer, and no v1 SDK in a v2 client.
- No in-place migration of v1 clients on `main`.
- Kilo behavior that clients need is exposed as a Kilo plugin RPC. The contracts are in `packages/schema/src/kilocode/`.

## 4. Identity and config names

- The internal v2 line is `kilo2`: binary `kilo2`, and separate `kilo2` config, data, cache and state directories. v1 directories and files are never written; an opt-in v1 import leaves the originals unchanged.
- Runtime config uses `kilo2.json` and `kilo2.jsonc` (project roots and ancestors up to the worktree root, or to the filesystem root outside version control; global and system directories) and the project directory `.kilo2`. Contents use the v2 schema; explicit config paths still accept any filename. The CLI creates `kilo2.json`; the server's global writer creates `kilo2.jsonc` if neither file exists.
- There is no fallback to v1 `kilo.json`, `kilo.jsonc`, `.kilo` or `.kilocode`, nor to OpenCode config.
- The repository's own `.kilo/` contributor tooling (skills, agents, commands) stays where it is.

## 5. Behavioral reference

v1 Kilo on `main` is the behavioral reference, pinned as `pins.v1Target` in [`progress/features.json`](progress/features.json). The archived port (tag `kilo-v2-checkpoints-2026-09`) is a mechanism reference only: how a feature can be expressed on v2. It is never merged or copied wholesale; behavior and policy come from v1.
