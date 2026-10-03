/**
 * Project directory resolution for KiloProvider instances.
 *
 * ## Why this exists
 *
 * The sidebar KiloProvider uses `getWorkspaceDirectory()`, which follows the
 * open session's folder or the root picked in the chat input (see
 * `workspace-root.ts`).
 *
 * Standalone editor panels (Settings, Profile, Marketplace) start from that
 * same picked root, so a **multi-root workspace** never silently writes config
 * into a folder the user did not choose. The Settings panel can then switch to
 * another workspace folder with its own folder dropdown.
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
