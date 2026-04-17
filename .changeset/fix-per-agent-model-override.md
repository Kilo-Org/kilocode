---
"@kilocode/cli": patch
"kilo-code": patch
---

Respect per-agent model selections when an agent has a `model` configured in `kilo.jsonc`. Switching the model for such an agent now sticks across agent switches and CLI restarts. To pick up a newly edited agent default, re-select the model once (or clear `~/.local/share/kilo/storage/model.json`).
