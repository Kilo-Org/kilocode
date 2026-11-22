// kilocode — shared by the CLI permission defaults and the VS Code work-style presets.
export type ShellPermission = "allow" | "ask" | "deny"

// The allowlisted commands whose arguments name a file whose lines they print:
// the readers, the three grep-family searchers, and the line filters that print
// the file they are handed. `ls`, `tree`, `wc`, `which`, `type`, `file`, `du`,
// `df`, `date`, `uname`, `whoami` and `tr` report metadata or transform a
// stream, so they keep their current level.
const PRINTERS: Record<string, true> = {
  cat: true,
  head: true,
  tail: true,
  less: true,
  diff: true,
  grep: true,
  rg: true,
  ag: true,
  sort: true,
  uniq: true,
  cut: true,
  jq: true,
}

// The readers whose first argument is already a path, so a trailing name is
// unambiguously a file. The grep family takes a pattern first, where a trailing
// name can be the search term, so it stays anchored below.
const PATHS: Record<string, true> = {
  cat: true,
  head: true,
  tail: true,
  less: true,
  diff: true,
  sort: true,
  uniq: true,
  cut: true,
  jq: true,
}

// A dotfile at the start of the arguments or after another one. Each form anchors
// the operand against the character before it, so a longer word that merely ends
// the same way does not match.
function dotfiles(command: string, file: string) {
  return [`${command} ${file}`, `${command} ${file} *`, `${command} * ${file}`, `${command} * ${file} *`]
}

// A file inside a directory, matched by its trailing name. The `/` is required, so
// this covers `config/prod.env` while leaving a word such as `process.env` alone:
// without the separator the two are the same string, and guessing would gate an
// ordinary code search.
function nested(command: string, file: string) {
  return [`${command} */${file}`, `${command} */${file} *`]
}

/**
 * Environment files are sensitive, so both surfaces that can open one apply the
 * same level: the `read` tool asks before reading any `*.env` or `*.env.*` path,
 * and these rules apply that level to the shell commands that print a file's
 * lines. A process environment dump applies it as well. `level` is `ask` for an
 * agent that can prompt and `deny` for a delegated one that cannot answer.
 *
 * `.env.example` documents the format and stays allowed when it is the only
 * operand. The last matching rule wins, so it is emitted last: a command that
 * names a gated file anywhere among its operands asks, even when another operand
 * is a sample file.
 *
 * Rules are derived from `allow`, so a map gains them only for commands it
 * already allows and never carries one that cannot match.
 */
export function envGuards(
  allow: Readonly<Record<string, unknown>>,
  level: "ask" | "deny" = "ask",
): Record<string, ShellPermission> {
  const general: Record<string, ShellPermission> = {}
  const exact: Record<string, ShellPermission> = {}
  for (const key of Object.keys(allow)) {
    if (!key.endsWith(" *")) continue
    const command = key.slice(0, -2)
    if (!Object.hasOwn(PRINTERS, command)) continue
    for (const rule of [
      ...dotfiles(command, ".env"),
      ...dotfiles(command, ".env.*"),
      ...nested(command, ".env"),
      ...nested(command, ".env.*"),
      ...nested(command, "*.env"),
      ...nested(command, "*.env.*"),
    ]) {
      general[rule] = level
    }
    // A reader takes a path first, so a bare trailing name is a file even with no
    // separator. A searcher takes a pattern first, so it keeps the anchored forms.
    if (Object.hasOwn(PATHS, command)) {
      for (const rule of [
        `${command} *.env`,
        `${command} *.env *`,
        `${command} *.env.*`,
        `${command} *.env.* *`,
      ]) {
        general[rule] = level
      }
    }
    exact[`${command} .env.example`] = "allow"
  }
  // `Wildcard.match` treats a trailing ` .*` as optional, so this covers the bare
  // dump and the argument form with one rule.
  if (Object.hasOwn(allow, "printenv *")) general["printenv *"] = level
  return { ...general, ...exact }
}
