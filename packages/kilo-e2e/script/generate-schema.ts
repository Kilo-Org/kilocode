import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { jsonSchemaDocuments } from "../src/schema"

const root = resolve(import.meta.dir, "..")
const target = join(root, "schema")
const check = process.argv.includes("--check")

function document(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

await mkdir(target, { recursive: true })

const documents = jsonSchemaDocuments()
let stale = 0
for (const [name, schema] of Object.entries(documents)) {
  const file = join(target, `${name}.v1.json`)
  const next = document(schema)
  const current = await Bun.file(file)
    .text()
    .then(
      (text) => text,
      () => null,
    )
  if (current === next) continue
  stale += 1
  if (check) {
    console.error(`stale schema: ${file}`)
    continue
  }
  await writeFile(file, next)
}

if (check && stale > 0) process.exit(1)
if (!check) console.log(`generated ${Object.keys(documents).length} schema documents in ${target}`)
