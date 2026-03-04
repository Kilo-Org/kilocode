# `kilo help --all` Implementation Plan

**Goal:** Add a `kilo help` command that outputs the full CLI reference (all commands and subcommands, including hidden ones) as Markdown or plain text; optionally scoped to a single subsystem with `kilo help <command>`.

**Architecture:** A new `HelpCommand` yargs `CommandModule` registered in `src/index.ts`. It accepts an optional positional `[command]`, an `--all` flag, and a `--format` flag (`md` | `text`). It programmatically builds child yargs instances for each command by reusing the existing `CommandModule` definitions, calls `getHelp()` on each, strips ANSI codes, and formats as Markdown sections or plain text. Output goes to stdout so it is pipeable (`kilo help --all > REFERENCE.md`).

**Tech Stack:** yargs 18, TypeScript, Bun

---

## Codebase Orientation

The repo is a Turborepo + Bun monorepo. All work happens in `packages/opencode/`.

- Entry point: `packages/opencode/src/index.ts` — builds the yargs `cli` instance and registers all commands.
- Commands live in `packages/opencode/src/cli/cmd/`. Each file exports a yargs `CommandModule` (e.g. `AuthCommand`, `RunCommand`).
- Group commands (those with subcommands) expose their subcommands via a `builder` function that calls `.command()` on the passed yargs instance. Example: `src/cli/cmd/auth.ts` registers `AuthLoginCommand`, `AuthLogoutCommand`, `AuthListCommand` inside its `builder`.
- The `cmd()` helper in `src/cli/cmd/cmd.ts` is just a thin type wrapper — ignore it for this feature.
- Run the CLI locally: `bun run --cwd packages/opencode --conditions=browser src/index.ts <args>`
- Run tests: `bun test` from `packages/opencode/` (NOT from repo root).
- Run a single test file: `bun test test/kilocode/help.test.ts` from `packages/opencode/`.
- Typecheck: `bun run typecheck` from `packages/opencode/` (uses `tsgo`, not `tsc`).
- This is a fork of opencode. Kilo-specific files in `src/kilocode/` do NOT need `// kilocode_change` markers. Files outside that directory that you modify DO need `// kilocode_change` markers on changed lines.

---

## Testing Plan

Create `packages/opencode/test/kilocode/help.test.ts`.

The tests import the formatter logic directly (not via subprocess) and assert on the rendered string output. They exercise the real command tree — no mocks.

**Tests to write:**

1. `--all` output contains a Markdown `##` heading for each known top-level command (`run`, `auth`, `debug`, `mcp`, `session`, `agent`).
2. `--all` output contains Markdown `##` headings for known nested subcommands (`kilo auth login`, `kilo auth logout`, `kilo debug config`).
3. `kilo help auth` output contains auth subcommand headings but does NOT contain `run` or `debug` headings.
4. Output contains no ANSI escape sequences (test with `/\x1b\[/.test(output)` === false).
5. Hidden commands are present in `--all` output and their section contains the word `internal` (case-insensitive).
6. `--format text` output does NOT contain Markdown `##` headings or triple-backtick fences.
7. `--format text` output for `--all` still contains each command name.
8. `kilo help nonexistent` throws or prints an error message containing "unknown command".

NOTE: I will write all tests before I add any implementation behavior.

---

## Task 1: Write the failing tests

**Files:**

- Create: `packages/opencode/test/kilocode/help.test.ts`

**Step 1: Write all tests described in the Testing Plan above.**

The test file should import a `generateHelp` function that will be created in Task 3. Since it does not exist yet, all tests will fail with an import error. That is expected.

Use `bun:test` (`import { describe, test, expect } from "bun:test"`).

Structure:

```
import { generateHelp } from "../../src/kilocode/help"

describe("kilo help --all (markdown)", () => { ... })
describe("kilo help --all (text)", () => { ... })
describe("kilo help <command>", () => { ... })
describe("edge cases", () => { ... })
```

