import path from "node:path"
import { pathToFileURL } from "node:url"

const native: { binaryPath: string | undefined } = await import(
  pathToFileURL(path.join(path.dirname(process.execPath), "node_modules/@opencode-ai/pty/index.js")).href
)

export const binaryPath = native.binaryPath
