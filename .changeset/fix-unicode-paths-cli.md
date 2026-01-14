---
"@kilocode/cli": patch
---

Fix empty files being created when project path contains non-Latin characters (e.g., Cyrillic, Chinese)

The CLI's `write_to_file` command was creating empty files when the project directory path contained non-Latin characters. This was caused by improper handling of `Uint8Array` content in the `FileSystemAPI.writeFile` method. The fix ensures proper `Buffer.from()` conversion before writing to the filesystem.
