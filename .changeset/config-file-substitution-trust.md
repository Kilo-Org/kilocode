---
"@kilocode/cli": patch
---

Harden config credential substitution against untrusted project config. Environment references (`{env:VAR}`) now resolve only in trusted config (global config, `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, and org/MDM-managed config); a project-committed `kilo.json` / `opencode.json` can no longer use them. File references (`{file:...}`) still work in project config but are confined to the project root, so absolute paths, `../` traversal, and symlink escapes are rejected. This closes a path where a malicious repository could exfiltrate local secrets to an attacker-controlled `baseURL`.
