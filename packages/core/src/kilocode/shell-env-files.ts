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

// An environment file as a whole path operand. A bare `*` before `.env` would also
// match a longer word that merely ends that way, so `rg process.env` — an ordinary
// code search — would ask, or fail outright in a delegated agent. Each form
// therefore anchors the operand: at the start, after a space, or after a directory
// slash.
function operands(command: string) {
  return [
    `${command} .env`,
    `${command} .env *`,
    `${command} * .env`,
    `${command} * .env *`,
    `${command} */.env`,
    `${command} */.env *`,
  ]
}

// The `.env.*` forms, plain and in a subdirectory, alone or followed by operands.
function samples(command: string) {
  return [".env.*", "*/.env.*"].flatMap((file) => [`${command} ${file}`, `${command} ${file} *`])
}

/**
 * Environment files are sensitive, so both surfaces that can open one apply the
 * same level: the `read` tool asks before reading a `*.env` or `*.env.*` file,
 * and these rules apply that level to the shell commands that print a file's
 * lines. A process environment dump applies it as well. `level` is `ask` for an
 * agent that can prompt and `deny` for a delegated one that cannot answer.
 *
 * `.env.example` documents the format and stays allowed as the sole operand. The
 * last matching rule wins, so the sample rules are emitted first and the operand
 * rules last: a command that names a gated file anywhere among its operands asks,
 * even when another operand is a sample file.
 *
 * Rules are derived from `allow`, so a map gains them only for commands it
 * already allows and never carries one that cannot match.
 */
export function envGuards(
  allow: Readonly<Record<string, unknown>>,
  level: "ask" | "deny" = "ask",
): Record<string, ShellPermission> {
  const sample: Record<string, ShellPermission> = {}
  const exact: Record<string, ShellPermission> = {}
  const operand: Record<string, ShellPermission> = {}
  for (const key of Object.keys(allow)) {
    if (!key.endsWith(" *")) continue
    const command = key.slice(0, -2)
    if (!Object.hasOwn(PRINTERS, command)) continue
    for (const rule of samples(command)) sample[rule] = level
    // One operand, named exactly, with no second operand or operator behind it.
    exact[`${command} .env.example`] = "allow"
    for (const rule of operands(command)) operand[rule] = level
  }
  // A bare `printenv` already reaches the catch-all; only the argument form is allowed.
  if (Object.hasOwn(allow, "printenv *")) operand["printenv *"] = level
  return { ...sample, ...exact, ...operand }
}
