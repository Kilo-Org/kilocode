---
"@kilocode/cli": patch
---

Let sandboxed tools write regular `.git` marker files inside `sandbox.writable_paths`, so tools like uv can use their cache while `.git` directories stay read-only
