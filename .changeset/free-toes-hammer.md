---
"kilo-code": patch
---

fix(mentions): process slash commands in tool_result blocks

Previously, parseKiloSlashCommands was only called for text blocks,
causing slash commands in tool_result blocks to be ignored. This fix
extends the processing to tool_result blocks by using the new
processTextContent helper function that combines parseMentions and
parseKiloSlashCommands.

The regression test ensures that slash commands in tool responses are
properly processed and transformed.
