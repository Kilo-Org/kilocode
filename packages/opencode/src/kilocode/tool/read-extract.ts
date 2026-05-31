import type { Readable } from "stream"
import * as Docx from "./read-docx"
import * as Notebook from "./notebook"
import * as Xlsx from "./xlsx"

export function binary(filepath: string) {
  return Docx.accepts(filepath) || Xlsx.is(filepath)
}

export async function open(filepath: string): Promise<Readable | undefined> {
  if (Docx.accepts(filepath)) return Docx.open(filepath)
  if (Xlsx.is(filepath)) return Xlsx.open(filepath)
  if (Notebook.isFile(filepath)) return Notebook.open(filepath)
  return undefined
}
