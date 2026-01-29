---
"@kilocode/cli": minor
---

The CLI now automatically detects your terminal's color scheme (light or dark) and applies the appropriate theme for optimal readability. Detection works by checking the `COLORFGBG` environment variable and other terminal-specific indicators. You can still manually override the theme in your config if desired.
