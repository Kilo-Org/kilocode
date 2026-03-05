# Desktop File Group Review — PR #6622 (OpenCode v1.2.16)

## Files Reviewed

| #   | File                                               | Status   | +/-     |
| --- | -------------------------------------------------- | -------- | ------- |
| 1   | `packages/desktop/scripts/finalize-latest-json.ts` | added    | +159/-0 |
| 2   | `packages/desktop/src-tauri/src/cli.rs`            | modified | +184/-1 |
| 3   | `packages/desktop/src-tauri/src/lib.rs`            | modified | +31/-1  |
| 4   | `packages/desktop/src-tauri/src/os/windows.rs`     | modified | +28/-4  |
| 5   | `packages/desktop/src/bindings.ts`                 | modified | +1/-0   |
| 6   | `packages/desktop/src/cli.ts`                      | modified | +29/-1  |
| 7   | `packages/desktop/src/i18n/en.ts`                  | modified | +34/-0  |
| 8   | `packages/desktop/src/i18n/ar.ts`                  | modified | +33/-0  |
| 9   | `packages/desktop/src/i18n/br.ts`                  | modified | +34/-0  |
| 10  | `packages/desktop/src/i18n/bs.ts`                  | modified | +34/-0  |
| 11  | `packages/desktop/src/i18n/da.ts`                  | modified | +33/-0  |
| 12  | `packages/desktop/src/i18n/de.ts`                  | modified | +34/-0  |
| 13  | `packages/desktop/src/i18n/es.ts`                  | modified | +34/-0  |
| 14  | `packages/desktop/src/i18n/fr.ts`                  | modified | +34/-0  |
| 15  | `packages/desktop/src/i18n/ja.ts`                  | modified | +34/-0  |
| 16  | `packages/desktop/src/i18n/ko.ts`                  | modified | +33/-0  |
| 17  | `packages/desktop/src/i18n/no.ts`                  | modified | +33/-0  |
| 18  | `packages/desktop/src/i18n/pl.ts`                  | modified | +34/-0  |
| 19  | `packages/desktop/src/i18n/ru.ts`                  | modified | +34/-0  |
| 20  | `packages/desktop/src/i18n/zh.ts`                  | modified | +33/-0  |
| 21  | `packages/desktop/src/i18n/zht.ts`                 | modified | +33/-0  |
| 22  | `packages/desktop/src/index.tsx`                   | modified | +2/-16  |
| 23  | `packages/desktop/src/loading.tsx`                 | modified | +11/-4  |
| 24  | `packages/desktop/src/menu.ts`                     | modified | +19/-19 |

**Total: 24 files, +973 additions / -47 deletions**

---

## Summary

This file group contains four distinct changes to the Tauri desktop app (`packages/desktop/`):

1. **Shell environment probing for sidecar CLI** (`cli.rs`) — The desktop app now loads the user's interactive shell environment before spawning the CLI sidecar process, ensuring tools like `nvm`/`pyenv`/`rbenv` that modify `PATH` in shell profiles are available to the CLI. Includes nushell detection and timeout protection.

2. **`open_path` Tauri command with PowerShell special-casing** (`lib.rs`, `windows.rs`, `index.tsx`, `bindings.ts`) — Moves path-opening logic from the JS frontend into a Rust Tauri command, with Windows-specific handling for PowerShell (spawns a new console with `-NoExit`). Replaces the `@tauri-apps/plugin-opener` JS import with a native command.

3. **Full i18n for menus, loading screen, and CLI error messages** (`menu.ts`, `loading.tsx`, `cli.ts`, `en.ts`, + 13 locale files) — All hardcoded English strings in the desktop shell (native menus, loading/migration screen, CLI install error messages, server display name) are replaced with `t()` calls backed by new i18n keys across 14 locales.

4. **Release script: `finalize-latest-json.ts`** — New CI script that post-processes Tauri's auto-generated `latest.json` updater manifest, adding platform-specific entries with download URLs and signatures for all target architectures.

---

## Detailed Findings

### 1. `packages/desktop/scripts/finalize-latest-json.ts` (new file, +159)

**Purpose:** CI release script that fetches the Tauri-generated `latest.json` from a GitHub release, enriches it with per-platform download URLs and signature files, and re-uploads it.

**Findings:**

