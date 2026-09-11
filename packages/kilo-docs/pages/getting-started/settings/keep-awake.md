---
title: "Keep Awake"
description: "Prevent system sleep while Kilo agents work"
---

# Keep Awake

Keep Awake prevents the computer from sleeping while Kilo sessions are running. It does not keep the display on and does not disable screen locking. Agents can continue to use files, network services, and available credentials while the computer is locked.

Keep Awake is off by default and is available on macOS, Linux, and Windows.

{% tabs %}
{% tab label="VS Code" %}

Turn Keep Awake on or off with any of these controls:

| Control | Action |
|---|---|
| Command Palette | Run **Toggle Keep Awake** (`kilo-code.new.toggleCaffeination`). |
| Chat slash command | Type `/caffeinate`. The aliases `/caffenate` and `/keep-awake` also work. |
| Agent Manager | Select the coffee icon in the Agent Manager header. |

The Agent Manager coffee icon reflects the same state as the other controls.

Kilo holds the sleep inhibitor only while at least one session is busy or retrying, and releases it when every session is idle. Keep Awake stops when the VS Code window reloads.

The first time you enable Keep Awake, VS Code asks for confirmation. The answer is stored in the extension's global state, not in `kilo.jsonc`. Enable Keep Awake only in a trusted workspace. It is not available in a remote window.

{% /tab %}
{% tab label="CLI" %}

In the terminal UI, run the `/caffeinate` slash command. The alias `/caffenate` works too. You can also use the **Enable Keep Awake** and **Disable Keep Awake** entries in the **System** command category.

Kilo holds the sleep inhibitor while any session is busy or retrying, and releases it when every session is idle. The first time you enable Keep Awake, a dialog explains what it does and asks you to confirm. The answer is stored in the TUI state, not in `kilo.jsonc`.

{% /tab %}
{% /tabs %}

{% callout type="warning" %}
Keep Awake prevents system sleep only. It does not keep the display on and does not disable screen locking. Agents may continue to access files, network services, and available credentials while the computer is locked. Enable it only if your organization's device policy permits it. On Linux, Keep Awake can also block manual suspend; turn it off before suspending.
{% /callout %}

## Platform support

| Platform | Mechanism |
|---|---|
| macOS | `/usr/bin/caffeinate` |
| Linux | `systemd-inhibit` |
| Windows | `SetThreadExecutionState` through PowerShell |

If the required command is not available, Kilo reports that Keep Awake is unavailable and does not start the inhibitor.
