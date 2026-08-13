---
"kilo-code": minor
---

Make file references in agent responses clickable by validating inline code spans against the filesystem. Code spans that match real files in the workspace become clickable links that open the file at the referenced line. Non-existent paths stay as plain code. Also adds fallback workspace search and "File not found" warning when clicking dead links.
