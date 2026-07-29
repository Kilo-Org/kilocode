// Render a skill command for a permission prompt as a single, tamper-evident
// line: escape control chars (CR/LF/ESC/etc.) so a command can't repaint the
// terminal to make the visible text differ from what will execute.
export function displayCommand(command: string) {
  return command.replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => {
    if (ch === "\n") return "\\n"
    if (ch === "\r") return "\\r"
    if (ch === "\t") return "\\t"
    return "\\x" + ch.charCodeAt(0).toString(16).padStart(2, "0")
  })
}
