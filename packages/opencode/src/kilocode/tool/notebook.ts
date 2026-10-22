import * as path from "path"
import { Readable } from "stream"
import * as Encoding from "../encoding"

type ObjectValue = Record<string, unknown>

const object = (value: unknown): value is ObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const source = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (!Array.isArray(value) || !value.every((line) => typeof line === "string")) return undefined
  return value.join("")
}

const render = (kind: "markdown" | "code", text: string) => {
  const body = text.endsWith("\n") ? text : `${text}\n`
  return `<${kind}_cell>\n${body}</${kind}_cell>`
}

export function isFile(filepath: string) {
  return path.extname(filepath).toLowerCase() === ".ipynb"
}

export async function open(filepath: string, bytes: Buffer): Promise<Readable> {
  const raw = Encoding.decode(bytes, Encoding.detect(bytes))
  const data = parse(raw)
  if (!object(data) || !Array.isArray(data.cells)) return Readable.from([raw])

  const cells: string[] = []
  for (const cell of data.cells) {
    if (!object(cell)) continue
    if (cell.cell_type !== "markdown" && cell.cell_type !== "code") continue

    const text = source(cell.source)
    if (text === undefined) continue
    cells.push(render(cell.cell_type, text))
  }

  return Readable.from([cells.length ? cells.join("\n\n") : "(Notebook contains no markdown or code cell content.)"])
}
