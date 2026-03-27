import fs from "fs/promises"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { resolveGlobalPaths, resolveHome } from "./paths"

const app = "kilo" // kilocode_change
const paths = resolveGlobalPaths(app)

export namespace Global {
  export const Path = {
    // Allow override via KILO_TEST_HOME for test isolation
    get home() {
      return resolveHome() // kilocode_change
    },
    ...paths,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
}
