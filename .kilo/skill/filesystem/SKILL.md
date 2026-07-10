---
name: filesystem
description: Safe file operations in this source build — native edit/write tools are unavailable, so all writes go through bash (bun/node scripts, heredocs). Includes path conventions, storage layout, and git rules.
---

# Filesystem in this source build

## Critical constraint
When `edit`/`write` tools are denied or unavailable, use safe shell/file commands (bash, Bun/Node scripts, heredocs) instead. If they are available, prefer them.

## Safe edit pattern (preferred)
Use a short bun/node script: read the file, transform a string, write it back. This avoids fragile inline sed/awk and gives precise control over escaping.
```bash
bun -e 'const f="src/x.ts";const s=require("fs").readFileSync(f,"utf8");/* transform */require("fs").writeFileSync(f,s)'
```
Or write a temp script file, run it, then delete it.

## Heredoc pitfalls
When using `cat > file <<'EOF'`:
- Always QUOTE the delimiter (`<<'EOF'`) so the shell does NOT expand `$`, backticks, or backslashes.
- Inside a JS string in that script, `\n` becomes a REAL newline and `\n` is often mangled by the shell. To emit a LITERAL backslash sequence (e.g. source `.join("\n")`), use:
  - `String.raw` templates: `String.raw\`...join("\n")...\`` keeps backslashes literal, OR
  - `String.fromCharCode(0x5C)` for a backslash and concatenate, keeping the heredoc free of backslashes entirely.
- For unicode control chars (BOM/RLO/ZWSP/WJ) in test data, prefer `String.fromCharCode(0x202E)` etc. over pasting raw bytes.

## Reading / searching (native tools work fine)
Use `read`, `grep` (ripgrep), and `glob`. Prefer these over shell `cat`/`find`/`head`.

## Path conventions
- Monorepo root: `C:\Users\seand\kilocode`. CLI source: `packages/opencode/`.
- Workspace config/agents/skills: `.kilo/` at repo root. Kilo-specific extension assets: `.kilocode/`.
- Runtime storage: `~/.local/share/kilo/storage/`. Persistent memory: `kilocode/memory/<project-id>/<encodeURIComponent(key)>.json`.
- Never modify shared `packages/opencode/src/**` files (outside `src/kilocode/`) without `kilocode_change` markers.

## Git
- Use bash `git`. Commits/pushes are driven by the human via pasted PowerShell — do NOT commit or push unless explicitly told.
- Windows process spawning: use `Process.spawn` (enforces `windowsHide: true`) to avoid flashing a console window.

## Subagents
Subagents are similarly restricted (no native edit/write; `reviewer` is read-only by design). Point them at this same bash-based workflow whenever they must write files.
