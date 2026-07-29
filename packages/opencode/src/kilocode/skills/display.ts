// Render a skill command for a permission prompt as a single, tamper-evident line.
// Escape control chars (CR/LF/ESC/etc.) so a command can't repaint the terminal, and
// bidi/format controls (U+202A-202E, U+2066-2069, U+200E/F, U+2028/9) so a Trojan-Source
// style reorder can't make the visible text differ from what will execute.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

export function displayCommand(command: string) {
  return command.replace(CONTROL, (ch) => {
    if (ch === "\n") return "\\n"
    if (ch === "\r") return "\\r"
    if (ch === "\t") return "\\t"
    const code = ch.charCodeAt(0)
    return code <= 0xff ? "\\x" + code.toString(16).padStart(2, "0") : "\\u" + code.toString(16).padStart(4, "0")
  })
}
