import { ConfigParse } from "@/config/parse"
import { Filesystem } from "@/util/filesystem"
import path from "path"

export namespace KilocodeMcpConfig {
  export function format(file: string, input: string) {
    if (file.endsWith(".jsonc")) return input
    return JSON.stringify(ConfigParse.jsonc(input, file), null, 2)
  }

  export function files(dir: string, global = false) {
    if (global) {
      return [path.join(dir, "kilo.jsonc"), path.join(dir, "kilo.json")]
    }
    return [
      path.join(dir, ".kilo", "kilo.jsonc"),
      path.join(dir, ".kilo", "kilo.json"),
      path.join(dir, ".kilocode", "kilo.jsonc"),
      path.join(dir, ".kilocode", "kilo.json"),
      path.join(dir, "kilo.jsonc"),
      path.join(dir, "kilo.json"),
    ]
  }

  export async function resolve(dir: string, global = false) {
    for (const file of files(dir, global)) {
      if (await Filesystem.exists(file)) return file
    }
    if (global) return path.join(dir, "kilo.jsonc")
    return path.join(dir, ".kilo", "kilo.jsonc")
  }
}
