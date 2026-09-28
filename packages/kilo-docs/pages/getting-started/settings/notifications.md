---
title: "Notifications"
description: "Configure sounds and alerts when Kilo needs your attention"
---

# Notifications

Kilo can play a sound, show a VS Code notification, or show a native operating system notification when a session needs your attention. All three are off by default.

{% tabs %}
{% tab label="VS Code" %}

Open Kilo Code Settings with the gear icon ({% codicon name="gear" /%}) and select **Notifications**.

| Setting | Key | Default | Effect |
|---|---|---|---|
| Enable Sound Notifications | `kilo-code.new.attention.enabled` | `false` | Play a sound when a session completes, errors, or needs input. |
| Sound | `kilo-code.new.attention.sound` | `default` | Select the sound. `default` uses a different sound per event; other choices use one sound for every event. |
| Enable OS Notifications | `kilo-code.new.attention.OSNotifications` | `false` | Show a native notification when the VS Code window is not focused. |
| Enable VS Code Notifications | `kilo-code.new.attention.notifications` | `false` | Show a VS Code notification when the affected session is not visible. |

The sound picker and its **Test** button appear when sound notifications are enabled. **Test** plays the selected sound.

The **Enable OS Notifications** row appears on macOS, Linux, and Windows. Its **Test** button sends a real native notification and reports success or failure.

These settings are stored in your VS Code settings under `kilo-code.new.attention.*`. They are not part of `kilo.jsonc`.

### When Kilo notifies you

Kilo alerts on these events:

- A session completes a turn.
- A session needs your input.
- A session needs permission.
- A session stops because of an error.

These rules apply to every channel:

- Error notifications are held until the errored turn closes, so a retry that recovers reports completion instead of failure.
- Completion alerts are suppressed while the session has an active goal.
- A repeated request for the same question or permission alerts only once.
- Manual aborts and auto-approved permissions do not alert.
- Completion and error alerts come from root sessions only. Subagent turns do not alert.

Alert text is translated into the extension's supported display languages.

### Channels

Each enabled channel decides independently. The OS notification follows window focus, and the VS Code notification follows session visibility.

| VS Code window | Affected session | Native OS notification | VS Code notification |
|---|---|---|---|
| Focused | Visible | No | No |
| Focused | Not visible | No | Yes |
| Not focused | Visible | Yes | No |
| Not focused | Not visible | Yes | Yes |

Both channels can fire for the same event. The VS Code notification includes the workspace and session names and a **Show** button. **Show** focuses the Kilo sidebar and opens the session at its latest message.

### Native notification support

| Platform | Backend |
|---|---|
| macOS | `osascript` |
| Linux | `notify-send` (libnotify) |
| Windows | PowerShell toast |

On Windows, Kilo reads the running editor's `win32AppUserModelId` from its `product.json` to attribute the toast. If that identity is missing or invalid, native notifications are unavailable and the **Test** button reports an error. VS Code notifications still work.

{% /tab %}
{% tab label="CLI" %}

CLI attention behavior is configured in `tui.json` or `tui.jsonc`, not in the VS Code settings. See [CLI Notifications and Sounds](/docs/code-with-ai/platforms/cli#cli-notifications-and-sounds) for the configuration keys, sound overrides, and platform notes.

{% /tab %}
{% /tabs %}
