---
title: "Team Portability"
description: "Export, import, and share Devil Code team configurations via JSON files."
---

# Team Portability

## Overview

Devil Code teams are portable. Any active team configuration can be exported to a version-stamped, checksum-verified JSON file and imported on another machine or shared with a colleague. Portable team files unlock three workflows: pinning a team definition to a repository (project-local), building a personal library of team templates (user-level), and distributing opinionated starting points as read-only bundled templates (quickstarts).

Teams resolve across three storage layers, in precedence order:

1. **Project-local** — `.planning/team.json` under the current project directory, reserved id `"project"`.
2. **User-level** — `~/.local/share/kilo/teams/<id>.json`, the default write destination.
3. **Quickstart** — bundled read-only templates (`solo-enhanced`, `full-stack-team`, `ci-cd-pipeline`, `code-review-pair`, `research-team`).

## Quickstart

```bash
# Export your active team to a file
team export ~/my-team.json

# Import on another machine (or share with a colleague)
team import ~/my-team.json
```

Run both commands from the Workflow TUI prompt (type them directly into the `workflow>` input).

## /team export <path>

Writes the active team configuration to `<path>` as a JSON envelope. The envelope includes the schema version, a SHA-256 checksum of the stable-sorted config, the export timestamp, and optionally an exporter identifier.

**Envelope example** (checksum truncated for readability — actual checksums are 64 hex characters):

```json
{
  "version": "1.0.0",
  "checksum": "a1b2c3d4e5f67890...",
  "config": {
    "enabled": true,
    "roles": { "planner": { "model": "claude-sonnet-4-6", "effort": "medium" } },
    "routing": { "default": "planner" }
  },
  "exportedAt": "2026-04-20T14:32:00.000Z",
  "exportedBy": "dev@example.com"
}
```

**Usage**:

```bash
team export ./shared/team-v1.json
team export ~/.local/share/kilo/teams/my-copy.json
team export /tmp/snapshot.json
```

Relative paths resolve against the current working directory. On success, a toast shows the resolved path and the first 12 chars of the checksum.

## /team import <path>

Reads a team JSON file and applies it as the active team configuration. Imports go through a 5-stage validation pipeline:

1. **JSON parse** — file must be valid JSON (fails with `Invalid JSON`).
2. **Version check** — `version` must match the current supported version (fails with `Version mismatch: X.Y.Z`).
3. **Envelope schema validation** — envelope fields must conform to the envelope schema (fails with `Schema invalid (envelope)`).
4. **Migration** — the contained config is migrated to the current schema version if needed.
5. **Checksum verify** — the migrated config is hashed and compared against the envelope's checksum (fails with `Checksum failed`).

On success, the imported team is persisted via `Config.update({ team: imported })` and a `Team imported` toast is shown.

## File Format

| Field | Type | Description |
|-------|------|-------------|
| `version` | `"1.0.0"` | Schema version — semver. Currently only `1.0.0` is supported. |
| `checksum` | hex string (64 chars) | SHA-256 of the stable-sorted, canonicalized config JSON. |
| `config` | `TeamConfig` object | The team definition (enabled flag, roles, routing rules). |
| `exportedAt` | ISO 8601 datetime | Timestamp when the export was written. |
| `exportedBy` | string (optional) | Exporter identifier — currently always `undefined` from the TUI. |

The file is formatted with 2-space indentation and terminated by a trailing newline for clean diffs when committed to git.

## Override Precedence

```
project-local (.planning/team.json)
     |
     | overrides
     v
user-level (~/.local/share/kilo/teams/<id>.json)
     |
     | overrides
     v
bundled quickstart templates
```

**Rationale**:

- **Project-local wins** so teams can be pinned per repository. A team committed to `.planning/team.json` is the source of truth for every contributor, ensuring reproducible workflow behavior across the team.
- **User-level is the default save destination** for `/team export` when no project-local target is specified, and for `Team: Save` in the team builder. This makes it the natural "personal library" layer.
- **Quickstarts are read-only templates** — they ship with Devil Code and can be loaded and customized, but cannot be overwritten. Export a modified quickstart to user-level or project-local to persist changes.

