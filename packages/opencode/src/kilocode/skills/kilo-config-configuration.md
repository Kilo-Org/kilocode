# Kilo CLI Configuration Reference

All config lives in `kilo.json` (or `kilo.jsonc`). Precedence low-to-high: remote well-known, global (`~/.config/kilo/kilo.json`), env `KILO_CONFIG`, project `./kilo.json`, `.kilo/kilo.json`, `KILO_CONFIG_CONTENT`, managed (see Config File Locations). Deep-merged; later wins.

This also covers where Kilo looks for config files, commands, agents, and skills across project, global, and legacy paths such as `.kilo/`, `.kilocode/`, and `~/.config/kilo/`, plus Agent Manager setup/run scripts in the VS Code extension.

## Providers

```jsonc
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "sk-...",
        "baseURL": "https://custom.endpoint/v1",
        "timeout": 300000,
      },
      "models": {
        "custom-model": { "name": "My Model" },
      },
      "whitelist": ["claude-*"],
      "blacklist": ["claude-2*"],
    },
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],
}
```

### Disabling Built-in Providers

Use `disabled_providers` to prevent specific providers from loading. This is useful when you want to exclude providers that are built-in, or auto-detected via environment variables, from appearing in the model picker.

For example, this configuration will hide all models from the built-in Kilo Gateway as well as any from the OpenAI provider which may be enabled automatically through environment variables.

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "disabled_providers": ["kilo", "openai"],
}
```

The provider ID is the lowercase name used in the `provider/model` format (e.g., `kilo`, `openai`, `anthropic`, `google`, `groq`).

**Interaction with `enabled_providers`:**

- `disabled_providers` removes specific providers from the auto-loaded set
- `enabled_providers` is more restrictive — when set, ONLY the listed providers will be enabled, ignoring all others
- If both are set, providers must appear in `enabled_providers` and not appear in `disabled_providers`

To disable all auto-detected providers except one:

```jsonc
{
  "enabled_providers": ["anthropic"],
}
```

## Other Top-Level Fields

| Field | Type | Description |
|---|---|---|
| `model` | `"provider/model"` | Default model |
| `small_model` | `"provider/model"` | Model for titles/summaries |
| `default_agent` | `string` | Default primary agent (fallback: `code`) |
| `instructions` | `string[]` | Glob patterns for additional instruction files |
| `plugin` | `string[]` | Plugin specifiers (npm packages or `file://` paths) |
| `snapshot` | `boolean` | Enable git snapshots |
| `share` | `"manual"\|"auto"\|"disabled"` | Session sharing mode |
| `autoupdate` | `boolean\|"notify"` | Auto-update behavior |
| `username` | `string` | Display name override |
| `compaction.auto` | `boolean` | Auto-compact when context full (default: true) |
| `compaction.prune` | `boolean` | Prune old tool outputs (default: true) |

## Config File Locations

### Config files (kilo.json)

| Scope | Path |
|---|---|
| Project | `./kilo.json`, `./kilo.jsonc`, `./opencode.json` (legacy), `./opencode.jsonc` (legacy) |
| Global | `~/.config/kilo/kilo.json`, `~/.config/kilo/kilo.jsonc`, `~/.config/kilo/opencode.json` (legacy), `~/.config/kilo/opencode.jsonc` (legacy), `~/.config/kilo/config.json` (legacy) |
| Managed | Linux: `/etc/kilo/`, macOS: `/Library/Application Support/kilo/`, Windows: `%ProgramData%\kilo\` — loads `kilo.json`, `kilo.jsonc`, `opencode.json`, `opencode.jsonc` (enterprise, highest priority) |

Each config directory (`.kilo/` and legacy `.kilocode/`) can also contain `kilo.json`, `kilo.jsonc`, `opencode.json`, or `opencode.jsonc`.

### Config directories

Two directory names are scanned: `.kilo` (canonical) and `.kilocode` (legacy fallback). Both are checked at each level, and `.kilo` wins when both define the same entry. `.opencode` directories are not loaded.

- **Project**: walks up from CWD to the git worktree root, checking both directories at each level
- **Home**: `~/.kilo/` and `~/.kilocode/`
- **XDG global**: `~/.config/kilo/` (always loaded, lowest file-based precedence)

### Commands, agents, modes, plugins

Glob patterns run inside every discovered config directory (including legacy):

| Type | Pattern |
|---|---|
| Command | `{command,commands}/**/*.md` |
| Agent | `{agent,agents}/**/*.md` |
| Mode | `{mode,modes}/*.md` |
| Plugin | `{plugin,plugins}/*.{ts,js}` |

Example: `~/.config/kilo/command/*.md` (global), `~/.kilocode/command/*.md` (legacy home), and `.kilo/commands/*.md` (project) all load commands.

### Skills and instructions

| Scope | Path |
|---|---|
| Skills | `{skill,skills}/<name>/SKILL.md` inside any config directory |
| Instructions | `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, glob patterns from `instructions` config field |

### Environment variable overrides

| Variable | Description |
|---|---|
| `KILO_CONFIG` | Path to an additional config file (loaded after global) |
| `KILO_CONFIG_DIR` | Path to an additional config directory (appended to search list) |
| `KILO_CONFIG_CONTENT` | Inline JSON config string (high precedence, after project dirs) |
| `KILO_DISABLE_PROJECT_CONFIG` | Skip all project-level config (files and directories) |
