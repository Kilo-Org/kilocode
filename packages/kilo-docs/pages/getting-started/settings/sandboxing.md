---
title: "Sandboxing"
description: "Understand and configure filesystem write and network restrictions for agent tools"
---

# Sandboxing

The sandbox adds an operating-system boundary around agent tools. It limits where tools can write and, by default, blocks outbound network access from model-originated commands. This boundary applies even when a tool passes Kilo's permission checks.

The sandbox is **disabled by default**. It does not restrict filesystem reads. An agent can still read any file that your user account can read, but it can write only to explicitly allowed locations.

{% callout type="warning" %}
Sandboxing is not available on Windows. If the macOS or Linux sandbox backend is unavailable, Kilo reports the reason and runs tools without sandbox confinement. The sandbox does not fail closed.
{% /callout %}

## Enable the sandbox

In the VS Code extension:

1. Open Kilo Code Settings using the gear icon ({% codicon name="gear" /%}).
2. Select **Sandboxing**.
3. Turn on **Sandbox**.
4. Keep **Restrict Network Access** on unless the agent's commands need outbound network access.
5. Save the settings.

The **Sandboxing** tab is visible to all macOS and Linux users, including when the sandbox is off. Windows users do not see the tab because no Windows backend is available.

You can also configure the default in the global `kilo.jsonc` file:

```json
{
  "sandbox": {
    "enabled": true,
    "network": "deny",
    "writable_paths": ["~/shared-output"]
  }
}
```

| Key | Default | Effect |
|---|---|---|
| `sandbox.enabled` | `false` | Use sandbox confinement by default for new sessions. |
| `sandbox.network` | `"deny"` | Control outbound network access while filesystem confinement is active. Set this to `"allow"` to permit network access without removing filesystem write restrictions. |
| `sandbox.writable_paths` | `[]` | Add writable files or directories outside the built-in writable locations. Only global config may set these paths. |

Project config may tighten sandbox policy by setting `enabled` to `true` or `network` to `"deny"`. It cannot disable a globally enabled sandbox, allow network denied by global config, or add writable paths. This prevents repository-controlled configuration from weakening the user's security boundary.

## When to use sandboxing

Use the sandbox when the agent may run unfamiliar commands, install dependencies, execute code from an untrusted repository, or process content that could contain prompt injection. It provides a second boundary if the model makes a mistake or follows malicious instructions embedded in source files, issue text, web pages, or tool output.

The sandbox can reduce the impact of an unsafe tool call by:

- Preventing writes outside the workspace and other explicitly writable locations
- Keeping sandboxed commands from changing `.git` metadata
- Blocking direct outbound connections from sandboxed commands and policy-aware tools when network restriction is on
- Applying the same restrictions to child processes, such as package installation and build scripts launched by a shell command

This can reduce the risk of auto-approving selected routine commands, such as builds and tests, by placing operating-system limits around many of their effects. It does **not** make **Allow Everything** safe. An allowed command can still modify or delete workspace files, alter other writable Kilo directories, consume data it can read, or write unsafe code that runs later outside the sandbox.

The sandbox does not protect against every result of prompt injection. In particular, it does not prevent the agent from reading accessible files or including their contents in model context. It also cannot confine local MCP servers, plugin hooks, or any integration that runs outside the sandbox boundary.

