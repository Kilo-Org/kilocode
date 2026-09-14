# Kilo TUI Settings (Ctrl+P Command Palette)

The CLI TUI has runtime settings accessible via `Ctrl+P` (command palette) or slash commands. **These are user-interactive only; the agent cannot change them programmatically.** When users ask to change these settings, tell them which command palette entry, keybind, or slash command to use.

Leader key default: `ctrl+x`. Keybinds below use `<leader>` prefix (e.g. `<leader>t` = `ctrl+x` then `t`).

## Theme & Appearance

| Action | Keybind | Slash | Notes |
|---|---|---|---|
| Switch theme | `<leader>t` | `/themes` | Pick from 35+ built-in themes (kilo, catppuccin, dracula, github, gruvbox, nord, tokyonight, etc.) |
| Toggle appearance (dark/light) | - | - | Ctrl+P: "Toggle appearance" |

Custom themes: place JSON files in `~/.config/kilo/themes/` or `.kilo/themes/`.

## Session

| Action | Keybind | Slash |
|---|---|---|
| List sessions | `<leader>l` | `/sessions` |
| New session | `<leader>n` | `/new`, `/clear` |
| Share session | - | `/share` |
| Rename session | `ctrl+r` | `/rename` |
| Jump to message | `<leader>g` | `/timeline` |
| Fork from message | - | `/fork` |
| Compact/summarize | `<leader>c` | `/compact`, `/summarize` |
| Undo message | `<leader>u` | `/undo` |
| Redo | `<leader>r` | `/redo` |
| Copy last response | `<leader>y` | `/copy` |
| Copy transcript | - | `/copy-session` |

## Agent & Model

| Action | Keybind | Slash |
|---|---|---|
| Switch model | `<leader>m` | `/models` |
| Switch agent | `<leader>a` | `/agents` |
| Toggle MCPs | - | `/mcps` |
| Cycle agent | `tab` / `shift+tab` | - |

## Display Toggles (via Ctrl+P)

Toggle animations, Toggle diff wrapping, Toggle sidebar (`<leader>b`), Toggle thinking (`/thinking`), Toggle tool details, Toggle timestamps (`/timestamps`), Toggle scrollbar, Toggle header, Toggle code concealment (`<leader>h`).

Notification settings are managed through `attention` in `tui.json` / `tui.jsonc`. There is no notification slash command or command-palette toggle.

## System

| Action | Slash |
|---|---|
| View status | `/status` |
| Help | `/help` |
| Exit | `/exit`, `/quit`, `/q` |
| Open editor | `/editor` |