## Schema Evolution

Team export envelopes use semantic versioning. The current version is `1.0.0`.

**Forward-compatibility guarantee**: any `1.x` export file will import without data loss into any future `1.y` build of Devil Code. Breaking schema changes will bump the major version, at which point files stamped with an incompatible major version will fail import with a `TeamVersionMismatchError`.

**Phase 7+ commitment**: as new fields are added, migration logic is applied during import to preserve legacy exports. A Phase 7 checksum re-computation pipeline ensures that migrated configs produce a checksum matching the envelope's recorded checksum (otherwise migration would trip the integrity check).

**Security note**: the checksum verifies **integrity**, not **authenticity**. A malicious actor who rewrites the file can also recompute the checksum. Signed manifests (Ed25519 signatures against a known public key) are on the roadmap for the Phase 8 Registry and will enable authenticity verification in addition to integrity.

## Error Modes

| Error | Kind | User Action |
|-------|------|-------------|
| `TeamVersionMismatchError` | `version-mismatch` | Upgrade Devil Code or export from an older install that matches your version. |
| `TeamChecksumError` | `checksum-failed` | File may be corrupted in transit; re-export from the source and transfer again. |
| `TeamSchemaValidationError` | `envelope-invalid` or `config-invalid` | File structure is invalid; re-export from a current Devil Code install. |
| `TeamImportError` | `file-not-found` | Path does not exist; verify the path and file permissions. |
| `TeamImportError` | `json-parse-failed` | File is not valid JSON; re-export or repair the file manually. |

## Sharing Workflows

Three common patterns for distributing team configurations:

### 1. Email or chat attachment

Export to a local file, then attach the `.json` to an email, Slack message, or chat. Recipients save the file locally and run `team import <path>`.

```bash
team export ~/Desktop/team-for-alice.json
# ... send team-for-alice.json via your preferred channel ...
# alice runs:
team import ~/Downloads/team-for-alice.json
```

### 2. Git-tracked project-local

Commit `.planning/team.json` to your repository to share the team definition with all contributors. The next time anyone runs Devil Code in that repo, the project-local layer picks up the committed team automatically.

```
.planning/
  team.json       <- committed
```

**Callout**: Whether to commit `.planning/team.json` is your call — committing shares the team definition with collaborators; gitignoring keeps it personal. If your team contains references to personal API keys or user-specific routing, add `.planning/team.json` to `.gitignore` instead.

### 3. User-level library

Maintain a personal library of team templates in `~/.local/share/kilo/teams/`. Export new teams here and import on other machines after cloning your dotfiles or syncing this directory.

```bash
team export ~/.local/share/kilo/teams/frontend-specialist.json
team export ~/.local/share/kilo/teams/devops-oncall.json
# on a new machine, after syncing ~/.local/share/kilo/teams/
team import ~/.local/share/kilo/teams/frontend-specialist.json
```

## Troubleshooting

**"Checksum failed — file may be corrupted"**
Cause: the envelope's `checksum` field does not match a freshly computed hash of the config. This usually means the file was modified after export (either manually or by a transfer tool that rewrote line endings). Resolution: re-export from the source and use a binary-safe transfer method.

**"Version mismatch: X.Y.Z (need 1.0.0)"**
Cause: the file was created by a newer or older Devil Code that uses a different schema version. Resolution: upgrade Devil Code to match, or ask the sender to re-export from a compatible install.

**"File not found: /path/to/file.json"**
Cause: the resolved path does not exist. Resolution: verify the path with `ls` (or equivalent), check file permissions, and ensure the path is correctly quoted if it contains spaces.

**"Schema invalid (envelope): N issue(s)"**
Cause: the envelope parsed as JSON but one or more fields did not match the expected schema (wrong types, missing required fields, malformed config subtree). Resolution: re-export from a current install; if the error persists, file an issue with the envelope attached.
