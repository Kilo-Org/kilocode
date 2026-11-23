---
"kilo-code": patch
---

Show the permission card's description, paths, commands and diff file names in an escaped display form.

Characters that render without width now appear as literal escapes. That covers control characters, the
bidi marks and overrides, and the invisible format characters. It also covers two kinds of character that
ordinary text uses on purpose: an emoji presentation selector such as the one in `⚠️`, and the joiners that
combine emoji sequences or join the letters of Persian and Indic words. Those now show as `\ufe0f` and
`\u200d` in the card, so the displayed text names every character the request carries.
