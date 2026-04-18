import * as vscode from "vscode"
import { HERMES_ENV_FALLBACKS, HERMES_SECRET_KEY } from "./types"

/**
 * Resolve the Hermes API key.
 *
 * Precedence (D2 decision — "SecretStorage with env-var fallback"):
 *   1. VS Code SecretStorage under `kilo-code.new.hermes.apiKey`
 *   2. process.env: HERMES_API_KEY, KILOCODE_API_KEY, MINIMAX_API_KEY, ANTHROPIC_API_KEY
 *   3. undefined (no key found)
 *
 * Never returns the empty string — treats blank as "not set".
 */
export async function resolveKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await ctx.secrets.get(HERMES_SECRET_KEY)
  if (stored && stored.trim().length > 0) return stored.trim()

  for (const name of HERMES_ENV_FALLBACKS) {
    const val = process.env[name]
    if (val && val.trim().length > 0) return val.trim()
  }
  return undefined
}

/**
 * Where did the resolved key come from? Useful for status UI — users should
 * be able to see "Key from SecretStorage" vs "Key from HERMES_API_KEY env".
 */
export async function keySource(
  ctx: vscode.ExtensionContext,
): Promise<"secret" | "env" | "none"> {
  const stored = await ctx.secrets.get(HERMES_SECRET_KEY)
  if (stored && stored.trim().length > 0) return "secret"
  for (const name of HERMES_ENV_FALLBACKS) {
    const val = process.env[name]
    if (val && val.trim().length > 0) return "env"
  }
  return "none"
}

/** Store an API key in SecretStorage. Empty string clears. */
export async function saveKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    await ctx.secrets.delete(HERMES_SECRET_KEY)
    return
  }
  await ctx.secrets.store(HERMES_SECRET_KEY, trimmed)
}

/** Remove the SecretStorage entry (env fallbacks are not touched). */
export async function clearKey(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.secrets.delete(HERMES_SECRET_KEY)
}
