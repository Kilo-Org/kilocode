---
"@kilocode/cli": patch
---

Fix CLI UX issues: console lifecycle, cached token display, and session attention indicators

- `kilo console` now stays attached to the terminal by default so users can stop the daemon with Ctrl+C; use `--background` / `-b` to restore the old detach-and-exit behavior
- Token usage sidebar now shows "Cache Read" and "Cache Write" as separate fields instead of a combined (and inaccurate) "Cached" total
- Session list now displays a `!` attention indicator in warning color next to sessions that have pending permission requests awaiting user input
