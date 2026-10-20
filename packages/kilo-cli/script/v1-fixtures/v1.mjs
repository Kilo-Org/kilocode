// Shared setup for the v1 fixture children. A child runs inside the v1 checkout (cwd packages/opencode) under the
// temporary HOME, XDG and TMPDIR that script/v1-fixtures.ts gives it, and loads the v1 modules by file URL. The
// children are JavaScript because they call v1 modules, which v2 types do not describe.
import path from "node:path"
import { pathToFileURL } from "node:url"

const checkout = process.env.KILO_V1_CHECKOUT
const out = process.env.KILO_V1_FIXTURE_OUT
if (!checkout || !out) throw new Error("run through script/v1-fixtures.ts")

// The v1 test preload sets these before any v1 module loads; some v1 modules read them at import.
process.env.KILO_TEST_HOME ??= process.env.HOME
process.env.KILO_TEST_MANAGED_CONFIG_DIR ??= path.join(process.env.TMPDIR, "managed")
process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ??= "true"
process.env.KILO_SNAPSHOT_MATERIALIZE_IDLE_MS ??= "0"

/** Absolute file URL of a path in the v1 checkout. */
export const url = (relative) => pathToFileURL(path.join(checkout, relative)).href

/** Import a v1 module by its path in the v1 checkout. */
export const source = (relative) => import(url(relative))

/** The `effect` instance the v1 sources resolve, so that Effect values cross between the child and v1 code. */
export const effect = () =>
  import(pathToFileURL(Bun.resolveSync("effect", path.join(checkout, "packages/opencode/src"))).href)

/** Write the result for script/v1-fixtures.ts: `sources` (v1 paths), `constants`, and `cases` ({ name, fn, input, output }). */
export const write = (result) => Bun.write(out, JSON.stringify(result))