- **BUG — Wrong variable checked on line 23:** The version validation checks `releaseId` instead of `version`:

  ```ts
  const version = process.env.OPENCODE_VERSION
  if (!releaseId) throw new Error("OPENCODE_VERSION is required")
  //    ^^^^^^^^^ should be `!version`
  ```

  This means `OPENCODE_VERSION` can be `undefined` and the script will proceed, producing malformed download URLs (`https://...download/vundefined/...`). **Severity: High** — silent corruption of the updater manifest in CI.

- **Import ordering:** `parseArgs` is imported on line 15 but used on line 6 (hoisted via `import` semantics, so this works). However, the split placement is confusing and non-idiomatic.

- **No error handling for `fetchSignature`:** If a `.sig` asset exists but the fetch returns garbage, the signature is silently accepted. The `Buffer.from(...)` call won't throw on invalid content.

- **`gh release upload` uses shell interpolation via `$`:** The `tag` and `file` variables are injected into the Bun shell template. If `tag` contains special characters this could be problematic, though in practice GitHub tags are safe.

- **No Content-Type on re-upload:** The script uses `gh release upload --clobber` which should handle this, but there's no explicit verification that the uploaded JSON is valid before replacing the existing asset.

### 2. `packages/desktop/src-tauri/src/cli.rs` (+184/-1)

**Purpose:** Adds shell environment probing so the sidecar CLI process inherits the user's login shell environment (PATH modifications from `.bashrc`, `.zshrc`, etc.).

**Findings:**

- **Blocking synchronous I/O on spawn path:** `load_shell_env` uses `std::process::Command` (synchronous) with a busy-wait polling loop (`std::thread::sleep(25ms)`). This runs during `spawn_command`, which is called from an async Tauri command context. The 5-second timeout with 25ms polling is acceptable for a one-shot startup operation, but could block the Tokio runtime thread if not called from a blocking context. Verify that `spawn_command` is invoked via `tokio::task::spawn_blocking` or similar.

- **Good: Nushell detection and skip.** `is_nushell` correctly handles various path forms (`nu`, `/opt/homebrew/bin/nu`, `C:\...\nu.exe`). Nushell doesn't support POSIX `-il`/`-l` flags, so skipping it is correct.

- **Good: Fallback strategy.** Tries `-il` (interactive login) first, falls back to `-l` (login-only) if interactive mode is unavailable, then falls back to app environment. This handles shells that block on interactive mode (e.g., fish with slow plugins).

- **`parse_shell_env` handles multiline values correctly** since it uses NUL-delimited output (`env -0`). Values containing `=` are also handled correctly via `split_once('=')`.

- **Good: Tests included.** Four unit tests covering `parse_shell_env`, `merge_shell_env`, and `is_nushell` — testing actual implementation without mocks.

- **Potential concern:** The shell env is loaded on every `spawn_command` call. If the desktop app spawns the CLI multiple times (reconnection, restart), this adds 5s worst-case latency each time. Consider caching the result. This is a performance concern, not a correctness bug.

- **`merge_shell_env` override order is correct:** Explicit `envs` (e.g., `KILO_CLIENT=desktop`) override shell env values, which is the right priority.

### 3. `packages/desktop/src-tauri/src/lib.rs` (+31/-1)

**Purpose:** New `open_path` Tauri command that handles cross-platform path opening, with Windows-specific PowerShell detection.

**Findings:**

- **Clean implementation.** The `#[cfg(target_os = "windows")]` / `#[cfg(not(target_os = "windows"))]` split is correct and idiomatic Rust.

- **PowerShell detection is thorough** — checks the file name component case-insensitively for both `powershell` and `powershell.exe`.

- **Missing `pwsh` detection:** The code only checks for `powershell`/`powershell.exe` but not `pwsh`/`pwsh.exe` (PowerShell Core / PowerShell 7+). Users running `pwsh` would fall through to the generic `open_path` behavior instead of getting a new console. **Severity: Low** — degraded UX for PowerShell 7 users but not a crash.

- **`_app` parameter is unused** — the `AppHandle` is required by Tauri command signature but prefixed with `_` correctly.

- **Registered in specta builder** at the end of the file — correct.

### 4. `packages/desktop/src-tauri/src/os/windows.rs` (+28/-4)

**Purpose:** Adds `open_in_powershell` function and replaces magic constant `0x08000000` with named `CREATE_NO_WINDOW`.

**Findings:**

- **Good: Named constants.** Replacing `0x08000000` with `CREATE_NO_WINDOW` improves readability. Adding `CREATE_NEW_CONSOLE` for the PowerShell spawn is correct.

