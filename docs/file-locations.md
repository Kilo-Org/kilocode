# Kilo CLI — File Locations

> **Note:** This documents the **Kilo CLI** (`kilo`), not the Kilo Code VS Code extension. The CLI uses XDG base directories with app name `kilo`.

## Global Directories (XDG Base Directory Spec)

| Directory | Default Path (Linux) | macOS | Purpose |
|---|---|---|---|
| **data** | `~/.local/share/kilo/` | `~/Library/Application Support/kilo/` | Auth, telemetry ID, sessions, snapshots, binaries, logs |
| **cache** | `~/.cache/kilo/` | `~/Library/Caches/kilo/` | Model cache, npm packages, skills cache |
| **config** | `~/.config/kilo/` | `~/Library/Preferences/kilo/` | Global config, agents, commands, plugins |
| **state** | `~/.local/state/kilo/` | `~/Library/Application Support/kilo/` | State directory |

---

## Key Files in Global Data (`~/.local/share/kilo/`)

| Path | Description |
|---|---|
| `auth.json` | Provider authentication credentials |
| `mcp-auth.json` | MCP OAuth credentials |
| `telemetry-id` | Anonymous telemetry identifier |
| `storage/` | Session/project storage |
| `snapshot/<project-id>/` | File snapshots per project |
| `bin/` | Downloaded binaries (ripgrep, LSP servers) |
| `log/` | Application log files |

## Key Files in Global Cache (`~/.cache/kilo/`)

| Path | Description |
|---|---|
| `models.json` | Cached model definitions |
| `skills/` | Cached external skills |
| `version` | Cache version tracker (cache wiped on version mismatch) |

## Key Files in Global Config (`~/.config/kilo/`)

| Path | Description |
|---|---|
| `opencode.json` / `opencode.jsonc` | Global user configuration |
| `AGENTS.md` | Global instruction/prompt file |
| `agents/` | Global agent definitions |
| `commands/` | Global command definitions |

---

## Project-Level Files

| Path | Description |
|---|---|
| `opencode.json` / `opencode.jsonc` | Project configuration |
| `.opencode/` | Project config directory (agents, commands, plugins) |
| `.opencode/plans/` | Plan files (when VCS is present) |
| `AGENTS.md` | Project instruction file (highest priority) |
| `CLAUDE.md` | Alternative instruction file (Claude Code compatibility) |

## Home Directory

| Path | Description |
|---|---|
| `~/.opencode/` | User-level config directory (always scanned) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `KILO_CONFIG` | Path to custom config file |
| `KILO_CONFIG_DIR` | Path to custom config directory |
| `KILO_CONFIG_CONTENT` | Inline JSON config content |

---

## Config Precedence (low → high)

1. Legacy Kilocode configs
2. Global config (`~/.config/kilo/opencode.json`)
3. Custom config (`KILO_CONFIG`)
4. Project config (`opencode.json`)
5. `.opencode/` directories
6. `KILO_CONFIG_DIR`
7. Inline config (`KILO_CONFIG_CONTENT`)
8. Managed config (enterprise, highest priority)

---

## Quick Reference

**Reset all CLI state:**

```bash
rm -rf ~/.local/share/kilo ~/.cache/kilo ~/.config/kilo ~/.local/state/kilo
```

**Find your config:**

```bash
cat ~/.config/kilo/opencode.json
```

**Find your auth credentials:**

```bash
cat ~/.local/share/kilo/auth.json
```

**Clear model cache:**

```bash
rm ~/.cache/kilo/models.json
```
