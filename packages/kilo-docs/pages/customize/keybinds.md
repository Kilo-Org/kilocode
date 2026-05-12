---
title: "Keybinds"
description: "Customize keyboard shortcuts for the Kilo Code TUI"
platform: new
---

# Keybinds

Customize your keybinds.

Kilo Code has a list of keybinds that you can customize through `tui.json`.

```json {% filename="tui.json" %}
{
  "$schema": "https://opencode.ai/tui.json",
  "leader_timeout": 2000,
  "keybinds": {
    "leader": "ctrl+x",
    "app_exit": "ctrl+c,ctrl+d,<leader>q",
    "command_list": "ctrl+p",
    "editor_open": "<leader>e",
    "theme_list": "<leader>t",
    "sidebar_toggle": "<leader>b",
    "scrollbar_toggle": "none",
    "username_toggle": "none",
    "status_view": "<leader>s",
    "session_export": "<leader>x",
    "session_new": "<leader>n",
    "session_list": "<leader>l",
    "session_timeline": "<leader>g",
    "session_fork": "none",
    "session_rename": "ctrl+r",
    "session_delete": "ctrl+d",
    "session_share": "none",
    "session_unshare": "none",
    "session_interrupt": "escape",
    "session_compact": "<leader>c",
    "session_child_first": "<leader>down",
    "session_child_cycle": "right",
    "session_child_cycle_reverse": "left",
    "session_parent": "up",
    "stash_delete": "ctrl+d",
    "model_provider_list": "ctrl+a",
    "model_favorite_toggle": "ctrl+f",
    "model_list": "<leader>m",
    "model_cycle_recent": "f2",
    "model_cycle_recent_reverse": "shift+f2",
    "model_cycle_favorite": "none",
    "model_cycle_favorite_reverse": "none",
    "agent_list": "<leader>a",
    "agent_cycle": "tab",
    "agent_cycle_reverse": "shift+tab",
    "variant_cycle": "ctrl+t",
    "variant_list": "none",
    "messages_page_up": "pageup,ctrl+alt+b",
    "messages_page_down": "pagedown,ctrl+alt+f",
    "messages_line_up": "ctrl+alt+y",
    "messages_line_down": "ctrl+alt+e",
    "messages_half_page_up": "ctrl+alt+u",
    "messages_half_page_down": "ctrl+alt+d",
    "messages_first": "ctrl+g,home",
    "messages_last": "ctrl+alt+g,end",
    "messages_next": "none",
    "messages_previous": "none",
    "messages_last_user": "none",
    "messages_copy": "<leader>y",
    "messages_undo": "<leader>u",
    "messages_redo": "<leader>r",
    "messages_feedback_up": "<leader>=",
    "messages_feedback_down": "<leader>-",
    "messages_toggle_conceal": "<leader>h",
    "tool_details": "none",
    "display_thinking": "none",
    "input_clear": "ctrl+c",
    "input_paste": {
      "key": "ctrl+v",
      "preventDefault": false
    },
    "input_submit": "return",
    "input_newline": "shift+return,ctrl+return,alt+return,ctrl+j",
    "input_move_left": "left,ctrl+b",
    "input_move_right": "right,ctrl+f",
    "input_move_up": "up",
    "input_move_down": "down",
    "input_select_left": "shift+left",
    "input_select_right": "shift+right",
    "input_select_up": "shift+up",
    "input_select_down": "shift+down",
    "input_line_home": "ctrl+a",
    "input_line_end": "ctrl+e",
    "input_select_line_home": "ctrl+shift+a",
    "input_select_line_end": "ctrl+shift+e",
    "input_visual_line_home": "alt+a",
    "input_visual_line_end": "alt+e",
    "input_select_visual_line_home": "alt+shift+a",
    "input_select_visual_line_end": "alt+shift+e",
    "input_buffer_home": "home",
    "input_buffer_end": "end",
    "input_select_buffer_home": "shift+home",
    "input_select_buffer_end": "shift+end",
    "input_delete_line": "ctrl+shift+d",
    "input_delete_to_line_end": "ctrl+k",
    "input_delete_to_line_start": "ctrl+u",
    "input_backspace": "backspace,shift+backspace",
    "input_delete": "ctrl+d,delete,shift+delete",
    "input_undo": "ctrl+-,super+z",
    "input_redo": "ctrl+.,super+shift+z",
    "input_word_forward": "alt+f,alt+right,ctrl+right",
    "input_word_backward": "alt+b,alt+left,ctrl+left",
    "input_select_word_forward": "alt+shift+f,alt+shift+right",
    "input_select_word_backward": "alt+shift+b,alt+shift+left",
    "input_delete_word_forward": "alt+d,alt+delete,ctrl+delete",
    "input_delete_word_backward": "ctrl+w,ctrl+backspace,alt+backspace",
    "history_previous": "up",
    "history_next": "down",
    "terminal_suspend": "ctrl+z",
    "terminal_title_toggle": "none",
    "tips_toggle": "<leader>h",
    "news_toggle": "none",
    "plugin_manager": "none"
  }
}
```

