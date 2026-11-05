---
"@kilocode/kilo-jetbrains": patch
---

The Agent Edit dialog's variant field only accepted digits, so named model variants like `high` could not be entered. It is now a selector fed by the selected model's available variants, with free-text entry kept for custom or previously saved values. Switching models reconciles a stale variant to the new model's options.
