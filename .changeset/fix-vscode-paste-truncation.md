---
"kilo-code": patch
---

Fix paste truncation in VSCode terminal

- Prevent React StrictMode cleanup from interrupting paste operations
- Remove `completePaste()` and `clearBuffers()` from useEffect cleanup
- Paste buffer refs now persist across React re-mounts and flush properly when paste end marker is received