{% callout type="warning" %}
The network sandbox is not a provider privacy control. Provider and model inference traffic remains available. If Kilo reads a secret and includes it in a prompt, tool result, or conversation context, that content may be sent to the configured model provider even while network restriction is on. Choose providers with data-handling policies appropriate for your work, consider a local model for sensitive projects, and use read permissions to block or prompt for sensitive files. See [Prompt-Training Model Visibility](/docs/getting-started/settings#prompt-training-model-visibility).
{% /callout %}

## Sandboxing and permissions

Permissions and sandboxing solve different parts of the security problem and work best together.

| Control | What it decides | Best used for |
|---|---|---|
| Permissions | Whether Kilo allows, asks about, or denies a matching tool invocation | Prompting for sensitive file reads, blocking specific commands or tools, reviewing consequential actions, and limiting MCP tool or subagent invocation |
| Sandbox | What an allowed tool call can change or connect to while it runs | Limiting the impact of model mistakes, prompt injection, malicious dependencies, and unexpected child-process behavior |

Permissions can ask or deny Kilo tool invocations that read or change data. For example, set `read` or `external_directory` rules to `ask` or `deny` for credentials, personal files, or directories the agent does not need. Kilo's `read` tool also prompts for `.env` and `.env.*` unless you explicitly create a matching sensitive-file rule. See [Agent Permissions](/docs/customize/agent-permissions) for path and command rules.

Permission rules are tool-specific and do not create a complete file-confidentiality boundary. A `read` denial controls Kilo's file-reading tool, but an allowed `grep` call, shell command, build script, or other process may read the same file through a different path. A child process can also print sensitive content into tool output, which may then become model context. Configure `grep`, `bash`, and other data-accessing tools separately, and avoid running untrusted code when sensitive files remain readable by your operating-system account.

For a given tool invocation, approving a shell command does not grant writes outside the sandbox, and a path being writable inside the sandbox does not bypass a matching permission rule. Some integration code runs outside this boundary: plugin hooks can run before a tool's internal permission check, and a local MCP server starts as a separate trusted process. MCP permissions control exposed tool invocations, not everything the server process can do during startup or in the background. Enable only local MCP servers and plugins you trust.

A practical setup for work on unfamiliar or partially trusted code is:

- Keep `read`, `grep`, and unnecessary external-directory access set to `ask` or `deny` when they may expose sensitive content.
- Allow only routine tools and command patterns that you want to run without interruption.
- Keep shell approval prompts for commands with important in-workspace effects or commands that can read sensitive data, because the sandbox still allows workspace writes and filesystem reads.
- Enable the sandbox and keep network restriction on to reduce write and direct network-exfiltration impact if an approved action behaves unexpectedly.
- Add extra writable paths only when a known workflow requires them.

For a stronger confidentiality boundary, remove sensitive files from the environment or run Kilo under a separate operating-system account, container, or virtual machine that cannot read them. If file contents must not leave your machine, use local inference and disable other integrations that can send data over the network. If remote processing is acceptable, choose a provider with data-handling terms suitable for the data involved.

Configure these rules in **Settings > Auto Approve** or `kilo.jsonc`. See [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions) for the settings UI and default permission behavior.

## Filesystem restrictions

When the sandbox is active, agent tools can read files normally. The sandbox restricts writes, including creating, changing, renaming, and deleting files.

Writes are allowed in:

- The active workspace or worktree
- Kilo's runtime directories listed below
- Paths listed in `sandbox.writable_paths`

| Writable Kilo path | Purpose |
|---|---|
| `$XDG_DATA_HOME/kilo` (normally `~/.local/share/kilo`) | Session data, logs, and Kilo's managed repository cache under `repos/` |
| `$XDG_CACHE_HOME/kilo` (normally `~/.cache/kilo`) | Cached data and downloaded binaries |
| `$XDG_CONFIG_HOME/kilo` (normally `~/.config/kilo`) | Configuration and installed plugins |
| `$XDG_STATE_HOME/kilo` (normally `~/.local/state/kilo`) | Runtime state |
| `$TMPDIR/kilo` | Temporary files; on macOS this is commonly under `/var/folders/.../T/kilo` |

Writes are denied everywhere else. The following rules still apply inside writable locations:

- `.git` directories are always read-only to sandboxed tools.
- Kilo's stored sandbox policy and preference files are read-only.
- A permission approval for a path outside the sandbox does not make that path writable. Add the path to **Additional Writable Paths** if the tool must modify it.
- Linked worktree sessions can write to their active worktree, not the primary checkout or sibling worktrees.

Shell commands and their child processes inherit the same restrictions. Kilo's file tools perform mutations through a sandboxed worker. Writable file handles are unavailable, so a tool that requires an open read-write handle may fail even for an allowed path.

Because Kilo's config directory is writable, a shell command can change configuration, permissions, plugins, or additional writable paths that affect future tool calls. Direct filesystem access inside trusted integrations is confined only when the integration uses Kilo's sandbox-aware filesystem service. Starting or restarting a process with the background-process tool is unavailable while sandboxing is active.

{% callout type="info" %}
The sandbox is a write boundary, not a privacy boundary. It does not prevent an agent from reading files outside your workspace if your operating-system account can read them.
{% /callout %}

## Network restrictions

**Restrict Network Access** controls outbound network access independently of filesystem writes. Turning it off leaves the filesystem write restrictions active.

When network restriction is on, Kilo blocks:

- Outbound network access from model-originated shell commands and their child processes
- Requests from built-in HTTP tools such as web fetch and web search
- Remote MCP tool calls and custom or plugin tools that Kilo cannot prove will remain offline
- Built-in tools such as codebase search, semantic search, and LSP that may use opaque or indirect network access

Network restriction does not block:

- Provider and model inference traffic, so conversations with the selected model continue to work
- Local MCP server processes
- Plugin hooks that run outside the sandboxed tool execution
- Filesystem reads

This is not a system-wide firewall. It applies to the sandboxed tool execution boundary, not every Kilo, extension, or local process. Proxy environment variables are removed from sandboxed commands while network access is restricted.

## Session behavior

The config setting supplies the initial default for new sessions that do not have a saved preference. Use the lock button in the VS Code prompt or `/sandbox` in the CLI to change the current session. Your latest choice is saved as the default for future sessions in that project, takes precedence over the config default, and persists across restarts.

Each initialized session keeps its sandbox enabled state and network mode. Changing those settings affects new sessions; use the prompt control or `/sandbox` to change an existing session's enabled state. Changes to **Additional Writable Paths** are read when tools run and therefore also apply to existing sandboxed sessions.

Forked sessions retain the source session's confinement. Subagents inherit the stricter combination of the parent and child settings: sandboxing remains enabled if either requires it, and network remains blocked if either requires blocking.

Cloud sessions do not expose the local sandbox control because their tools do not run in your local sandbox.

## Platform support

| Platform | Backend | Notes |
|---|---|---|
| macOS | `sandbox-exec` (Seatbelt) | Uses a Seatbelt profile through `/usr/bin/sandbox-exec`. |
| Linux | Bubblewrap (`bwrap`) | Uses system `/usr/bin/bwrap` or a bundled, SHA-256-verified binary. `KILO_BWRAP_PATH` can select another binary. Kilo probes filesystem and network namespace support before enabling confinement. Additional writable paths must already exist before Bubblewrap starts. |
| Windows | None | Unsupported. The VS Code settings and prompt controls are hidden, and enabling the config has no effect. |
