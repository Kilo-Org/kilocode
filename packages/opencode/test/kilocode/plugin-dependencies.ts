import { mkdir } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

async function mark(dir: string) {
  await mkdir(path.join(dir, "node_modules"), { recursive: true })
  await Bun.write(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ packages: { "": { dependencies: { "@kilocode/plugin": "0.0.0" } } } }),
  )
}

export function preparePluginDependencies(dir: string) {
  return Promise.all([mark(path.join(dir, ".opencode")), mark(Global.Path.config)])
}
