import fs from "fs/promises"
import path from "path"
import { parseModelsSnapshot } from "../../src/kilocode/provider/models-snapshot-shape"

export const MODELS_SNAPSHOT_PATH = path.resolve(import.meta.dir, "../../src/provider/models-snapshot.json")

const STALE = [
  path.resolve(import.meta.dir, "../../src/provider/models-snapshot.js"),
  path.resolve(import.meta.dir, "../../src/provider/models-snapshot.d.ts"),
]

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export interface PrepareModelsSnapshotOptions {
  input?: string
  output?: string
  source?: string
  fetcher?: Fetcher
}

async function content(opts: PrepareModelsSnapshotOptions) {
  const input = opts.input ?? process.env.MODELS_DEV_API_JSON
  if (input) {
    return {
      source: input,
      text: await Bun.file(input).text(),
    }
  }

  const base = opts.source ?? process.env.KILO_MODELS_URL ?? "https://models.dev"
  const url = `${base.replace(/\/+$/, "")}/api.json`
  const fetcher = opts.fetcher ?? fetch
  const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Failed to download models snapshot from ${url}: ${res.status} ${res.statusText}`)
  return {
    source: url,
    text: await res.text(),
  }
}

async function replace(file: string, body: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.models-snapshot.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(tmp, body)
    await fs.rename(tmp, file)
  } catch (err) {
    await fs
      .rm(tmp, { force: true })
      .catch((cause) => console.warn(`Failed to remove temporary models snapshot ${tmp}`, cause))
    throw err
  }
}

async function cleanup(file: string) {
  if (path.resolve(file) !== MODELS_SNAPSHOT_PATH) return
  await Promise.all(
    STALE.map((item) =>
      fs.rm(item, { force: true }).catch((err) => console.warn(`Failed to remove stale models snapshot ${item}`, err)),
    ),
  )
}

export async function prepareModelsSnapshot(opts: PrepareModelsSnapshotOptions = {}) {
  const out = path.resolve(opts.output ?? MODELS_SNAPSHOT_PATH)
  const raw = await content(opts)
  const parsed = parseModelsSnapshot(raw.text, raw.source)
  await replace(out, `${JSON.stringify(parsed.data)}\n`)
  await cleanup(out)
  return {
    path: out,
    source: raw.source,
    providers: parsed.stats.providers,
    models: parsed.stats.models,
  }
}
