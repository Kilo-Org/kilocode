import { prefix as base } from "@/permission/arity"

/**
 * Flag-aware variant of the upstream arity prefix.
 *
 * The upstream arity table treats every token positionally, so a command like
 * `pnpm --filter web typecheck` collapses to the chip `pnpm --filter *` —
 * `--filter` accidentally counts as the second positional token for `pnpm`.
 *
 * This helper recognizes a small set of well-known `<command> <flag> <arg>`
 * combinations (see {@link FLAG_ARG}). When the leading flag+arg of the input
 * matches one of those entries, the flag pair is set aside, the upstream
 * arity prefix is computed against the remaining positional tokens, and the
 * flag pair is re-injected after the command name.
 *
 *   pnpm --filter web typecheck
 *     flags     = ["--filter", "web"]
 *     positional = ["pnpm", "typecheck"]
 *     arity      = ["pnpm", "typecheck"]   (pnpm has arity 2)
 *     result     = ["pnpm", "--filter", "web", "typecheck"]
 *
 *   pnpm --filter web run build
 *     flags     = ["--filter", "web"]
 *     positional = ["pnpm", "run", "build"]
 *     arity      = ["pnpm", "run", "build"] (pnpm run has arity 3)
 *     result     = ["pnpm", "--filter", "web", "run", "build"]
 *
 * Multiple consecutive flag+arg pairs are supported (e.g. repeated
 * `--workspace` flags). Inputs that do not start with a known flag pair fall
 * through to upstream arity unchanged.
 */
export namespace KiloFlagArity {
  // <command> <flag>  →  flag takes one positional argument.
  // Keep this list small and conservative; only add entries where the chip
  // produced by upstream arity is actively misleading.
  const FLAG_ARG: Record<string, true> = {
    "pnpm --filter": true,
    "pnpm -F": true,
    "npm --workspace": true,
    "npm -w": true,
    "yarn --cwd": true,
    "git -C": true,
    "cargo --package": true,
    "cargo -p": true,
    "cargo --manifest-path": true,
  }

  export function prefix(tokens: string[]): string[] {
    if (tokens.length === 0) return []
    const cmd = tokens[0]
    const flags: string[] = []
    for (let i = 1; i + 1 < tokens.length; i += 2) {
      if (!FLAG_ARG[cmd + " " + tokens[i]]) break
      flags.push(tokens[i], tokens[i + 1])
    }
    if (flags.length === 0) return base(tokens)
    const positional = [cmd, ...tokens.slice(1 + flags.length)]
    const prefix = base(positional)
    return [cmd, ...flags, ...prefix.slice(1)]
  }
}
