export * as ShellLiteral from "./literal.js"

// Shell permission rules are wildcard patterns, and rules such as `*>*`, `*|*` or `*$(*` match an operator
// character anywhere in a command's resource. A scanner that reports source text exposes characters that the shell
// reads as literal text: a `>` in a quoted grep pattern or in a heredoc body then denies the command.
//
// The bash scanner records each position it proves literal: single-quoted and ANSI-C quoted text, escaped
// characters, the plain text of double-quoted words and unquoted heredoc bodies, and quoted heredoc bodies with
// their line breaks. `render` replaces the operator characters at those positions with `_`. Every other character
// stays as written, so real operators, redirects, pipes, `$` expansions, `$(...)`, backticks and `<(...)` still
// reach the rules. The result keeps the source length, so offsets into the resource stay valid.
//
// Text that another shell runs instead is not literal even when it is quoted: `eval`, `sh -c`, and a heredoc or
// here-string attached to a shell interpreter. `runsProgram` names those commands so the scanner leaves them as
// written. A program the scanner cannot attribute to a shell command stays masked: a wrapper such as `env sh -c` or
// `sudo sh -c`, a shell that reads the output of an earlier pipeline element (`echo 'x > y' | sh`), and a group
// redirect (`{ sh; } <<EOF`).
//
// Only words of a command list are recorded. Quoted text inside parameter words (`${x:-"a>b"}`), arrays, `[[ ]]`,
// process substitutions and backtick substitutions stays as written in the enclosing resource, which can only make
// a rule match more often.
//
// The Kilo host enables masking for its process at startup (`packages/kilo-cli/src/env.ts`). Core and upstream tests
// keep the scanner's default, which reports source text.

const OPERATORS = /[<>|&;$`\n]/g
const MASK = "_"

const SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "mksh", "pdksh", "sh", "zsh"])

let masking = false

/** Enables masked resources for scans that do not ask for a mode. */
export function enable() {
  masking = true
}

/** Disables masked resources, restoring the source text that upstream reports. */
export function disable() {
  masking = false
}

/** Whether scans that do not ask for a mode render masked resources. */
export function enabled() {
  return masking
}

/** Records the positions from `start` up to `end` as literal. */
export function mark(inert: Set<number> | undefined, start: number, end: number) {
  if (!inert) return
  for (let at = start; at < end; at++) inert.add(at)
}

/**
 * Records a heredoc body as literal. `newline` is the line break before the body, which belongs to the heredoc. A
 * quoted body is literal throughout; an unquoted body is literal where its own scan, relative to the body, recorded
 * it, and its expansions stay visible.
 */
export function heredoc(inert: Set<number>, newline: number, length: number, body?: ReadonlySet<number>) {
  inert.add(newline)
  if (!body) return mark(inert, newline + 1, newline + 1 + length)
  for (const at of body) inert.add(newline + 1 + at)
}

/**
 * Whether the command's own text is a program for another shell: `eval`, a shell interpreter with a `-c` program, or
 * a shell interpreter that reads its program from standard input (`readsStdin`). `words` starts at the command word,
 * with precommands such as `command -p` already resolved and quotes decoded.
 */
export function runsProgram(words: readonly string[], readsStdin: boolean) {
  const at = execHead(words)
  const name = words[at]?.split("/").pop()
  if (!name) return false
  if (name === "eval") return true
  if (!SHELLS.has(name)) return false
  return readsStdin || words.slice(at + 1).some((word) => /^-[A-Za-z]*c/.test(word))
}

// The word after `exec` and its options; `-a` takes the name that follows it.
function execHead(words: readonly string[]) {
  if (words[0] !== "exec") return 0
  let at = 1
  while (words[at]?.startsWith("-")) at += words[at] === "-a" ? 2 : 1
  return at
}

/**
 * Renders `source`, a span of `input` that starts at or after `from` with only blanks before it, with the operator
 * characters at literal positions masked.
 */
export function render(input: string, inert: ReadonlySet<number>, from: number | undefined, source: string) {
  const start = input.indexOf(source, from)
  return source.replace(OPERATORS, (char, offset: number) => (inert.has(start + offset) ? MASK : char))
}
