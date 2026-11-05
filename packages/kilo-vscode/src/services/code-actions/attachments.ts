import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import type { PromptAttachment } from "../../protocol"
import type { TerminalOutput } from "../terminal/truncate"
import type { EditorContext } from "./editor-utils"

function dataUrl(text: string): string {
  return `data:text/plain;base64,${Buffer.from(text, "utf8").toString("base64")}`
}

/**
 * A selection becomes a data URL snapshot. The server reads the attachment itself, and an unsaved buffer has no file
 * content to read, so the text is captured when the user adds it.
 */
export function selectionAttachment(ctx: EditorContext): PromptAttachment {
  const name = basename(ctx.filePath)
  return {
    id: randomUUID(),
    kind: "selection",
    uri: dataUrl(ctx.selectedText),
    name: ctx.startLine === ctx.endLine ? `${name}:${ctx.startLine}` : `${name}:${ctx.startLine}-${ctx.endLine}`,
    description: `${ctx.filePath}, lines ${ctx.startLine}-${ctx.endLine}`,
    source: ctx.source,
    path: ctx.filePath,
    line: ctx.startLine,
  }
}

export function terminalAttachment(output: TerminalOutput): PromptAttachment {
  return {
    id: randomUUID(),
    kind: "terminal",
    uri: dataUrl(output.content),
    name: "Terminal output",
    description: output.truncated ? "Terminal output, truncated" : "Terminal output",
  }
}
