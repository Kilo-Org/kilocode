// kilocode — shared by the CLI permission defaults and the VS Code work-style presets.
export type ShellPermission = "allow" | "ask" | "deny"

// The allowlisted commands whose first argument is the file whose lines they
// print. `ls`, `tree`, `wc`, `which`, `type`, `file`, `du`, `df`, `date`,
// `uname` and `whoami` report metadata, so they keep their current level; `tr`
// takes character sets, so `STREAMS` covers its input redirect instead.
const READERS = ["cat", "head", "tail", "less", "diff", "sort", "uniq", "cut", "jq"] as const

// The grep-family commands whose first argument is a pattern, so a trailing name
// can be the search term rather than a file.
const SEARCHERS = ["grep", "rg", "ag"] as const

// The stream filters take character sets, not paths, so their rules cover an input
// redirect.
const STREAMS = ["tr"] as const

// Git commands that print a file's lines from a revision or a worktree path: the
// object readers, and the two that print a path's content or history.
const GIT = ["git show", "git cat-file", "git diff", "git log", "git blame"] as const

/**
 * Environment files are sensitive, so both surfaces that can open one apply the
 * same level: the `read` tool asks before it opens such a file, and these rules
 * apply that level to the shell commands that print a file's lines. A process
 * environment dump applies it as well. `level` is `ask` for an agent that can
 * prompt and `deny` for a delegated one that cannot answer.
 *
 * The shapes covered are: a file reader's environment file at any operand position,
 * including a wildcard, a quoted operand and a nested path; a searcher's
 * environment file, once it follows the search term, in any position when it is
 * `.env`, `.env.*` or matches `*.env.*`, and as the last operand when it matches
 * `*.env`; a stream filter's environment file behind an input redirect, so
 * `tr -d ',' < .env` asks; and, for the git commands that print a file, the file
 * named as a path anywhere in the command. A searcher's first operand is its
 * search pattern, so a bare pattern that reads like a file name is not gated.
 *
 * A last argument that merely ends in `.env` counts as a file name, so a search
 * term such as `process.env` in that position gets the same level. A pattern
 * cannot tell a search term from a relative path, and the coverage is worth the
 * extra prompt.
 *
 * `.env.example` documents the format and is allowed only as the exact lone
 * operand of a reader or a searcher: one literal path. A nested sample path and
 * a git revision spec naming the sample ask instead, because a pattern cannot
 * name those shapes without a wildcard before the path.
 *
 * A rule is one literal command prefix followed by an operand pattern, so a
 * generated key never carries a wildcard ahead of the sample path. That keeps
 * every rule a plain statement of the level for the operand it names.
 *
 * The last matching rule wins, so the sample allows are emitted last, and the
 * gated rules themselves must follow the plain allows they override.
 *
 * Rules are derived from `allow`, so a map gains them only for commands it
 * already allows and never carries one that cannot match.
 */
export function envGuards(
  allow: Readonly<Record<string, unknown>>,
  level: "ask" | "deny" = "ask",
): Record<string, ShellPermission> {
  const gated: Record<string, ShellPermission> = {}
  const samples: Record<string, ShellPermission> = {}
  const has = (command: string) => Object.hasOwn(allow, `${command} *`)

  for (const command of READERS) {
    if (!has(command)) continue
    // One form covers the bare name, a glob, a quoted operand, a nested path, and
    // every operand position, because `*` spans spaces and operands alike.
    gated[`${command} *.env*`] = level
    samples[`${command} .env.example`] = "allow"
  }

  for (const command of SEARCHERS) {
    if (!has(command)) continue
    // A searcher takes its pattern as the first operand, so the name must follow
    // an argument: a bare pattern that reads like a file name (`grep .env`) is a
    // search, not a read of that file.
    for (const file of [".env", ".env.*"]) {
      gated[`${command} * ${file}`] = level
      gated[`${command} * ${file} *`] = level
    }
    gated[`${command} * *.env`] = level
    gated[`${command} * *.env.*`] = level
    // A name behind a directory in a middle position: the `.env` shapes above
    // need the name to follow a space, and the two suffix shapes above need it to
    // be the last operand. A `*` before the slash keeps an ordinary search term
    // (`rg -n process.env src/`) out of these rules.
    gated[`${command} * */.env *`] = level
    gated[`${command} * */.env.* *`] = level
    // A middle-position name with no directory before it would need a trailing
    // wildcard, and `*` spans spaces, so `cmd * *.env *` also matches an ordinary
    // search term (`rg -n process.env src/`). Only the directory-prefixed forms
    // above separate the two.
    samples[`${command} .env.example`] = "allow"
  }

  for (const command of STREAMS) {
    if (!has(command)) continue
    // The operands of `tr` are character sets, so one form covers `tr …<.env`,
    // `tr … < .env` and a trailing argument after the file.
    gated[`${command} *<*.env*`] = level
  }

  for (const prefix of GIT) {
    if (!has(prefix)) continue
    // A git command takes a revision spec first and a path after it, so one
    // operand form covers the spec, a later path, and a path set off by `--`.
    gated[`${prefix} *.env*`] = level
  }

  // `Wildcard.match` treats a trailing ` .*` as optional, so this covers the bare
  // dump and the argument form with one rule.
  if (has("printenv")) gated["printenv *"] = level

  return { ...gated, ...samples }
}
