import type { ExecFileOptionsWithStringEncoding } from "child_process"
import { execWithShellEnv } from "./shell-env"

function env(options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">): NodeJS.ProcessEnv {
  const result = options?.env ? { ...options.env } : { ...process.env }
  const tz = Object.keys(result).find((key) => key.toLowerCase() === "tz")
  if (!tz) result.TZ = "UTC"
  return result
}

/**
 * Name of the GitHub CLI, owned here so no other module needs the literal.
 *
 * The architecture test forbids the bare binary name elsewhere, which is what keeps every gh
 * invocation on the Windows-safe path in {@link execGhRead}.
 */
export const GH = "gh"

/** Run read-only gh queries without tzutil console windows flashing on Windows. */
export function execGhRead(
  args: string[],
  options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform !== "win32") return execWithShellEnv("gh", args, options)
  return execWithShellEnv("gh", args, { ...options, env: env(options) })
}
