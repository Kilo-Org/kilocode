---
title: "Migrating from Roo Code"
description: "Guide for migrating to Kilo Code from Roo Code"
---

# Migrating from Roo Code

Kilo Code is built on the same foundation as Roo Code, so the transition is straightforward. Most of your existing configuration — custom modes, rules, and API keys — carry over with minimal effort.

{% callout type="warning" title="Task History Is Not Migrated" %}
Your existing Roo Code task/conversation history is **not** automatically migrated. Kilo Code stores history in a different location on the filesystem:

- **Linux:** `~/.local/share/kilo/storage/session/`
- **macOS:** `~/Library/Application Support/kilo/storage/session/`

Your Roo Code history remains accessible via Roo Code. You can keep both extensions installed side-by-side during the transition.
{% /callout %}

## What Migrates Automatically

When you install Kilo Code, it automatically imports the following from Roo Code on first launch:

- **API keys and provider configuration** — your connected AI providers are imported
- **Model selections** — your preferred models per mode are preserved
- **VS Code settings** — extension settings stored in VS Code's settings.json are carried over

## What You Need to Migrate Manually

### Custom Modes

Roo Code stores custom modes in `~/.roo-code/custom_modes.yaml` (global) or `.roo-code/modes.yaml` (per-project). Copy these to the Kilo Code equivalents:

```bash
# Global custom modes
cp ~/.roo-code/custom_modes.yaml ~/.kilocode/custom_modes.yaml

# Per-project custom modes
cp .roo-code/modes.yaml .kilocode/modes.yaml
```

### Custom Rules

Roo Code rules live in `.roo/rules/` and `.roo/rules-{mode}/`. The Kilo Code equivalents are `.kilocode/rules/` and `.kilocode/rules-{mode}/`:

```bash
# Copy all project rules
cp -r .roo/rules/ .kilocode/rules/

# Copy mode-specific rules (repeat for each mode)
cp -r .roo/rules-code/ .kilocode/rules-code/
cp -r .roo/rules-debug/ .kilocode/rules-debug/
```

### Global Rules

```bash
# Global rules stored in home directory
cp -r ~/.roo/rules/ ~/.kilocode/rules/
```

### MCP Configuration

If you configured MCP servers in Roo Code, copy the config to Kilo Code's location. Check your Roo Code MCP settings and re-add them via **Kilo Code Settings → MCP Servers**.

## What's Not Migrated

| Item | Status | Notes |
|---|---|---|
| Task/conversation history | **Not migrated** | Stays in Roo Code's storage directory |
| Custom rules (`.roo/rules/`) | Manual copy required | See steps above |
| Custom modes | Manual copy required | See steps above |
| API keys | Auto-imported | Happens on first launch |
| Model preferences | Auto-imported | Happens on first launch |
| MCP servers | Manual re-configuration | Re-add via Settings → MCP Servers |

## Running Both Extensions Side-by-Side

You can install Kilo Code while keeping Roo Code active. They use separate storage directories and do not interfere with each other, so you can:

- Continue existing Roo Code conversations in Roo Code
- Start new conversations in Kilo Code
- Compare outputs side-by-side

When you're confident in the transition, you can disable or uninstall Roo Code from the VS Code Extensions panel.

## Post-Migration Checklist

- [ ] **Verify API providers connected:** Open Settings → Providers and confirm your keys are present
- [ ] **Copy custom rules:** Check `.kilocode/rules/` contains your rules
- [ ] **Copy custom modes:** Verify your modes appear in the mode selector
- [ ] **Re-add MCP servers:** Configure any MCP servers you were using
- [ ] **Test a task:** Run a task to confirm everything works as expected

## Next Steps

- [Learn about Custom Rules](/docs/customize/custom-rules)
- [Explore Custom Modes](/docs/customize/custom-modes)
- [Configure MCP Servers](/docs/customize/mcp)
- [Join our Discord](https://kilo.ai/discord) for migration support
