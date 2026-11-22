// Markers inlined in place of a `!`cmd`` placeholder when it is not executed. Shared by the
// skill tool (inject.ts) and the slash-command path (session/prompt.ts) so both render identically.
export const SKILL_SHELL_DISABLED = "[skill shell execution disabled by policy]"
export const SKILL_SHELL_UNTRUSTED = "[skill shell execution disabled for untrusted skill]"

// Render a skill command for a permission prompt as a single, tamper-evident line.
// Escape control chars (CR/LF/ESC/etc.) so a command can't repaint the terminal, and invisible
// format chars (bidi marks and overrides, line/paragraph separators, zero-width characters,
// variation selectors, tag characters, BOM), which belong to the same display policy: the prompt
// shows each one as its literal escape, so the text presented matches the characters the command
// carries. The class covers width-less characters in every plane, supplementary ones included.
const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu

export function displayCommand(command: string) {
  return command.replace(CONTROL, (ch) => {
    if (ch === "\n") return "\\n"
    if (ch === "\r") return "\\r"
    if (ch === "\t") return "\\t"
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0xff) return "\\x" + code.toString(16).padStart(2, "0")
    if (code <= 0xffff) return "\\u" + code.toString(16).padStart(4, "0")
    return "\\u{" + code.toString(16) + "}"
  })
}

// Presentation for a skill-shell permission prompt: the title (naming the skill when known)
// and the verbatim, escaped commands to show. Reads metadata.commands (never the decomposed
// patterns, which drop `cd` segments and split pipelines) so the display matches what executes.
// Returns undefined when the request is not a skill-shell batch.
export function skillShellPrompt(metadata: Record<string, unknown> | undefined) {
  if (metadata?.["skillShell"] !== true) return undefined
  const raw = metadata["commands"]
  const commands = (Array.isArray(raw) ? raw : []).filter((c): c is string => typeof c === "string").map(displayCommand)
  const skill = typeof metadata["skill"] === "string" ? metadata["skill"] : undefined
  return {
    title: skill ? `Run shell commands from skill "${skill}"?` : "Run these skill commands?",
    commands,
  }
}
