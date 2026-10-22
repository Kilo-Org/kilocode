// Atoms before `--` are positional shell arguments where re-quoting around
// embedded spaces preserves the user's word-binding intent (PR #4979).
// Atoms in `args["--"]` are raw passthrough per yargs `populate--` semantics:
// the user typed `--` to opt out of further parsing, so the assembler must
// not synthesize quote bytes around them. Re-quoting raw atoms breaks
// leading-dash inputs like `kilo run -- "- Who are you?"` (#9622) by
// emitting `"- Who are you?"` (literal quotes) into the model prompt.
export function buildRunMessage(positionals: string[], dash?: string[]): string {
  const quoted = positionals.map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
  return [...quoted, ...(dash ?? [])].join(" ")
}