`generateHelp` signature (design it for testability):

```ts
generateHelp(options: {
  command?: string   // undefined = all top-level commands
  all?: boolean      // if false and no command, callers should use yargs' built-in --help
  format?: "md" | "text"  // default "md"
}): Promise<string>
```

**Step 2: Run to confirm failure**

```bash
bun test test/kilocode/help.test.ts
```

Expected: FAIL — `../../src/kilocode/help` does not exist.

---

## Task 2: Extract command list into a shared barrel

The `generateHelp` function needs access to all registered commands. Currently they are inlined in `src/index.ts`. Extract them.

**Files:**

- Create: `packages/opencode/src/cli/commands.ts`
- Modify: `packages/opencode/src/index.ts`

**Step 1: Create `packages/opencode/src/cli/commands.ts`**

Export a `commands` array containing all `CommandModule` objects currently passed to `.command()` in `src/index.ts`. Import each command at the top of the file exactly as `src/index.ts` does today.

Do NOT include `TuiThreadCommand` if it is truly internal-only and not relevant to user-facing help. Check `src/cli/cmd/tui/thread.ts` — if it has `hidden: true`, still include it (the help formatter will handle hidden commands explicitly).

Do NOT include `HelpCommand` yet (it will be added in Task 4).

Mark the file with `// kilocode_change - new file` at the top since it is outside `src/kilocode/`.

**Step 2: Update `src/index.ts`**

Replace the `.command(X).command(Y)...` chain with imports from the barrel:

```ts
import { commands } from "./cli/commands" // kilocode_change
// ...
commands.forEach((c) => cli.command(c)) // kilocode_change
```

Keep the `// kilocode_change` markers on any changed lines.

