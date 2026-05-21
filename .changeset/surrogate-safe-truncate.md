---
"@kilocode/cli": patch
"kilo-code": patch
---

Read tool truncation now snaps back when a UTF-16 surrogate pair would be split, so prior file reads no longer leave a lone surrogate in compacted tool output. Downstream JSON encoders (e.g. llama-server) previously rejected the resulting payload with a `surrogate U+D800..U+DBFF must be followed by U+DC00..U+DFFF` error that was unrecoverable for the session.