- **`open_in_powershell` spawns but doesn't track the child process.** The `spawn()` result is consumed and the `Child` handle is dropped. On Windows, dropping a `Child` handle does not kill the process (unlike some Unix behaviors), so this is fine — the PowerShell window will persist independently.

- **Path resolution fallback:** If the path is not a directory and has no parent, it falls back to `current_dir()`. This is a reasonable fallback. The `is_dir()` check is synchronous, which is fine for a Tauri command.

- **Only `powershell.exe` is spawned**, not `pwsh.exe`. Consistent with the detection gap in `lib.rs`.

### 5. `packages/desktop/src/bindings.ts` (+1)

**Purpose:** Auto-generated Tauri bindings — adds the `openPath` command binding.

**Findings:**

- **Straightforward addition.** The type signature `(path: string, appName: string | null) => __TAURI_INVOKE<null>` matches the Rust command signature correctly. Return type `null` (unit in Rust) is correct.

- No concerns.

### 6. `packages/desktop/src/cli.ts` (+29/-1)

**Purpose:** Adds `installError` function that maps Rust error strings to localized user-facing messages.

**Findings:**

- **String-matching on error messages is fragile.** The function matches English substrings like `"CLI installation is only supported on macOS & Linux"` from the Rust backend. If the Rust error messages change, the mapping breaks silently and falls through to showing the raw error string. **Severity: Low** — graceful degradation (raw English error shown), but a structured error code system would be more robust.

- **Good fallback:** `return text || t("desktop.cli.error.unknown")` ensures something is always shown.

- **The function handles `unknown` type correctly** via `String(error)`.

### 7. `packages/desktop/src/index.tsx` (+2/-16)

**Purpose:** Replaces the JS-side `openPath` implementation (which had WSL path conversion, Windows app resolution) with a single call to the new Rust `commands.openPath()`. Also localizes the "Local Server" display name.

**Findings:**

- **Significant simplification.** 16 lines of complex platform-specific JS removed and replaced with 1 line calling the Rust command. The WSL path conversion and Windows app resolution are now handled in Rust.

- **`@tauri-apps/plugin-opener` import removed.** The `openerOpenPath` import is no longer needed since path opening is handled by the custom Tauri command. This reduces a JS dependency usage.

- **Server display name localized:** `"Local Server"` → `t("desktop.server.local")` — correct.

- **Note:** The removed code included WSL path conversion (`commands.wslPath(path, "windows")`). The new Rust `open_path` command in `lib.rs` does NOT appear to include WSL path conversion. This could be a **regression for WSL users** who had path conversion before. **Severity: Medium** — needs verification that WSL path handling is either no longer needed or handled elsewhere.

### 8. `packages/desktop/src/loading.tsx` (+11/-4)

**Purpose:** Localizes the loading/migration screen strings.

**Findings:**

- **Potential timing issue with `initI18n()`.** The `lines` array is declared at module scope (top level) and calls `t()` immediately. `initI18n()` is called as `void initI18n()` also at module scope, but since `initI18n` is async, the `t()` calls in the `lines` array will execute before i18n is initialized. The `t()` function likely returns the key itself or a fallback when not initialized, and then the `lines` array is never re-evaluated.

  Inside the `render()` function, `t()` calls in `status` (createMemo) and the `aria-label` are reactive and will use the initialized i18n. But the `lines` array used for `lines[line()]` in the `sqlite_waiting` phase is a static array — it won't update after i18n initializes. **Severity: Medium** — The migration status messages ("Migrating your database", "This may take a couple of minutes") may display as raw i18n keys instead of translated text if the i18n module hasn't finished loading by the time they're needed. The "Just a moment..." message used in the initial phase is also in the `lines` array but is also used via a direct `t()` call in the `status` memo, so the initial display is covered.

### 9. `packages/desktop/src/menu.ts` (+19/-19)

**Purpose:** Replaces all hardcoded English menu strings with `t()` i18n calls.

**Findings:**

- **Clean 1:1 replacement.** Every hardcoded string is replaced with the corresponding `t()` call. Key names follow a consistent `desktop.menu.*` naming convention.

- **Menu is created once at app startup.** The `createMenu` function is async and called during initialization. Since it's called after `initI18n()`, the translations should be available. However, if the user changes locale at runtime, the menu text won't update without recreating the menu. This is standard behavior for native menus.

- No concerns.

### 10–21. `packages/desktop/src/i18n/{ar,br,bs,da,de,es,fr,ja,ko,no,pl,ru,zh,zht}.ts` (14 locale files)

**Purpose:** Add ~33 new i18n keys to each locale for menu strings, CLI error messages, loading screen strings, and server display name.