**Step 3: Verify the CLI still works**

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts --help 2>&1 | grep "Commands:"
```

Expected: `Commands:` header present, all commands listed as before.

**Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

---

## Task 3: Implement `generateHelp` in `src/kilocode/help.ts`

**Files:**

- Create: `packages/opencode/src/kilocode/help.ts`

**Step 1: Implement `generateHelp`**

Key implementation points:

1. **Import the commands barrel** from `../cli/commands`.

2. **ANSI stripping:** Use `output.replace(/\x1b\[[0-9;]*m/g, "")`. The logo and UI helpers emit ANSI codes aggressively; every `getHelp()` result must be stripped.

3. **`wrap(null)`:** When constructing child yargs instances, always call `.wrap(null)`. Without this, yargs wraps lines at terminal width (80 chars), which breaks Markdown code blocks and makes text output ugly.

4. **Do not use the top-level `cli` yargs instance.** Build fresh child yargs instances inside `generateHelp` to avoid side effects.

5. **Walking the command tree:**
   - For each `CommandModule` in the commands list (or just the one matching `command` if scoped):
     - Build a fresh yargs instance: `yargs([]).scriptName("kilo").wrap(null)`.
     - If the `CommandModule` has a `builder` function, call `builder(instance)` to register subcommands.
     - Call `await instance.getHelp()` to get the help string.
     - Strip ANSI.
     - Record the command name and whether it is hidden (`CommandModule.hidden === true`).
     - Recurse: inspect the builder-returned yargs instance to find sub-`CommandModule`s. The cleanest approach is to keep a parallel list of subcommands: for group commands (auth, debug, mcp, session, agent), their `builder` files already import and register named subcommand objects — extract those by reading the source or by calling `instance.getCommandInstance?.()` (yargs internal). **Simpler approach:** For each group command, also call `builder` on a fresh yargs instance and call `.getHelp()` on the result to get the grouped help which lists subcommands; then iterate the known subcommand `CommandModule` objects directly (since they are already imported in the `*Command` files).

   The simplest correct approach is a **two-level walk**:
   - Level 1: all top-level commands from the barrel.
   - Level 2: for commands that have a `builder`, call `builder(fresh yargs)` and then call `.getHelp()` — this gives subcommand listings. But to get per-subcommand help, you need to build a yargs instance scoped to just that subcommand.

   **Recommended approach:** Create a small helper `getSubcommands(cmd: CommandModule): CommandModule[]`. For the known group commands, this is already available because their source files export the subcommand objects. Add a `subcommands?: CommandModule[]` property to each group command export (or co-locate a `subcommands` export in each group command file). This is cleaner than introspecting yargs internals.

   Actually — the simplest approach that avoids modifying every command file: build a yargs instance, call `builder` to register subcommands, then access `instance.getInternalMethods().getCommandInstance().getCommandHandlers()`. This is yargs internals but works in yargs 18. Verify it works before relying on it:

   ```ts
   const inst = yargs([]).scriptName("kilo").wrap(null)
   AuthCommand.builder(inst)
   const handlers = inst.getInternalMethods().getCommandInstance().getCommandHandlers()
   // handlers is a record of command name -> handler descriptor
   ```

   If this works, use it. If not, fall back to co-locating `subcommands` arrays in each group command file.

6. **Formatting:**

   _Markdown (`--format md`, default):_

   ```
   ## kilo auth

   ```

   {stripped help text}

   ```

   ### kilo auth login

   > **Internal command** — not intended for direct use.

   ```

   {stripped help text}

   ```

   ```

   Top-level commands get `##`, their subcommands get `###`. Hidden commands get the blockquote callout inserted before the code fence.

   _Text (`--format text`):_

   ```
   ================================================================================
   kilo auth
   ================================================================================

   {stripped help text}

   --- kilo auth login [internal] ---

   {stripped help text}

   ```

   No Markdown syntax. Hidden commands are noted with `[internal]` in the separator line.

7. **Scoped help (`command` option set):** Filter the top-level commands list to the one matching `command`. Error with a thrown `Error("unknown command: <command>")` if not found. Then walk that command's full subtree.

8. **Suppress the logo:** The top-level yargs instance registers `.usage("\n" + UI.logo())`. Child instances built inside `generateHelp` must NOT register this usage string. Since you are building fresh instances, this is automatic — just don't call `.usage(UI.logo())`.

**Step 2: Run tests**

```bash
bun test test/kilocode/help.test.ts
```

Expected: most tests PASS. Fix any failures before continuing.

**Step 3: Typecheck**

```bash
bun run typecheck
```

---

## Task 4: Implement `HelpCommand` and register it

**Files:**

- Create: `packages/opencode/src/kilocode/help-command.ts`
- Modify: `packages/opencode/src/cli/commands.ts`
- Modify: `packages/opencode/src/index.ts` (only if not using the barrel approach from Task 2)

**Step 1: Implement `HelpCommand`**

```ts
// packages/opencode/src/kilocode/help-command.ts
// kilocode_change - new file (in kilocode dir, no marker needed actually — it's in kilocode/)
```

The command shape:

```
command: "help [command]"
describe: "show help (--all for full reference, --format for output format)"
builder:
  positional "command": optional string, describe "command to show help for"
  option "all": boolean, default false, describe "show help for all commands"
  option "format": string, choices ["md", "text"], default "md", describe "output format"
handler(args):
  if not args.all and not args.command:
    // no-op: let yargs handle it, or print a usage hint
    // simplest: call process.stdout.write(await generateHelp({ all: true, format: args.format }))
    // Actually: print a short message directing to --all or <command>
    cli.showHelp()  // but we don't have cli here — just print to stdout via yargs help
    return
  const output = await generateHelp({
    command: args.command,
    all: args.all,
    format: args.format as "md" | "text",
  })
  process.stdout.write(output + "\n")
```

Note: `kilo help` with no arguments should print the standard top-level help (same as `kilo --help`). The cleanest way: if neither `--all` nor a positional is present, print a short usage message and exit 0. Do not attempt to call yargs internals for this case.

**Step 2: Add to commands barrel**

In `packages/opencode/src/cli/commands.ts`, import `HelpCommand` from `../../src/kilocode/help-command` and add it to the `commands` array.

**Step 3: Smoke test**

```bash
# Full reference, markdown
bun run --cwd packages/opencode --conditions=browser src/index.ts help --all 2>/dev/null | head -60

# Scoped to auth
bun run --cwd packages/opencode --conditions=browser src/index.ts help auth 2>/dev/null

# Scoped to auth, plain text
bun run --cwd packages/opencode --conditions=browser src/index.ts help auth --format text 2>/dev/null

# Pipe to file and check line count
bun run --cwd packages/opencode --conditions=browser src/index.ts help --all 2>/dev/null > /tmp/kilo-reference.md && wc -l /tmp/kilo-reference.md

# Unknown command error
bun run --cwd packages/opencode --conditions=browser src/index.ts help nonexistent 2>/dev/null; echo "exit: $?"
```

Expected for unknown command: error message printed, non-zero exit.

**Step 4: Run all tests**

```bash
bun test test/kilocode/help.test.ts
```

Expected: all PASS.

**Step 5: Full typecheck**

```bash
bun run typecheck
```

Expected: no errors.

---

## Task 5: Final checks and commit

**Step 1: Run full test suite**

```bash
bun test
```

Fix any regressions.

**Step 2: Typecheck**

```bash
bun turbo typecheck
```

**Step 3: Commit**

```bash
git add packages/opencode/src/kilocode/help.ts \
        packages/opencode/src/kilocode/help-command.ts \
        packages/opencode/src/cli/commands.ts \
        packages/opencode/src/index.ts \
        packages/opencode/test/kilocode/help.test.ts
git commit -m "feat: add kilo help --all command for full CLI reference in markdown or text"
```

---

**Testing Details:** Tests call `generateHelp()` directly with real command definitions (no mocks) and assert on the rendered string. They verify structural correctness (headings present/absent by scope), ANSI-free output, format differences between `md` and `text`, hidden command annotation, and error handling for unknown commands. This tests actual behavior — not yargs internals or data structures.

**Implementation Details:**

- `wrap(null)` on all child yargs instances is mandatory — without it yargs wraps at terminal width.
- `getHelp()` is async (`Promise<string>`); always `await` it.
- ANSI stripping regex `/\x1b\[[0-9;]*m/g` covers all SGR codes emitted by the logo and UI helpers.
- The logo (registered via `.usage("\n" + UI.logo())`) will NOT appear in child instances since you build fresh yargs instances — do not register usage there.
- Yargs 18 internal API `instance.getInternalMethods().getCommandInstance().getCommandHandlers()` can be used to discover registered subcommands at runtime. Verify it works before relying on it; fall back to co-locating `subcommands` arrays in group command files if needed.
- Hidden commands (`hidden: true` on a `CommandModule`) must appear in `--all` output with an explicit `[internal]` / `> **Internal command**` callout.
- `kilo help` (no args, no `--all`) should behave gracefully — print a short usage hint or delegate to yargs' built-in help. Do not error.
- Keep `HelpCommand` out of its own `--all` output, or accept that it appears (it is a valid command). Either is fine — just be consistent.
- The `commands.ts` barrel is a new file in a shared path; mark it `// kilocode_change - new file` at the top.

**Questions:**

- Should `kilo help --all --format text` use `---` separators or the `===` rule style? (Plan uses `===`; adjust to taste.)
- Should the `help` command itself appear in its own `--all` output? Probably yes — it's a real command users can discover.
- If `yargs.getInternalMethods().getCommandInstance().getCommandHandlers()` is not reliable, the fallback is adding `subcommands?: CommandModule[]` to each group command export. Confirm which approach works before finalizing Task 3.

---
