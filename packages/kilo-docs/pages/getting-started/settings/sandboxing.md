---
title: "Sandboxing"
description: "Confine agent shell commands and file writes with the experimental OS-level sandbox"
---

# Sandboxing

The experimental sandbox runs agent shell commands and file-tool writes inside an OS-level sandbox that restricts filesystem writes to your project and Kilo state directories, and can block outbound network access from model-originated commands. It is an extra guardrail on top of the permission system: even if the agent is allowed to run a command, the operating system will deny writes outside the allowed roots.

{% callout type="warning" %}
Sandboxing is experimental. Behavior may change between releases, and it is not available on Windows.
{% /callout %}

## How it works

When enabled, the agent's shell commands and file-write tools run confined to a small set of writable directories:

- Your **project directory** (and its worktree, when running in a linked git worktree)
- Kilo **state directories**: data, cache, config, state, tmp, bin, log, and repos

Everything else is denied at the OS level. File **reads are not confined** — the agent can still read anywhere it has permission to. The `.git` directory is always denied for writes, regardless of location.

When network restriction is on (the default), outbound network access is blocked for:

- Shell commands originated by the model
- First-party HTTP tools (for example web fetch and browser tools)

The following are **not** affected by the network restriction:

- **Provider and model inference traffic** — your LLM API calls keep working
- **Local MCP servers and plugin hooks** — these run outside the restriction

## Enable the sandbox

The sandbox is off by default. Enable it under the `experimental` key in `kilo.jsonc`:

```json
{
  "experimental": {
    "sandbox": true,
    "sandbox_restrict_network": true
  }
}
```

| Key | Default | Effect |
|---|---|---|
| `experimental.sandbox` | `false` | Turn the sandbox on. When `false`, no confinement applies. |
| `experimental.sandbox_restrict_network` | `true` | Block outbound network from model-originated commands and HTTP tools. Set to `false` to allow network (filesystem confinement still applies). |

You can also enable it from the VS Code Settings webview: gear icon ({% codicon name="gear" /%}) → **Experimental** → **Sandbox**. Once the sandbox is on, a dedicated **Sandboxing** tab appears with the **Restrict Network Access** switch for `sandbox_restrict_network`.

## Toggle per session

Enabling `experimental.sandbox` sets the default for new sessions, but the setting is ephemeral per session and can be flipped without editing config:

- **VS Code**: a sandbox toggle appears in the prompt input when `experimental.sandbox` is on (not available for cloud sessions). The tooltip shows whether filesystem writes and network are restricted.
- **CLI / TUI**: run the `/sandbox` slash command or the **Toggle sandbox** palette command. A `◆ Sandbox on` indicator appears next to the prompt when active.

Toggling is in-memory and scoped to the current session, so it does not persist across restarts. If the OS sandbox backend is unavailable on your platform, the toggle reports the reason and confinement stays off.

## Platform support

| Platform | Backend | Notes |
|---|---|---|
| macOS | `sandbox-exec` (seatbelt) | Uses the system `/usr/bin/sandbox-exec`. |
| Linux | Bubblewrap (`bwrap`) | Uses system `/usr/bin/bwrap`, or a bundled, SHA-256-verified binary. Override the path with the `KILO_BWRAP_PATH` environment variable. The executable is probed at startup to confirm it can create the sandbox. |
| Windows | none | The sandbox backend is unavailable on Windows. Enabling the config has no effect. |

## Limitations

- **Windows is not supported.**
- Local MCP servers and plugin hooks are **not** covered by the network restriction.
- File **reads** are not confined — only writes and shell command effects are.
- Writable file handles are unavailable while the sandbox is active; writes are performed through a sandboxed worker, so some tools that open files for writing may behave differently.
- The sandbox is additive to the permission system, not a replacement. Permission rules still apply first.
