---
"@kilocode/kilo-jetbrains": patch
---

Show resolved JetBrains config file paths, float connection status above the prompt, and offer retry, restart, and reinstall recovery actions from connection errors. JetBrains now opens the same global config directory used by the CLI; macOS and Windows users who previously created global config from JetBrains may need to move files from the old platform-specific location to `~/.config/kilo`.
