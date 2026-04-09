/**
 * Project directory resolution for standalone panels (Settings, Profile, Marketplace).
 *
 * ## Why this exists
 *
 * The sidebar KiloProvider always uses `getWorkspaceDirectory()`, which returns
 * `workspaceFolders[0]`. That works because the sidebar is tied to the window
 * and there's an implicit "current workspace" context.
 *
 * Standalone editor panels (opened via SettingsEditorProvider) don't have that
 * implicit context. In a **multi-root workspace** — where VS Code has multiple
 * folders open (e.g. `/repo-a` and `/repo-b`) — we can't just pick
 * `workspaceFolders[0]` because the user may intend to install a marketplace
 * item into `/repo-b`, not `/repo-a`.
 *
 * The resolution strategy is:
 *
 * 1. If the user has a file open in an editor, use that file's workspace folder.
 *    This is the strongest signal of which project they're working in.
 *
 * 2. If there's exactly one workspace folder, use it. There's no ambiguity.
 *
 * 3. If there are multiple folders and no active editor, return `null` to
 *    **disable project-scope operations** (e.g. marketplace installs default
 *    to global scope). This prevents silently writing config into the wrong project.
 *
 * ## How KiloProvider uses this
 *
 * Each KiloProvider instance can receive an explicit `projectDirectory` via
 * `KiloProviderOptions`. When set:
 *
 * - A string value overrides the workspace directory for project-scoped operations
 * - `null` explicitly disables project scope (forces global-only)
 * - `undefined` (default, used by the sidebar) falls through to `getWorkspaceDirectory()`
 */

export interface WorkspaceFolderLike {
  uri: { fsPath: string }
}

/**
 * Resolve the project directory for a standalone panel based on the active
 * editor and available workspace folders. See module docs for the strategy.
 */
export function resolvePanelProjectDirectory(
  active: string | undefined,
  folders: readonly WorkspaceFolderLike[] | undefined,
): string | null {
  if (active) return active
  if (folders?.length === 1) return folders[0].uri.fsPath
  return null
}

/**
 * Resolve the effective project directory for a KiloProvider instance.
 *
 * @param override - Explicit directory from KiloProviderOptions. `undefined`
 *   means "not set" (fall through), `null` means "disable project scope",
 *   and a string is a direct override.
 * @param fallback - Callback to get the default workspace directory (typically
 *   `getWorkspaceDirectory(sessionId)` from KiloProvider).
 */
export function resolveProjectDirectory(
  override: string | null | undefined,
  fallback: () => string,
): string | undefined {
  if (override !== undefined) return override ?? undefined
  return fallback()
}
