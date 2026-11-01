---
"kilo-code": patch
---

Replay assistant reasoning on Kilo Gateway reasoning models so multi-turn tool calls stop failing with a missing reasoning_content error

Reasoning-capable models served through Kilo Gateway — Beam 1.0 free
(`kilo/reflection/beam-free`), Kimi K2 thinking, MiMo and similar — require the
previous assistant turn's inference content to be sent back on every request.
They answer with a bare `reasoning` string instead of OpenRouter
`reasoning_details`, so the replayed assistant message carried no reasoning at
all and the next turn failed with
`400 Missing required parameter: messages[N].reasoning_content`, typically right
after a tool call.

`ProviderTransform.message` now backfills the OpenRouter reasoning replay detail
from the message's reasoning parts for Kilo Gateway reasoning models whose turn
contains non-empty reasoning text and that do not already carry usable
provider-supplied details. Turns with empty reasoning text, models that already
replay real details, and every non-Kilo-Gateway provider are unchanged.
