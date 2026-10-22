/** Split an $EDITOR/$VISUAL-style command string into argv, honoring single/double-quoted segments
 * so a quoted path with spaces (e.g. `"/Applications/My Editor.app/.../editor"`) stays one token.
 * Not a full shell parser — no escape sequences or nested quotes. */
export function splitCommand(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return tokens
}
