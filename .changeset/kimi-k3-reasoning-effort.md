---
"@kilocode/cli": patch
---

Fix `kilo/moonshotai/kimi-k3` reasoning variant picker. The model previously inherited the generic `instant`/`thinking` toggle and `low`/`medium`/`high` effort set, which don't match what the Moonshot API accepts (`low`/`high`/`max`, default `max`). The picker now exposes `low`/`high`/`max` for the OpenAI-compatible and OpenRouter transports. The Anthropic-compatible endpoint additionally exposes `medium` and `xhigh` via the Anthropic adaptive effort set (Moonshot maps them internally: low→low, medium/high→high, xhigh/max→max).