{% callout type="warning" title="Keybind Conflict: <leader>h" %}
Both `messages_toggle_conceal` and `tips_toggle` default to `<leader>h`. This means pressing `<leader>h` will trigger whichever binding is matched first. To resolve the conflict, override one of them in your `tui.json`:

```json {% filename="tui.json" %}
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {
    "tips_toggle": "none"
  }
}
```

Replace `"none"` with any key combination you prefer, or set the value to `false` to disable the binding entirely.
{% /callout %}

{% callout type="note" title="Windows Defaults" %}
On Windows, the defaults for `input_undo` and `terminal_suspend` are different:

- `input_undo` defaults to `ctrl+z,ctrl+-,super+z` when it is not explicitly configured. The `ctrl+z` binding is added because Windows terminals do not support POSIX suspend.
- `terminal_suspend` is forced to `none` because native Windows terminals do not support POSIX suspend.
{% /callout %}

## Leader Key

Kilo Code uses a `leader` key for many keybinds. This avoids conflicts in your terminal.

By default, `ctrl+x` is the leader key and many actions require you to first press the leader key and then the shortcut. For example, to start a new session you first press `ctrl+x` and then press `n`.

You don't need to use a leader key for your keybinds but we recommend doing so.

Some navigation keybinds intentionally do not use the leader key by default. For subagent sessions, the defaults are `session_child_first` = `<leader>down`, `session_child_cycle` = `right`, `session_child_cycle_reverse` = `left`, and `session_parent` = `up`.

`leader_timeout` controls how long Kilo Code waits for the next key after the leader key. It defaults to `2000` milliseconds.

## Binding Values

A string can contain one shortcut or multiple comma-separated shortcuts. You can also use an array for multiple shortcuts.

For advanced cases, use an object with `key`, `event`, `preventDefault`, or `fallthrough`.

```json {% filename="tui.json" %}
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {
    "messages_copy": ["<leader>y", "ctrl+shift+c"],
    "input_paste": {
      "key": "ctrl+v",
      "preventDefault": false
    }
  }
}
```

## Disable Keybind

You can disable a keybind by adding the key to `tui.json` with a value of `"none"` or `false`.

```json {% filename="tui.json" %}
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": {
    "session_compact": "none"
  }
}
```

## TUI Prompt Shortcuts

The Kilo Code TUI prompt input supports common Readline/Emacs-style shortcuts for editing text. These are built-in and currently not configurable via `tui.json`.

| Shortcut | Action |
|---|---|
| `ctrl+a` | Move to start of current line |
| `ctrl+e` | Move to end of current line |
| `ctrl+b` | Move cursor back one character |
| `ctrl+f` | Move cursor forward one character |
| `alt+b` | Move cursor back one word |
| `alt+f` | Move cursor forward one word |
| `ctrl+d` | Delete character under cursor |
| `ctrl+k` | Kill to end of line |
| `ctrl+u` | Kill to start of line |
| `ctrl+w` | Kill previous word |
| `alt+d` | Kill next word |
| `ctrl+t` | Transpose characters |
| `ctrl+g` | Cancel popovers / abort running response |

## Shift+Enter

Some terminals don't send modifier keys with Enter by default. You may need to configure your terminal to send `Shift+Enter` as an escape sequence.

### Windows Terminal

Open your `settings.json` at:

```
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
```

Add this to the root-level `actions` array:

```json
"actions": [
  {
    "command": {
      "action": "sendInput",
      "input": "\u001b[13;2u"
    },
    "id": "User.sendInput.ShiftEnterCustom"
  }
]
```

Add this to the root-level `keybindings` array:

```json
"keybindings": [
  {
    "keys": "shift+enter",
    "id": "User.sendInput.ShiftEnterCustom"
  }
]
```

Save the file and restart Windows Terminal or open a new tab.
