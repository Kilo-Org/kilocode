import path from "path"
import { parseModelsSnapshot, type ModelsSnapshot } from "./models-snapshot-shape"

const NAME = "models-snapshot.json"
const FILE = path.resolve(import.meta.dir, "../../provider/models-snapshot.json")

function parse(text: string, source: string): ModelsSnapshot | undefined {
  try {
    return parseModelsSnapshot(text, source).data
  } catch (err) {
    console.warn(`Failed to load models snapshot from ${source}`, err)
    return undefined
  }
}

async function load(file: string) {
  const local = Bun.file(file)
  if (!(await local.exists())) return undefined
  return parse(await local.text(), file)
}

export async function loadModelsSnapshotFrom(files: readonly string[]) {
  for (const file of files) {
    const found = await load(file)
    if (found) return found
  }
  return undefined
}

export async function loadModelsSnapshot() {
  return loadModelsSnapshotFrom([path.join(path.dirname(process.execPath), NAME), FILE])
}