**Findings:**

- **All 14 locale files add the same set of keys.** Key consistency is maintained across all locales.

- **New key categories added:**
  - `desktop.menu.*` — 16 keys for native menu items (app, file, edit, view, help submenus)
  - `desktop.cli.error.*` — 8 keys for CLI installation error messages
  - `desktop.loading.*` — 4 keys for loading/migration screen
  - `desktop.server.local` — 1 key for server display name

- **`desktop.menu.app` is "Kilo" in all locales** — correct, brand names should not be translated.

- **French `fr.ts` has a grammatical issue:** `"Documentation d'Kilo"` should be `"Documentation de Kilo"` — the elision `d'` is used before vowels, but "Kilo" starts with a consonant. **Severity: Cosmetic.**

- **Norwegian `no.ts` has a mistranslation:** `"desktop.menu.view.toggleFileTree": "Vis/skjul filtre"` — "filtre" means "filters" in Norwegian, not "file tree". Should be "Vis/skjul filtreet" or "Vis/skjul filtre" (filer tree). **Severity: Cosmetic.**

- **No missing keys detected** across locales.

### 22. (Covered in #7 above — `packages/desktop/src/index.tsx`)

### 23. (Covered in #8 above — `packages/desktop/src/loading.tsx`)

### 24. (Covered in #9 above — `packages/desktop/src/menu.ts`)

---

## Risk to VS Code Extension

**Risk: Low**

All changes in this group are strictly within `packages/desktop/` (Tauri desktop app). The VS Code extension lives in `packages/kilo-vscode/` and is a completely separate product with its own build pipeline.

**Shared dependency analysis:**

| Concern                               | Assessment                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared i18n**                       | The desktop app uses its own i18n system (`packages/desktop/src/i18n/`). The VS Code extension uses `packages/kilo-i18n/`. These are completely separate — no shared keys or runtime. **No risk.**                            |
| **Shared UI components**              | Both products consume `packages/kilo-ui/` (SolidJS component library) and `packages/app/` (shared web UI). None of those packages are modified in this PR group. **No risk.**                                                 |
| **`@kilocode/sdk`**                   | Both products depend on the SDK to talk to the CLI server. No SDK changes in this group. **No risk.**                                                                                                                         |
| **CLI binary (`packages/opencode/`)** | The shell env probing in `cli.rs` affects how the desktop app spawns the CLI, but the CLI binary itself is unchanged. The VS Code extension spawns `kilo serve` directly, not through Tauri's sidecar mechanism. **No risk.** |
| **Tauri plugins**                     | The removal of `@tauri-apps/plugin-opener` JS import and addition of the Rust `open_path` command is entirely within the Tauri app boundary. **No risk.**                                                                     |
| **`finalize-latest-json.ts`**         | CI script for Tauri updater manifest. Affects only desktop app auto-update. **No risk.**                                                                                                                                      |

The only conceivable indirect risk would be if the monorepo build pipeline (`bun turbo`) has an ordering issue where desktop build failures block extension builds, but this is a CI configuration concern, not a code concern.

---

## Overall Risk

**Medium-Low**

| Finding                                                                     | Severity     | Impact                                                                   |
| --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `finalize-latest-json.ts` checks `releaseId` instead of `version` (line 23) | **High**     | Corrupt updater manifest URLs in CI — desktop auto-update broken         |
| `loading.tsx` — `lines` array evaluates `t()` before `initI18n()` resolves  | **Medium**   | Migration status strings may display as raw keys instead of translations |
| `index.tsx` — WSL path conversion removed, not replicated in Rust           | **Medium**   | Possible regression for WSL users opening paths from the desktop app     |
| `lib.rs`/`windows.rs` — `pwsh`/`pwsh.exe` not detected as PowerShell        | **Low**      | PowerShell 7 users get degraded open-in-terminal experience              |
| `cli.ts` — Error matching via English string substrings                     | **Low**      | Fragile; changes to Rust error messages break localization silently      |
| `fr.ts` — `"Documentation d'Kilo"` grammatically incorrect                  | **Cosmetic** | Should be `"Documentation de Kilo"`                                      |
| `no.ts` — `"Vis/skjul filtre"` means "filters" not "file tree"              | **Cosmetic** | Mistranslation in Norwegian locale                                       |

The **version check bug in `finalize-latest-json.ts`** is the most critical finding and should be fixed before merge. The loading screen timing issue and WSL regression should be investigated. All other findings are low-severity or cosmetic.
